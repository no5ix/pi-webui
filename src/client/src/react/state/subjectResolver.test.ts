// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { Project, SessionInfo, Workspace } from "../../../../shared/apiTypes";
import { planSubject, sameSelection, firstProjectSelection } from "./subjectRuntime";
import { subjectDecision, subjectOf, selectionOfLocated, sessionsOfWorkspace, type SubjectFacts } from "./subjectResolver";

const project: Project = { id: "proj-1", name: "pi-web", path: "/work/pi-web", createdAt: "2026-01-01T00:00:00.000Z" };
const otherProject: Project = { id: "proj-2", name: "other", path: "/work/other", createdAt: "2026-01-01T00:00:00.000Z" };

function workspace(id: string, projectId: string, path: string, isMain = false): Workspace {
  return { id, projectId, path, label: path, isMain, effectiveConfig: {} };
}

function session(id: string, cwd: string, overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id,
    cwd,
    path: `/store/${id}.jsonl`,
    created: "2026-01-01T00:00:00.000Z",
    modified: "2026-01-02T00:00:00.000Z",
    messageCount: 4,
    firstMessage: "First thing said",
    ...overrides,
  };
}

const main = workspace("ws-main", "proj-1", "/work/pi-web", true);
const feature = workspace("ws-feature", "proj-1", "/work/pi-web/.worktrees/feature");
const listed = session("ses-1", "/work/pi-web");
const featureSession = session("ses-2", "/work/pi-web/.worktrees/feature");

function facts(overrides: Partial<SubjectFacts> = {}): SubjectFacts {
  return {
    machineId: "local",
    selection: { machineId: "local", projectId: undefined, workspaceId: undefined, sessionId: undefined },
    sessions: [],
    workspaces: [],
    projects: [],
    boardPhase: "live",
    projectsPhase: "ready",
    rememberedSessionId: undefined,
    ...overrides,
  };
}

describe("the subject a route names", () => {
  it("opens a session the machine lists at its own workspace and project", () => {
    const decision = subjectDecision(facts({
      selection: { machineId: "local", projectId: "proj-1", workspaceId: "ws-main", sessionId: "ses-1" },
      sessions: [listed],
      workspaces: [main, feature],
      projects: [project, otherProject],
    }));
    expect(decision.kind).toBe("resolved");
    if (decision.kind !== "resolved") return;
    expect(decision.session).toEqual({ id: "ses-1", cwd: "/work/pi-web" });
    expect(decision.workspace?.id).toBe("ws-main");
    expect(decision.project?.id).toBe("proj-1");
  });

  it("places a session whose workspace id the route got wrong by the session's own path", () => {
    const subject = subjectOf(facts({
      selection: { machineId: "local", projectId: "proj-1", workspaceId: "stale-id", sessionId: "ses-1" },
      sessions: [listed],
      workspaces: [main],
      projects: [project],
    }));
    expect(subject.workspace?.id).toBe("ws-main");
    expect(subject.session).toEqual({ id: "ses-1", cwd: "/work/pi-web" });
  });

  it("keeps a session it has not been told about while the machine is still answering", () => {
    const input = facts({
      selection: { machineId: "local", projectId: "proj-1", workspaceId: "ws-main", sessionId: "ses-9" },
      workspaces: [main],
      projects: [project],
      boardPhase: "loading",
    });
    expect(subjectDecision(input)).toEqual({ kind: "loading", waitingFor: "board" });
    const plan = planSubject(subjectDecision(input), input);
    expect(plan.selection).toBeUndefined();
    expect(plan.status.state).toBe("loading");
    expect(plan.locate).toBeUndefined();
    expect(subjectOf(input).session).toEqual({ id: "ses-9", cwd: "/work/pi-web" });
  });

  it("asks the machine where a session is once the machine has answered everything", () => {
    const input = facts({
      selection: { machineId: "local", projectId: "proj-1", workspaceId: "ws-main", sessionId: "ses-9" },
      sessions: [listed],
      workspaces: [main],
      projects: [project],
      boardPhase: "live",
    });
    expect(subjectDecision(input)).toEqual({ kind: "needs-locate", sessionId: "ses-9", workspace: main });
    const plan = planSubject(subjectDecision(input), input);
    expect(plan.locate).toBe("ses-9");
    expect(plan.status).toEqual({ state: "locating", sessionId: "ses-9", reason: undefined });
    expect(plan.selection).toBeUndefined();
  });

  it("places a located session at the workspace and project its path belongs to", () => {
    const located = session("ses-9", "/work/pi-web/.worktrees/feature");
    const next = selectionOfLocated(located, [main, feature], [project], "local");
    expect(next).toEqual({ machineId: "local", projectId: "proj-1", workspaceId: "ws-feature", sessionId: "ses-9" });
  });

  it("keeps a located session whose project is closed listed by id, without inventing a project", () => {
    const located = session("ses-9", "/elsewhere/folder");
    const next = selectionOfLocated(located, [main], [project], "local");
    expect(next.projectId).toBeUndefined();
    expect(next.workspaceId).toBeUndefined();
    expect(next.sessionId).toBe("ses-9");
  });

  it("refuses to call an unanswered board an empty list", () => {
    const input = facts({
      selection: { machineId: "local", projectId: "proj-1", workspaceId: "ws-main", sessionId: undefined },
      workspaces: [main],
      projects: [project],
      boardPhase: "refused",
    });
    expect(subjectDecision(input)).toEqual({ kind: "blocked", reason: "the machine refused the board" });
    const asked = facts({
      selection: { machineId: "local", projectId: "proj-1", workspaceId: "ws-main", sessionId: "ses-9" },
      workspaces: [main],
      projects: [project],
      boardPhase: "refused",
    });
    expect(subjectDecision(asked)).toEqual({ kind: "blocked", reason: "the machine refused the board" });
  });
});

describe("the session a workspace opens", () => {
  it("opens the session this browser last read in that workspace", () => {
    const decision = subjectDecision(facts({
      selection: { machineId: "local", projectId: "proj-1", workspaceId: "ws-feature", sessionId: undefined },
      sessions: [listed, featureSession],
      workspaces: [main, feature],
      projects: [project],
      rememberedSessionId: featureSession.id,
    }));
    expect(decision.kind).toBe("open-preferred");
    if (decision.kind !== "open-preferred") return;
    expect(decision.sessionId).toBe("ses-2");
    expect(decision.workspace.id).toBe("ws-feature");
  });

  it("falls back to the workspace's own newest live session when the remembered id is not in its listing", () => {
    const decision = subjectDecision(facts({
      selection: { machineId: "local", projectId: "proj-1", workspaceId: "ws-main", sessionId: undefined },
      sessions: [listed, featureSession],
      workspaces: [main, feature],
      projects: [project],
      rememberedSessionId: featureSession.id,
    }));
    expect(decision.kind).toBe("open-preferred");
    if (decision.kind !== "open-preferred") return;
    expect(decision.sessionId).toBe("ses-1");
    expect(decision.workspace.id).toBe("ws-main");
  });

  it("opens the first live session when nothing is remembered, and skips archived and gone rows", () => {
    const archived = session("ses-archived", "/work/pi-web", { archived: true });
    const gone = session("ses-gone", "/work/pi-web", { cwdMissing: true });
    const decision = subjectDecision(facts({
      selection: { machineId: "local", projectId: "proj-1", workspaceId: "ws-main", sessionId: undefined },
      sessions: [archived, gone, featureSession, listed],
      workspaces: [main, feature],
      projects: [project],
    }));
    expect(decision.kind).toBe("open-preferred");
    if (decision.kind !== "open-preferred") return;
    expect(decision.sessionId).toBe("ses-1");
  });

  it("reports a workspace whose listing answered with no openable session, and never a fake session", () => {
    const decision = subjectDecision(facts({
      selection: { machineId: "local", projectId: "proj-1", workspaceId: "ws-main", sessionId: undefined },
      sessions: [featureSession],
      workspaces: [main],
      projects: [project],
    }));
    expect(decision.kind).toBe("workspace-empty");
    const plan = planSubject(decision, facts({}));
    expect(plan.selection).toBeUndefined();
    expect(plan.status.reason).toBe("no session in this workspace");
  });

  it("waits for the board before deciding a workspace is empty", () => {
    const decision = subjectDecision(facts({
      selection: { machineId: "local", projectId: "proj-1", workspaceId: "ws-main", sessionId: undefined },
      workspaces: [main],
      projects: [project],
      boardPhase: "loading",
    }));
    expect(decision.kind).toBe("loading");
  });

  it("lists only the sessions of the workspace it is asked about", () => {
    expect(sessionsOfWorkspace([listed, featureSession], feature).map((entry) => entry.id)).toEqual(["ses-2"]);
  });
});

describe("a fresh page with no route", () => {
  it("chooses the first open project's main workspace, then its preferred session", () => {
    const input = facts({ projects: [otherProject, project], workspaces: [feature, main], sessions: [listed] });
    const next = firstProjectSelection(input);
    expect(next).toEqual({ machineId: "local", projectId: "proj-2", workspaceId: undefined, sessionId: undefined });
    const withWorkspaces = firstProjectSelection(facts({ projects: [project, otherProject], workspaces: [feature, main], sessions: [listed] }));
    expect(withWorkspaces).toEqual({ machineId: "local", projectId: "proj-1", workspaceId: "ws-main", sessionId: undefined });
    const plan = planSubject(subjectDecision(input), input);
    expect(plan.selection).toEqual(next);
    expect(plan.status.state).toBe("loading");
  });

  it("says there is nothing to open when no project is open, and asks for nothing", () => {
    const input = facts({ projects: [] });
    const plan = planSubject(subjectDecision(input), input);
    expect(plan.selection).toBeUndefined();
    expect(plan.status).toEqual({ state: "empty", sessionId: undefined, reason: "no open project" });
  });

  it("opens the first project's only workspace when it has no main", () => {
    const next = firstProjectSelection(facts({ projects: [project], workspaces: [feature] }));
    expect(next?.workspaceId).toBe("ws-feature");
  });
});

describe("selection writes that must not loop", () => {
  it("knows when a plan asks for the selection the shell already has", () => {
    const current = { machineId: "local", projectId: "proj-1", workspaceId: "ws-main", sessionId: "ses-1" };
    expect(sameSelection(current, { ...current })).toBe(true);
    expect(sameSelection(current, { ...current, sessionId: "ses-2" })).toBe(false);
  });
});
