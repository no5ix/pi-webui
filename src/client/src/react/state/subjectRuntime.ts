import { useEffect, useMemo } from "react";
import { locateSessionOnMachine } from "../../controllers/sessionBoardController";
import type { Project, SessionInfo, Workspace } from "../../../../shared/apiTypes";
import { selectSession, selection, type Selection } from "./selection";
import { lastSessionMemory } from "./selectionMemory";
import { createStore, useStoreSelect } from "./store";
import { selectionOfLocated, subjectDecision, type SubjectDecision, type SubjectFacts } from "./subjectResolver";

/**
 * The shell's subject machinery: a pure plan, then a dumb executor.
 *
 * `planSubject` decides, from the named states of `subjectResolver`, what the
 * selection should become, what the shell should tell the reader, and whether
 * the machine must be asked where a session went. The executor below performs
 * exactly that and nothing else, so every branch of subject resolution is
 * testable without a browser, a socket, or a render.
 */

/** What the shell knows about the subject it was asked to show. */
export interface SubjectStatus {
  readonly state: "empty" | "loading" | "resolved" | "asking" | "locating" | "missing" | "failed" | "blocked";
  readonly sessionId: string | undefined;
  readonly reason: string | undefined;
}

export const idleSubjectStatus: SubjectStatus = { state: "empty", sessionId: undefined, reason: undefined };

export const subjectStatusStore = createStore<SubjectStatus>(idleSubjectStatus);

export function useSubjectStatus(): SubjectStatus {
  return useStoreSelect(subjectStatusStore, (value) => value);
}

export interface SubjectPlan {
  readonly selection: Selection | undefined;
  readonly status: SubjectStatus;
  /** A session id to ask the machine about, when the listing does not show it. */
  readonly locate: string | undefined;
  /** The session to remember as this browser's last one in its workspace. */
  readonly remember: SessionInfo | undefined;
}

/** The first workspace a fresh reader should land in: the first open project's main workspace. */
export function firstProjectSelection(facts: SubjectFacts): Selection | undefined {
  const project: Project | undefined = facts.projects[0];
  if (project === undefined) return undefined;
  const workspaces = facts.workspaces.filter((workspace: Workspace) => workspace.projectId === project.id);
  const workspace = workspaces.find((candidate: Workspace) => candidate.isMain) ?? workspaces[0];
  return { machineId: facts.machineId, projectId: project.id, workspaceId: workspace?.id, sessionId: undefined };
}

export function planSubject(decision: SubjectDecision, facts: SubjectFacts): SubjectPlan {
  switch (decision.kind) {
    case "empty": {
      const next = firstProjectSelection(facts);
      return {
        selection: next,
        status: next === undefined
          ? { state: "empty", sessionId: undefined, reason: facts.projects.length === 0 ? "no open project" : undefined }
          : { state: "loading", sessionId: undefined, reason: undefined },
        locate: undefined,
        remember: undefined,
      };
    }
    case "loading":
      return { selection: undefined, status: { state: "loading", sessionId: facts.selection.sessionId, reason: undefined }, locate: undefined, remember: undefined };
    case "resolved":
      return {
        selection: undefined,
        status: { state: "resolved", sessionId: facts.selection.sessionId, reason: undefined },
        locate: undefined,
        remember: decision.sessionInfo,
      };
    case "open-preferred":
      return {
        selection: {
          machineId: facts.machineId,
          projectId: decision.projectId,
          workspaceId: decision.workspace.id,
          sessionId: decision.sessionId,
        },
        status: { state: "loading", sessionId: decision.sessionId, reason: undefined },
        locate: undefined,
        remember: undefined,
      };
    case "workspace-empty":
      return {
        selection: undefined,
        status: { state: "resolved", sessionId: undefined, reason: "no session in this workspace" },
        locate: undefined,
        remember: undefined,
      };
    case "asking":
      return { selection: undefined, status: { state: "asking", sessionId: decision.sessionId, reason: undefined }, locate: undefined, remember: undefined };
    case "needs-locate":
      return { selection: undefined, status: { state: "locating", sessionId: decision.sessionId, reason: undefined }, locate: decision.sessionId, remember: undefined };
    case "blocked":
      return { selection: undefined, status: { state: "blocked", sessionId: facts.selection.sessionId, reason: decision.reason }, locate: undefined, remember: undefined };
  }
}

export function sameSelection(left: Selection, right: Selection): boolean {
  return left.machineId === right.machineId
    && left.projectId === right.projectId
    && left.workspaceId === right.workspaceId
    && left.sessionId === right.sessionId;
}

/**
 * The sessions this page located by id, keyed by id.
 *
 * The machine-wide locate answers with a full session row. Keeping it makes the
 * subject resolved from then on — the header gets the session's own name, the
 * transcript knows its folder, and the same session is never located twice
 * because the listings still do not show it.
 */
const locatedSessions = new Map<string, SessionInfo>();

function withLocatedSessions(sessions: readonly SessionInfo[]): readonly SessionInfo[] {
  if (locatedSessions.size === 0) return sessions;
  const listed = sessions.filter((session) => !locatedSessions.has(session.id));
  return [...locatedSessions.values(), ...listed];
}

/** The subject plan for the current facts, executed: the selection moves, the status is published. */
export function useSubjectResolution(facts: SubjectFacts): void {
  const sessions = withLocatedSessions(facts.sessions);
  const decision = useMemo(
    () => subjectDecision({ ...facts, sessions }),
    [facts.machineId, facts.selection, sessions, facts.workspaces, facts.projects, facts.boardPhase, facts.projectsPhase, facts.rememberedSessionId],
  );

  useEffect(() => {
    const plan = planSubject(decision, facts);
    subjectStatusStore.set(plan.status);
    if (plan.remember !== undefined) lastSessionMemory.rememberSession(plan.remember);
    if (plan.selection !== undefined && !sameSelection(plan.selection, selection.get())) selectSession(plan.selection);
    const sessionId = plan.locate;
    if (sessionId !== undefined) void locateIntoSelection(sessionId, facts);
  }, [decision, facts]);
}

const locating = new Set<string>();

/**
 * Ask the machine, machine-wide, where a session the listings do not show has
 * gone. Found: the selection gains its workspace and project, so the URL, the
 * navigation row and the workbench scopes all follow it. Gone: the reader is
 * told the session is not there. No answer: the reader is told that, and the
 * selection stays, because no answer is not evidence of absence.
 */
export async function locateIntoSelection(sessionId: string, facts: SubjectFacts): Promise<void> {
  if (locating.has(sessionId)) return;
  locating.add(sessionId);
  try {
    const located = await locateSessionOnMachine(sessionId, facts.machineId);
    if (located === "gone") {
      subjectStatusStore.set({ state: "missing", sessionId, reason: undefined });
      return;
    }
    locatedSessions.set(located.id, located);
    if (selection.get().sessionId !== sessionId) return;
    selectSession(selectionOfLocated(located, facts.workspaces, facts.projects, facts.machineId));
    subjectStatusStore.set({ state: "resolved", sessionId, reason: undefined });
  } catch (error) {
    subjectStatusStore.set({ state: "failed", sessionId, reason: error instanceof Error ? error.message : String(error) });
  } finally {
    locating.delete(sessionId);
  }
}
