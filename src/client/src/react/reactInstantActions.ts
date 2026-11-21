import { projectsApi, type MachineRuntime, type Project, type SessionInfo } from "../api";
import { InstantActionController, type InstantKindExecutor } from "../controllers/instantActionController";
import type { ProjectController } from "../controllers/projectController";
import { instantAdmission, mergedAnswers, sessionsWithInstantActions, type InstantAction, type InstantActionKind, type InstantAnswer } from "../instantActions";
import type { SessionController } from "../controllers/sessionController";
import type { SessionBoardController } from "../controllers/sessionBoardController";
import type { Workspace } from "../api";
import { sessionLocationVerdict } from "../sessionLocationVerdict";
import { failedAnswer } from "../instantActions";
import { describeError } from "../notice";
import { CHECKING_REACHABILITY } from "../machineReachability";
import { runtimeAvailability } from "../machineAvailability";

const unanswered = (action: InstantAction): InstantAnswer => ({ doneIds: [], refused: [], unansweredIds: action.targets.map((target) => target.id) });

type SessionMutationController = Pick<SessionController, "archiveSessions" | "applyArchivedSessions" | "restoreSessions" | "applyRestoredSessions" | "deleteArchivedSessions" | "applyDeletedSessions">;
type SessionBoardReader = Pick<SessionBoardController, "readWhole" | "read" | "update">;
type ProjectMutationController = Pick<ProjectController, "applyClosedProject">;
type ProjectActionApi = Pick<typeof projectsApi, "closeProject" | "projects">;

function sessionExecutor(sessions: SessionMutationController, boards: SessionBoardReader, kind: "archive" | "restore" | "delete-archived"): InstantKindExecutor {
  return {
    send: async (action, keepalive) => {
      try {
        const refs = action.targets.map((target) => ({ id: target.id, cwd: target.workspacePath ?? "" }));
        if (kind === "archive") return await sessions.archiveSessions(refs, action.machineId, keepalive ? { keepalive: true } : undefined);
        if (kind === "restore") return await sessions.restoreSessions(refs, action.machineId);
        return await sessions.deleteArchivedSessions(refs, action.machineId, keepalive ? { keepalive: true } : undefined);
      } catch (error) {
        return failedAnswer(action.targets.map((target) => target.id), error, describeError(error));
      }
    },
    read: async (action) => {
      const board = await boards.readWhole(action.machineId);
      if (board === undefined) return unanswered(action);
      const listed = [...board.sessions, ...(board.pinnedElsewhere ?? [])];
      const answers = action.targets.map((target) => {
        const session = listed.find((item) => item.id === target.id);
        const covered = board.workspaces.some((workspace) => sessionLocationVerdict(target.workspacePath ?? "", workspace.path) === "described");
        const happened = kind === "archive" ? session?.archived === true
          : kind === "restore" ? session !== undefined && session.archived !== true
          : session === undefined && covered;
        if (happened) return { id: target.id, result: "done" as const };
        if (session !== undefined || covered) return { id: target.id, result: "refused" as const };
        return { id: target.id, result: "unanswered" as const };
      });
      return {
        doneIds: answers.flatMap((answer) => answer.result === "done" ? [answer.id] : []),
        refused: answers.flatMap((answer) => answer.result === "refused" ? [{ id: answer.id, reason: `The session was not ${kind === "delete-archived" ? "deleted" : kind === "archive" ? "archived" : "restored"}.` }] : []),
        unansweredIds: answers.flatMap((answer) => answer.result === "unanswered" ? [answer.id] : []),
      };
    },
    apply: async (action) => {
      const ids = action.targets.map((target) => target.id);
      const confirmedAction = { ...action, phase: "confirmed" as const };
      boards.update(action.machineId, (board) => ({
        ...board,
        sessions: sessionsWithInstantActions(board.sessions, action.machineId, [confirmedAction]),
        ...(board.pinnedElsewhere === undefined ? {} : { pinnedElsewhere: sessionsWithInstantActions(board.pinnedElsewhere, action.machineId, [confirmedAction]) }),
      }));
      if (kind === "archive") await sessions.applyArchivedSessions(ids, action.machineId, action.pressedAt);
      else if (kind === "restore") await sessions.applyRestoredSessions(ids, action.machineId);
      else await sessions.applyDeletedSessions(ids, action.machineId);
      await boards.read(action.machineId, { force: true });
    },
  };
}

function projectExecutor(projects: ProjectMutationController, api: ProjectActionApi): InstantKindExecutor {
  return {
    send: async (action, keepalive) => {
      const answers: InstantAnswer[] = [];
      for (const target of action.targets) {
        try {
          await api.closeProject(target.id, action.machineId, keepalive ? { keepalive: true } : undefined);
          answers.push({ doneIds: [target.id], refused: [], unansweredIds: [] });
        } catch (error) {
          answers.push(failedAnswer([target.id], error, describeError(error)));
        }
      }
      return mergedAnswers(answers);
    },
    read: async (action) => {
      const listed = await api.projects(action.machineId).catch(() => undefined);
      if (listed === undefined) return unanswered(action);
      const ids = new Set(listed.map((project) => project.id));
      return { doneIds: action.targets.filter((target) => !ids.has(target.id)).map((target) => target.id), refused: [], unansweredIds: [] };
    },
    apply: (action) => {
      for (const target of action.targets) projects.applyClosedProject(target.id, action.machineId);
      return Promise.resolve();
    },
  };
}

export function createWorkspaceInstantActions(
  sessions: SessionMutationController,
  boards: SessionBoardReader,
  projects: ProjectMutationController,
  changed: (actions: readonly InstantAction[], undoAvailable: boolean) => void,
  notice: (text: string) => void,
  projectApi: ProjectActionApi = projectsApi,
): InstantActionController {
  const unsupported: InstantKindExecutor = {
    send: (action) => Promise.resolve(unanswered(action)),
    read: (action) => Promise.resolve(unanswered(action)),
    apply: () => Promise.resolve(),
  };
  const sessionKinds = {
    archive: sessionExecutor(sessions, boards, "archive"),
    restore: sessionExecutor(sessions, boards, "restore"),
    "delete-archived": sessionExecutor(sessions, boards, "delete-archived"),
  };
  const closeProject = projectExecutor(projects, projectApi);
  const executors: Record<InstantActionKind, InstantKindExecutor> = {
    archive: sessionKinds.archive,
    restore: sessionKinds.restore,
    "delete-archived": sessionKinds["delete-archived"],
    "close-project": closeProject,
    "remove-machine": unsupported,
    "remove-package": unsupported,
    "remove-page-access": unsupported,
    "cleanup-run": unsupported,
    "delete-workspace": unsupported,
  };
  const controller = new InstantActionController({
    executors,
    notice: (text) => { notice(text); },
    changed: () => { changed(controller.list(), controller.bar("none") !== undefined); },
  });
  return controller;
}

export function projectActionTarget(project: Project) {
  return { id: project.id, label: project.name, projectId: project.id, workspacePath: project.path };
}

export function projectCloseAdmission(machineRuntime: MachineRuntime | undefined) {
  return instantAdmission("close-project", {
    machine: machineRuntime === undefined ? CHECKING_REACHABILITY : runtimeAvailability(machineRuntime),
    daemon: CHECKING_REACHABILITY,
  });
}

export function sessionActionTarget(session: SessionInfo, workspaces: readonly Workspace[]) {
  const workspace = workspaces.find((candidate) => sessionLocationVerdict(session.cwd, candidate.path) === "described");
  const name = session.name?.trim();
  const firstMessage = session.firstMessage;
  const label = name !== undefined && name !== "" ? name : firstMessage !== "" ? firstMessage : "Untitled session";
  return { id: session.id, label, projectId: workspace?.projectId, workspacePath: session.cwd };
}

export function sessionActionIsPending(actions: readonly InstantAction[], machineId: string, sessionId: string): boolean {
  return actions.some((action) => action.machineId === machineId && action.targets.some((target) => target.id === sessionId));
}

export function projectActionIsPending(actions: readonly InstantAction[], machineId: string, projectId: string): boolean {
  return actions.some((action) => action.kind === "close-project" && action.machineId === machineId && action.targets.some((target) => target.id === projectId));
}
