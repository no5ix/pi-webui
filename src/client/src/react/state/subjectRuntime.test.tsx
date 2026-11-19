// @vitest-environment happy-dom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Project, SessionInfo, Workspace } from "../../../../shared/apiTypes";
import { selection, selectSession, startSelectionUrlSync, useSelection } from "./selection";
import { subjectStatusStore, useSubjectResolution } from "./subjectRuntime";
import { lastSessionMemory } from "./selectionMemory";
import type { SubjectFacts } from "./subjectResolver";

const locatedSession = vi.hoisted(() => ({
  id: "ses-located",
  cwd: "/work/pi-web/.worktrees/feature",
  path: "/store/ses-located.jsonl",
  created: "2026-01-01T00:00:00.000Z",
  modified: "2026-01-02T00:00:00.000Z",
  messageCount: 2,
  firstMessage: "A located session",
}));

vi.mock("../../controllers/sessionBoardController", () => ({
  locateSessionOnMachine: vi.fn((sessionId: string) => Promise.resolve(sessionId === locatedSession.id ? locatedSession : "gone")),
}));

const project: Project = { id: "proj-1", name: "pi-web", path: "/work/pi-web", createdAt: "2026-01-01T00:00:00.000Z" };
const main: Workspace = { id: "ws-main", projectId: "proj-1", path: "/work/pi-web", label: "pi-web", isMain: true, effectiveConfig: {} };
const feature: Workspace = { id: "ws-feature", projectId: "proj-1", path: "/work/pi-web/.worktrees/feature", label: "feature", isMain: false, effectiveConfig: {} };

function listed(id: string, cwd: string): SessionInfo {
  return { id, cwd, path: `/store/${id}.jsonl`, created: "2026-01-01T00:00:00.000Z", modified: "2026-01-02T00:00:00.000Z", messageCount: 3, firstMessage: "Listed session" };
}

/**
 * The shell's resolver as the shell uses it: the selection is read live, so a
 * plan that moves it feeds the next pass, the way a render does in the app.
 */
function Probe(props: { facts: Omit<SubjectFacts, "selection"> }): null {
  const live = useSelection();
  useSubjectResolution({ ...props.facts, selection: live });
  return null;
}

function factsFor(overrides: Partial<Omit<SubjectFacts, "selection">> = {}): Omit<SubjectFacts, "selection"> {
  return {
    machineId: "local",
    sessions: [],
    workspaces: [main, feature],
    projects: [project],
    boardPhase: "live",
    projectsPhase: "ready",
    rememberedSessionId: undefined,
    ...overrides,
  };
}

/**
 * Let the shell settle: the subject plan runs in an effect, and a plan that
 * moves the selection (empty → workspace → preferred session, or a locate that
 * comes back) feeds the next pass. The turns are counted, not guessed: the
 * chain is a handful of renders deep, and an assertion made before it lands
 * would be an assertion about a half-built subject.
 */
async function settled(): Promise<void> {
  await act(async () => {
    for (let pass = 0; pass < 12; pass += 1) {
      await new Promise((resolve) => { window.setTimeout(resolve, 0); });
    }
  });
}

describe("the shell resolves its subject", () => {
  afterEach(() => {
    cleanup();
    selection.set({ machineId: "local", projectId: undefined, workspaceId: undefined, sessionId: undefined });
    subjectStatusStore.set({ state: "empty", sessionId: undefined, reason: undefined });
    window.history.replaceState({}, "", "/");
  });

  it("opens the first project's main workspace and its preferred session on a fresh page", async () => {
    const facts = factsFor({ sessions: [listed("ses-a", main.path), listed("ses-b", feature.path)] });
    render(<Probe facts={facts} />);
    await settled();
    expect(selection.get()).toEqual({ machineId: "local", projectId: "proj-1", workspaceId: "ws-main", sessionId: "ses-a" });
  });

  it("writes the resolved subject into the address bar so a reload lands on the same session", async () => {
    const stop = startSelectionUrlSync();
    const facts = factsFor({ sessions: [listed("ses-c", main.path)] });
    render(<Probe facts={facts} />);
    await settled();
    const search = new URLSearchParams(window.location.search);
    expect(search.get("project")).toBe("proj-1");
    expect(search.get("workspace")).toBe("ws-main");
    expect(search.get("session")).toBe("ses-c");
    stop();
  });

  it("asks the machine for a session the listings do not show, then places it at its own workspace", async () => {
    selectSession({ sessionId: locatedSession.id });
    const facts = factsFor({ sessions: [listed("ses-a", main.path)] });
    render(<Probe facts={facts} />);
    expect(subjectStatusStore.get().state).toBe("locating");
    await settled();
    expect(selection.get()).toEqual({ machineId: "local", projectId: "proj-1", workspaceId: "ws-feature", sessionId: locatedSession.id });
    expect(subjectStatusStore.get()).toEqual({ state: "resolved", sessionId: locatedSession.id, reason: undefined });
  });

  it("says a session the machine reports as gone, and keeps the reader's selection", async () => {
    selectSession({ projectId: "proj-1", workspaceId: "ws-main", sessionId: "ses-gone" });
    const facts = factsFor({ sessions: [listed("ses-a", main.path)] });
    render(<Probe facts={facts} />);
    await settled();
    expect(subjectStatusStore.get().state).toBe("missing");
    expect(selection.get().sessionId).toBe("ses-gone");
  });

  it("keeps the selection the reader made while the machine is still answering", async () => {
    selectSession({ projectId: "proj-1", workspaceId: "ws-main", sessionId: "ses-pending" });
    const facts = factsFor({ boardPhase: "loading" });
    render(<Probe facts={facts} />);
    await settled();
    expect(selection.get().sessionId).toBe("ses-pending");
    expect(subjectStatusStore.get().state).toBe("loading");
  });

  it("remembers the session it resolved for a workspace, and prefers that session next time", async () => {
    const remembered = listed("ses-remembered", main.path);
    render(<Probe facts={factsFor({ sessions: [remembered, listed("ses-other", feature.path)] })} />);
    await settled();
    expect(selection.get().sessionId).toBe("ses-remembered");
    expect(lastSessionMemory.latestSessionId(main.path)).toBe("ses-remembered");

    cleanup();
    selection.set({ machineId: "local", projectId: "proj-1", workspaceId: "ws-main", sessionId: undefined });
    const second = factsFor({
      sessions: [listed("ses-newest", main.path), remembered],
      rememberedSessionId: lastSessionMemory.latestSessionId(main.path),
    });
    render(<Probe facts={second} />);
    await settled();
    expect(selection.get().sessionId).toBe("ses-remembered");

    lastSessionMemory.forgetWorkspace(main.path);
    lastSessionMemory.forgetWorkspace(feature.path);
  });
});
