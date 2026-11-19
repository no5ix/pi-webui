import type { Project, SessionInfo, SessionRef, Workspace } from "../../../../shared/apiTypes";
import { selectPreferredSession } from "../../controllers/sessionSelection";
import type { Selection } from "./selection";

/**
 * Which subject the shell is looking at, decided in one place.
 *
 * The URL names ids; the machine says what those ids mean. The two arrive at
 * different times — projects, workspaces and sessions load independently, a
 * bookmark can name a session no open project lists, a folder can be gone, a
 * session can be archived since the link was written — so the answer is a named
 * state, not a value that is quietly undefined while data arrives.
 *
 * The rule that shapes every branch: **absence is not negation**. A session id
 * the shell has not been told about while the machine is still answering is
 * "not known yet" (`asking`), never "missing", and it is never dropped: a
 * selection is only given up when the machine has said so.
 */

/** What the machine has answered so far, in the words the board store uses. */
export type SourcePhase = "loading" | "live" | "partial" | "refused" | "failed" | "idle" | "ready";

export interface SubjectFacts {
  machineId: string;
  selection: Selection;
  /** Every session the machine lists for the open projects. */
  sessions: readonly SessionInfo[];
  /** Every workspace the machine lists, from the board and the project store. */
  workspaces: readonly Workspace[];
  projects: readonly Project[];
  boardPhase: SourcePhase;
  projectsPhase: SourcePhase;
  /** The session this browser last opened in the selected workspace. */
  rememberedSessionId: string | undefined;
}

export type SubjectDecision =
  /** The route names nothing: the shell asks for a subject to open. */
  | { kind: "empty" }
  /** A source that would settle this has not answered. Keep the selection. */
  | { kind: "loading"; waitingFor: "board" | "projects" }
  /** The subject is known: the machine has the session and its place. */
  | { kind: "resolved"; project: Project | undefined; workspace: Workspace | undefined; session: SessionRef | undefined; sessionInfo: SessionInfo | undefined }
  /** A workspace is chosen with no session named: open its preferred session. */
  | { kind: "open-preferred"; projectId: string; workspace: Workspace; sessionId: string | undefined }
  /** A workspace is chosen and its listing answered with no openable session. */
  | { kind: "workspace-empty"; projectId: string; workspace: Workspace }
  /** The session is named and the machine is still answering about it. */
  | { kind: "asking"; sessionId: string }
  /** The machine answered everything and does not list this session: ask where it is. */
  | { kind: "needs-locate"; sessionId: string; workspace: Workspace | undefined }
  /** The machine refused the board: the subject cannot be settled from it. */
  | { kind: "blocked"; reason: string };


/** A board that was refused or did not answer: its listings are unknown, never empty. */
function refusedBoard(phase: SourcePhase): string | undefined {
  if (phase === "refused") return "the machine refused the board";
  if (phase === "failed") return "the board did not answer";
  return undefined;
}

const boardSettled: readonly SourcePhase[] = ["live", "partial", "refused", "failed"];
const projectsSettled: readonly SourcePhase[] = ["ready", "refused", "failed"];

export function workspaceOfSession(workspaces: readonly Workspace[], session: SessionInfo | undefined): Workspace | undefined {
  if (session === undefined) return undefined;
  return workspaces.find((workspace) => workspace.path === session.cwd);
}

/** The workspace a selection points at: by id first, then the session's own, then the project's main. */
export function resolveWorkspace(facts: SubjectFacts, sessionInfo: SessionInfo | undefined): Workspace | undefined {
  const { workspaces, selection } = facts;
  const byId = workspaces.find((workspace) => workspace.id === selection.workspaceId);
  if (byId !== undefined) return byId;
  const fromSession = workspaceOfSession(workspaces, sessionInfo);
  if (fromSession !== undefined) return fromSession;
  if (selection.projectId === undefined) return undefined;
  const ofProject = workspaces.filter((workspace) => workspace.projectId === selection.projectId);
  return ofProject.find((workspace) => workspace.isMain) ?? ofProject[0];
}

export function projectOfWorkspace(facts: SubjectFacts, workspace: Workspace | undefined): Project | undefined {
  if (workspace === undefined) return undefined;
  return facts.projects.find((project) => project.id === workspace.projectId);
}

/** The sessions a workspace's listing answers with, in the machine's order. */
export function sessionsOfWorkspace(sessions: readonly SessionInfo[], workspace: Workspace | undefined): readonly SessionInfo[] {
  if (workspace === undefined) return [];
  return sessions.filter((session) => session.cwd === workspace.path);
}

/**
 * Decide the subject from what has been answered.
 *
 * A named session is settled by the machine's listing when the listing has it;
 * by a locate when the machine has finished answering and does not; and by
 * "not yet" while any source is still speaking. A workspace without a session
 * opens its preferred one — the session this browser last read there, else the
 * newest live session — which is how PI WEB has always opened a project.
 */
export function subjectDecision(facts: SubjectFacts): SubjectDecision {
  const { selection, sessions, projects, boardPhase, projectsPhase } = facts;
  const sessionInfo = selection.sessionId === undefined ? undefined : sessions.find((session) => session.id === selection.sessionId);
  const workspace = resolveWorkspace(facts, sessionInfo);
  const project = projects.find((candidate) => candidate.id === selection.projectId) ?? projectOfWorkspace(facts, workspace);

  if (selection.sessionId !== undefined) {
    if (sessionInfo !== undefined) {
      return {
        kind: "resolved",
        project,
        workspace: workspace ?? workspaceOfSession(facts.workspaces, sessionInfo),
        session: { id: sessionInfo.id, cwd: sessionInfo.cwd },
        sessionInfo,
      };
    }
    if (!boardSettled.includes(boardPhase)) return { kind: "loading", waitingFor: "board" };
    const refusal = refusedBoard(boardPhase);
    if (refusal !== undefined) return { kind: "blocked", reason: refusal };
    if (workspace === undefined && projectsSettled.includes(projectsPhase) && projects.length === 0) {
      return { kind: "resolved", project: undefined, workspace: undefined, session: { id: selection.sessionId, cwd: "" }, sessionInfo: undefined };
    }
    return { kind: "needs-locate", sessionId: selection.sessionId, workspace };
  }

  if (selection.workspaceId === undefined && selection.projectId === undefined) return { kind: "empty" };

  if (workspace === undefined) {
    if (!projectsSettled.includes(projectsPhase) || !boardSettled.includes(boardPhase)) return { kind: "loading", waitingFor: "board" };
    return { kind: "empty" };
  }

  const listed = sessionsOfWorkspace(sessions, workspace);
  const preferred = selectPreferredSession([...listed], { latestSessionId: facts.rememberedSessionId });
  if (preferred !== undefined) return { kind: "open-preferred", projectId: workspace.projectId, workspace, sessionId: preferred.id };
  if (!boardSettled.includes(boardPhase)) return { kind: "loading", waitingFor: "board" };
  const refusal = refusedBoard(boardPhase);
  if (refusal !== undefined) return { kind: "blocked", reason: refusal };
  return { kind: "workspace-empty", projectId: workspace.projectId, workspace };
}

/** A session the machine named, plus the scope it belongs to, as a selection. */
export function selectionOfLocated(session: SessionInfo, workspaces: readonly Workspace[], projects: readonly Project[], machineId: string): Selection {
  const workspace = workspaces.find((candidate) => candidate.path === session.cwd);
  const project = workspace === undefined ? undefined : projects.find((candidate) => candidate.id === workspace.projectId);
  return {
    machineId,
    projectId: project?.id,
    workspaceId: workspace?.id,
    sessionId: session.id,
  };
}

/** The subject the panels act on: what the selection names, as the machine described it. */
export interface Subject {
  machineId: string;
  project: Project | undefined;
  workspace: Workspace | undefined;
  session: SessionRef | undefined;
  sessionInfo: SessionInfo | undefined;
}

/**
 * The subject for the current facts.
 *
 * A session the machine lists is opened at its own working directory; a session
 * the machine has not named yet (still answering, being located) is opened at
 * the workspace the route points at, and the transcript says what is unknown
 * rather than pretending the session is empty.
 */
export function subjectOf(facts: SubjectFacts): Subject {
  const { selection } = facts;
  const sessionInfo = selection.sessionId === undefined ? undefined : facts.sessions.find((session) => session.id === selection.sessionId);
  const workspace = resolveWorkspace(facts, sessionInfo);
  const project = facts.projects.find((candidate) => candidate.id === selection.projectId) ?? projectOfWorkspace(facts, workspace);
  const session = sessionInfo === undefined
    ? (selection.sessionId === undefined || selection.sessionId === "" ? undefined : { id: selection.sessionId, cwd: workspace?.path ?? "" })
    : { id: sessionInfo.id, cwd: sessionInfo.cwd };
  return { machineId: facts.machineId, project, workspace, session, sessionInfo };
}
