import type { SessionInfo } from "../api";
import { InstantActionController, type InstantKindExecutor } from "../controllers/instantActionController";
import { sessionsWithInstantActions, type InstantAction, type InstantActionKind, type InstantAnswer } from "../instantActions";
import type { SessionController } from "../controllers/sessionController";
import type { SessionBoardController } from "../controllers/sessionBoardController";
import type { Workspace } from "../api";
import { sessionLocationVerdict } from "../sessionLocationVerdict";
import { failedAnswer } from "../instantActions";
import { describeError } from "../notice";

const unanswered = (action: InstantAction): InstantAnswer => ({ doneIds: [], refused: [], unansweredIds: action.targets.map((target) => target.id) });

type SessionMutationController = Pick<SessionController, "archiveSessions" | "applyArchivedSessions" | "restoreSessions" | "applyRestoredSessions" | "deleteArchivedSessions" | "applyDeletedSessions">;
type SessionBoardReader = Pick<SessionBoardController, "readWhole" | "read" | "update">;

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

export function createSessionInstantActions(
  sessions: SessionMutationController,
  boards: SessionBoardReader,
  changed: (actions: readonly InstantAction[], undoAvailable: boolean) => void,
  notice: (text: string) => void,
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
  const executors: Record<InstantActionKind, InstantKindExecutor> = {
    archive: sessionKinds.archive,
    restore: sessionKinds.restore,
    "delete-archived": sessionKinds["delete-archived"],
    "close-project": unsupported,
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
