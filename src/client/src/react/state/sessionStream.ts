import { useEffect } from "react";
import { sessionsApi } from "../../api/clients";
import { SessionSocket, parseSessionSocketEvent } from "../../sessionSocket";
import { ChatTranscriptStore } from "../../chatTranscriptStore";
import type { ChatLine } from "../../components/shared";
import type { SessionActivity, SessionRef, SessionStatus, SessionUiEvent } from "../../../../shared/apiTypes";
import { createStore, useStoreSelect, type Store } from "./store";

/**
 * One session's transcript, live.
 *
 * The transcript is built by the modules that already owned it: history pages
 * merge through `ChatTranscriptStore` (with its span cap and its durable cache)
 * and stream frames are applied by `applyTranscriptEvent`. This file only owns
 * the socket's lifecycle, the page boundaries, and the honest connection state
 * — including the "gap" state, where a frame was missed and the transcript is
 * being repaired, which is never shown as a live stream.
 */
export const TRANSCRIPT_PAGE_SIZE = 120;

export interface SessionStreamSnapshot {
  readonly key: string;
  readonly session: SessionRef | undefined;
  readonly messages: readonly ChatLine[];
  readonly pageStart: number;
  readonly pageEnd: number;
  readonly total: number;
  readonly status: SessionStatus | undefined;
  readonly activity: SessionActivity | undefined;
  readonly loading: boolean;
  readonly loadingOlder: boolean;
  readonly loadingNewer: boolean;
  readonly connection: "idle" | "opening" | "live" | "gap" | "closed" | "failed";
  readonly error: string | undefined;
}

export const blankStream: SessionStreamSnapshot = {
  key: "",
  session: undefined,
  messages: [],
  pageStart: 0,
  pageEnd: 0,
  total: 0,
  status: undefined,
  activity: undefined,
  loading: false,
  loadingOlder: false,
  loadingNewer: false,
  connection: "idle",
  error: undefined,
};

export const streamStore: Store<SessionStreamSnapshot> = createStore<SessionStreamSnapshot>(blankStream);

export function useSessionStream(): SessionStreamSnapshot {
  return useStoreSelect(streamStore, (value) => value);
}

export function streamKey(session: SessionRef, machineId: string): string {
  return `${machineId}::${session.id}`;
}

const quietWindowSeconds = (): number => 300;

class SessionStreamRuntime {
  private readonly transcripts = new ChatTranscriptStore();
  private readonly socket = new SessionSocket(quietWindowSeconds);
  private key = "";
  private session: SessionRef | undefined;
  private machineId = "local";
  private lastSeq: number | undefined;
  private epoch: string | undefined;
  private generation = 0;

  open(session: SessionRef, machineId: string): void {
    const key = streamKey(session, machineId);
    if (this.key === key) return;
    const generation = ++this.generation;
    this.key = key;
    this.session = session;
    this.machineId = machineId;
    this.lastSeq = undefined;
    this.epoch = undefined;
    this.socket.close();

    const cached = this.transcripts.cachedView(session.id);
    streamStore.set({
      ...blankStream,
      key,
      session,
      messages: cached.messages,
      pageStart: cached.messagePageStart,
      pageEnd: cached.messagePageEnd,
      total: cached.messagePageTotal,
      loading: true,
      connection: "opening",
    });

    this.socket.connect(session, machineId, {
      onEvent: (event) => {
        if (this.key !== key) return;
        if (event.seq !== undefined) this.lastSeq = event.seq;
        if (event.epoch !== undefined) this.epoch = event.epoch;
        if (event.type === "status.update") {
          streamStore.update((current) => ({ ...current, status: event.status }));
          return;
        }
        if (event.type === "activity.update") {
          streamStore.update((current) => ({ ...current, activity: event.activity }));
          return;
        }
        streamStore.update((current) => {
          const next = this.transcripts.applyLiveEvent([...current.messages], event);
          if (next === undefined) return current;
          return { ...current, messages: next };
        });
        this.socket.noteApplied(event.seq ?? 0);
      },
      onInitialOpen: () => {
        // The socket is open: the stream is live from this moment, and a read that
        // follows fills the history. Leaving the state at "opening" after a
        // successful join made the panel announce a stream that was still starting
        // above a transcript that was already on screen and updating.
        streamStore.update((current) => ({ ...current, connection: "live" }));
        void this.read(generation, "join");
      },
      onReconnect: () => {
        streamStore.update((current) => ({ ...current, connection: "live" }));
        void this.resync(generation);
      },
      onGap: (lastSeen) => {
        streamStore.update((current) => ({ ...current, connection: "gap" }));
        void this.resync(generation, lastSeen);
      },
      onDisconnect: () => {
        if (this.key !== key) return;
        // A stream that was open and fell over is a gap: frames were missed and
        // the resync repairs them. A stream that closed before it opened — a
        // stored session with no running runtime, a daemon that hung up — is
        // closed: the transcript on screen is the machine's stored history, and
        // leaving the state at "opening" announced a stream that was never
        // starting over a transcript that was already readable.
        streamStore.update((current) => ({
          ...current,
          connection: current.connection === "live" ? "gap" : current.connection === "opening" ? "closed" : current.connection,
        }));
      },
      onQuiet: () => {
        void this.resync(generation);
      },
      onMalformed: () => {
        void this.resync(generation);
      },
    });
  }

  close(): void {
    this.generation += 1;
    this.key = "";
    this.session = undefined;
    this.socket.close();
    streamStore.set(blankStream);
  }

  /**
   * Publish a status the shell just caused — a model change, a cleared queue,
   * an abort. The machine sends the same status on the socket; applying the
   * answer the command returned keeps the footer honest between the click and
   * that frame.
   */
  applyStatus(status: SessionStatus): void {
    if (this.key === "") return;
    streamStore.update((current) => ({ ...current, status }));
  }

  /** Read the newest page, the session's status, and the in-flight partial. */
  private async read(generation: number, intent: "join" | "newest" | "older" | "newer" = "newest", options: { before?: number } = {}): Promise<void> {
    const session = this.session;
    const machineId = this.machineId;
    if (session === undefined) return;
    const paging = intent === "older" ? { loadingOlder: true } : intent === "newer" ? { loadingNewer: true } : {};
    streamStore.update((current) => ({ ...current, ...paging }));
    try {
      const page = await sessionsApi.messages(session, { limit: TRANSCRIPT_PAGE_SIZE, ...(options.before === undefined ? {} : { before: options.before }) }, machineId);
      if (generation !== this.generation) return;
      const view = this.transcripts.mergeHistory(session.id, { messages: page.messages, start: page.start, total: page.total }, intent === "older" || intent === "newer" ? "neighbour" : "newest");
      streamStore.update((current) => ({
        ...current,
        messages: view.messages,
        pageStart: view.messagePageStart,
        pageEnd: view.messagePageEnd,
        total: page.total,
        loading: false,
        loadingOlder: false,
        loadingNewer: false,
        error: undefined,
      }));
      if (intent === "join") void this.readJoinState(generation, session, machineId);
    } catch (error) {
      if (generation !== this.generation) return;
      streamStore.update((current) => ({
        ...current,
        loading: false,
        loadingOlder: false,
        loadingNewer: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  private async readJoinState(generation: number, session: SessionRef, machineId: string): Promise<void> {
    try {
      const [status, snapshot] = await Promise.all([sessionsApi.status(session, machineId), sessionsApi.streamSnapshot(session, machineId)]);
      if (generation !== this.generation) return;
      streamStore.update((current) => {
        const seeded = snapshot.partial === undefined ? current.messages : this.transcripts.seedStreamingPartial([...current.messages], snapshot.partial);
        return { ...current, status, messages: seeded };
      });
    } catch {
      // A join state that did not answer leaves the transcript at the committed
      // history; the status keeps arriving on the socket.
    }
  }

  /** A frame was missed: rebuild from the daemon's own history, never patch a guess. */
  private async resync(generation: number, sinceSeq?: number): Promise<void> {
    const session = this.session;
    const machineId = this.machineId;
    if (session === undefined) return;
    try {
      if (sinceSeq !== undefined) {
        const sync = await sessionsApi.streamSync(session, sinceSeq, machineId, this.epoch);
        if (generation !== this.generation) return;
        if (sync.kind === "replay") {
          const frames = sync.frames
            .map((frame) => {
              const parsed: unknown = JSON.parse(frame);
              return parseSessionSocketEvent(parsed);
            })
            .filter((frame): frame is SessionUiEvent => frame !== undefined && frame.type !== "status.update" && frame.type !== "activity.update");
          streamStore.update((current) => {
            let messages = [...current.messages];
            for (const frame of frames) {
              const applied = this.transcripts.applyLiveEvent(messages, frame);
              if (applied !== undefined) messages = applied;
            }
            return { ...current, messages, connection: "live" };
          });
          return;
        }
        if (sync.kind === "snapshot") {
          this.lastSeq = sync.seq;
          streamStore.update((current) => ({
            ...current,
            messages: sync.partial === undefined ? current.messages : this.transcripts.seedStreamingPartial([...current.messages], sync.partial),
            connection: "live",
          }));
          return;
        }
      }
      await this.read(generation, "newest");
      if (generation !== this.generation) return;
      streamStore.update((current) => ({ ...current, connection: "live" }));
    } catch {
      if (generation !== this.generation) return;
      streamStore.update((current) => ({ ...current, connection: "failed", error: "The transcript could not be repaired." }));
    }
  }

  loadOlder(): void {
    const current = streamStore.get();
    if (current.pageStart <= 0 || current.loadingOlder) return;
    void this.read(this.generation, "older", { before: current.pageStart });
  }

  loadNewer(): void {
    const current = streamStore.get();
    if (current.pageEnd >= current.total || current.loadingNewer) return;
    void this.read(this.generation, "newer", { before: current.total });
  }

  /** After a command that rewrites history (`/new`, a tree navigation, a fork). */
  refresh(): void {
    void this.read(this.generation, "newest");
  }

  /** A prompt this device sent: the row appears at once and carries its delivery mark. */
  echoLocalPrompt(line: ChatLine): void {
    streamStore.update((current) => ({ ...current, messages: [...current.messages, line] }));
  }
}

export const streamRuntime = new SessionStreamRuntime();

/** Open one session's stream for as long as the component is mounted on it. */
export function useSessionStreamSession(session: SessionRef | undefined, machineId: string): void {
  useEffect(() => {
    if (session === undefined) {
      streamRuntime.close();
      return;
    }
    streamRuntime.open(session, machineId);
  }, [session?.id, session?.cwd, machineId]);
}
