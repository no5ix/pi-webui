import { useEffect } from "react";
import { realtimeEvents } from "../../api";
import { sessionsApi, projectsApi, workspacesApi } from "../../api/clients";
import { RealtimeSocket, type BrowserRealtimeEvent } from "../../sessionSocket";
import { boardAnswer, boardEventOf, boardWithEvent, readSessionBoard, type SessionBoard } from "../../sync/sessionBoard";
import type { SessionActivity, SessionStatus, SessionUnreadSummary } from "../../../../shared/apiTypes";
import { createStore, useStoreSelect, type Store } from "./store";

/**
 * The machine's live picture: every open project's workspaces and sessions, the
 * status and activity of each session, and what finished while the reader was
 * away.
 *
 * This is the board engine PI WEB already had (`sync/sessionBoard.ts` plus the
 * realtime socket), wrapped once. The React tree never talks to the socket
 * itself; it reads a snapshot. A source that did not answer stays "unknown" and
 * the snapshot says so — an empty list is never presented as a refusal, and a
 * refusal is never presented as empty.
 */
export interface BoardSnapshot {
  readonly phase: "loading" | "live" | "partial" | "refused" | "failed";
  readonly board: SessionBoard | undefined;
  readonly statuses: ReadonlyMap<string, SessionStatus>;
  readonly activities: ReadonlyMap<string, SessionActivity>;
  readonly unread: ReadonlyMap<string, SessionUnreadSummary>;
  readonly connection: "connecting" | "open" | "closed";
  readonly error: string | undefined;
  readonly readAt: number | undefined;
}

export const emptyBoard: BoardSnapshot = {
  phase: "loading",
  board: undefined,
  statuses: new Map(),
  activities: new Map(),
  unread: new Map(),
  connection: "connecting",
  error: undefined,
  readAt: undefined,
};

export const boardStore: Store<BoardSnapshot> = createStore<BoardSnapshot>(emptyBoard);

export function useBoard(): BoardSnapshot {
  return useStoreSelect(boardStore, (value) => value);
}

export function useBoardStatus(sessionId: string | undefined): SessionStatus | undefined {
  return useStoreSelect(boardStore, (value) => (sessionId === undefined ? undefined : value.statuses.get(sessionId)));
}

export function useBoardActivity(sessionId: string | undefined): SessionActivity | undefined {
  return useStoreSelect(boardStore, (value) => (sessionId === undefined ? undefined : value.activities.get(sessionId)));
}

const quietWindowSeconds = (): number => 300;

class BoardRuntime {
  private readonly socket = new RealtimeSocket(quietWindowSeconds);
  private machineId = "local";
  private reading: Promise<void> | undefined;
  private started = false;

  start(machineId: string): void {
    if (this.started && this.machineId === machineId) return;
    this.stop();
    this.started = true;
    this.machineId = machineId;
    boardStore.update((current) => ({ ...current, phase: "loading", board: undefined, statuses: new Map(), activities: new Map(), connection: "connecting", error: undefined }));
    this.socket.connect(
      (event) => this.apply(event),
      () => boardStore.update((current) => ({ ...current, connection: "open" })),
      machineId,
      () => {
        void this.read({ force: true });
      },
    );
    void this.read({ force: true });
    void this.readUnread();
  }

  stop(): void {
    this.started = false;
    this.socket.close();
  }

  /** Ask again for the whole board; concurrent asks collapse into the read already running. */
  read(options: { force?: boolean } = {}): Promise<void> {
    if (this.reading !== undefined && options.force !== true) return this.reading;
    const machineId = this.machineId;
    const reading = readSessionBoard({
      board: async () => await sessionsApi.sessionBoard(machineId),
      projects: async () => await projectsApi.projects(machineId),
      workspaces: async (projectId) => await workspacesApi.workspaces(projectId, machineId),
      sessions: async (cwd) => await sessionsApi.sessions(cwd, machineId),
    }).then(
      (board) => {
        if (this.machineId !== machineId) return;
        boardStore.update((current) => ({
          ...current,
          board,
          phase: boardAnswer(board) === "complete" ? "live" : "partial",
          error: undefined,
          readAt: Date.now(),
        }));
      },
      (error: unknown) => {
        if (this.machineId !== machineId) return;
        boardStore.update((current) => ({
          ...current,
          phase: current.board === undefined ? "failed" : current.phase,
          error: error instanceof Error ? error.message : String(error),
        }));
      },
    ).finally(() => {
      if (this.reading === reading) this.reading = undefined;
    });
    this.reading = reading;
    return reading;
  }

  private async readUnread(): Promise<void> {
    const machineId = this.machineId;
    try {
      const catalog = await sessionsApi.unreadCatalog(machineId);
      if (this.machineId !== machineId) return;
      const unread = new Map<string, SessionUnreadSummary>();
      for (const summary of catalog.sessions) unread.set(summary.sessionId, summary);
      boardStore.update((current) => ({ ...current, unread }));
    } catch {
      // An unanswered unread catalog leaves the previous unread map in place:
      // "unknown" is not "nothing is unread".
    }
  }

  private apply(event: BrowserRealtimeEvent): void {
    boardStore.update((current) => {
      const next = { ...current };
      const boardEvent = boardEventOf(event);
      if (boardEvent !== undefined && current.board !== undefined) next.board = boardWithEvent(current.board, boardEvent);
      if (event.type === "status.update") {
        const statuses = new Map(current.statuses);
        statuses.set(event.status.sessionId, event.status);
        next.statuses = statuses;
      } else if (event.type === "activity.update") {
        const activities = new Map(current.activities);
        activities.set(event.activity.sessionId, event.activity);
        next.activities = activities;
      } else if (event.type === "sessions.unread") {
        const unread = new Map(current.unread);
        const summary = event.unread;
        if (summary === null) unread.delete(event.sessionId);
        else unread.set(event.sessionId, summary);
        next.unread = unread;
      }
      if (event.type === "pins.changed" || event.type === "workspace.changed" || event.type === "plugins.changed") {
        void this.read();
      }
      return next;
    });
  }
}

export const boardRuntime = new BoardRuntime();

/** The page keeps one machine's board live for as long as it shows it. */
export function useBoardMachine(machineId: string): void {
  useEffect(() => {
    boardRuntime.start(machineId);
    const onVisible = (): void => {
      if (document.visibilityState === "visible") void boardRuntime.read();
    };
    const onOnline = (): void => {
      void boardRuntime.read({ force: true });
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, [machineId]);
}
