/**
 * How long a task ran, measured on the device that watched it.
 *
 * The transcript cannot answer this. Its rows carry the stamp of the moment the entry was written,
 * and a prompt and the reply it produced are stamped within milliseconds of each other - measured
 * over a real session, the "duration" of a two-minute turn came out as 14 ms. The daemon's activity
 * dock clocks a turn while it works and leaves when it ends, so the one clock that sees the whole
 * span is the page that watched the session go from working to finished.
 *
 * The span is therefore measured here, in wall time on this device, from the rising edge of a
 * session's work to its falling edge. The last finished number is kept per machine and session in
 * this browser, because the question "how long did that take?" is often asked after a reload, and a
 * number that only lived in the page that saw the finish would be gone.
 *
 * A page that opens on a session already working joined the task partway: the caller says so, and the
 * finished turn carries `partial`, so the surface that shows the number can say it watched only part
 * of the task instead of claiming the whole of it.
 */

const STORAGE_PREFIX = "pi-web-turn";

export interface TurnRun {
  /** When this device saw the session start working. */
  readonly startedAt: number;
  /** True when the clock began on a session already working, so the span is partial. */
  readonly startedWhileWorking: boolean;
  /**
   * True when the span is counted from the reader's own send because the status feed was silent at
   * that moment. A page that reloads across a daemon outage would otherwise measure the outage as
   * part of the task, so such a run is measured and reported as not a clean measurement.
   */
  readonly fromAction: boolean;
}

export interface FinishedTurn {
  readonly durationMs: number;
  readonly finishedAt: number;
  readonly partial: boolean;
}

export class TurnRunClock {
  private readonly runs = new Map<string, TurnRun>();

  /**
   * Called when a session is seen working. The first edge of a run is the one that starts the clock.
   *
   * `partial` is the caller's fact, not the clock's: only the caller knows whether this is a task
   * that started under its eyes or a page that opened onto a task already running.
   */
  sawWorking(key: string, options: { partial?: boolean; fromAction?: boolean } = {}): void {
    if (this.runs.has(key)) return;
    this.runs.set(key, { startedAt: now(), startedWhileWorking: options.partial === true, fromAction: options.fromAction === true });
  }

  /**
   * Called when a session this device saw working is seen finished.
   *
   * Returns nothing when no run was open, so a caller that replays a falling edge (a reload that
   * lands on an idle session) is not handed a number it did not measure.
   */
  sawFinish(key: string): FinishedTurn | undefined {
    const run = this.runs.get(key);
    if (run === undefined) return undefined;
    this.runs.delete(key);
    const finished: FinishedTurn = {
      durationMs: Math.max(0, now() - run.startedAt),
      finishedAt: now(),
      partial: run.startedWhileWorking || run.fromAction,
    };
    rememberFinished(key, finished);
    return finished;
  }

  /** The last finished turn of a session, measured here or kept by an earlier visit to this browser. */
  lastFinished(key: string): FinishedTurn | undefined {
    return storedFinished(key);
  }

}

function now(): number {
  return Date.now();
}

function storageKey(key: string): string {
  return `${STORAGE_PREFIX}/${key}`;
}

/** The two storage calls the clock makes, probed rather than assumed. */
interface SmallStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * This browser's localStorage, when it has one.
 *
 * The `Storage` constructor is not referenced: an environment that provides a storage object without
 * that global - the DOM harness among them - throws on the reference, and the reference sat on the
 * render path of every status bar.
 */
function storage(): SmallStore | undefined {
  const candidate: unknown = Reflect.get(globalThis, "localStorage");
  return isSmallStore(candidate) ? candidate : undefined;
}

function isSmallStore(value: unknown): value is SmallStore {
  if (typeof value !== "object" || value === null) return false;
  return typeof Reflect.get(value, "getItem") === "function" && typeof Reflect.get(value, "setItem") === "function";
}

function rememberFinished(key: string, finished: FinishedTurn): void {
  storage()?.setItem(storageKey(key), JSON.stringify(finished));
}

function storedFinished(key: string): FinishedTurn | undefined {
  const store = storage();
  if (store === undefined) return undefined;
  return parseStored(store.getItem(storageKey(key)));
}

function parseStored(value: string | null): FinishedTurn | undefined {
  if (value === null) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const durationMs: unknown = Reflect.get(parsed, "durationMs");
    const finishedAt: unknown = Reflect.get(parsed, "finishedAt");
    if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs < 0) return undefined;
    if (typeof finishedAt !== "number" || !Number.isFinite(finishedAt)) return undefined;
    return { durationMs, finishedAt, partial: Reflect.get(parsed, "partial") === true };
  } catch {
    return undefined;
  }
}
