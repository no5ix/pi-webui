import { runDuration } from "./runDuration";
import type { SessionRunOutcome } from "../../shared/pluginApiTypes";
import { isRecord } from "../../shared/unknownValues";

/**
 * The last task each session ran, as this browser watched it, kept after the work is over.
 *
 * The bottom status line answers "how long did that take?" once the activity dock has gone away, and
 * it answers from here. The span comes from `SessionRunWatch`, which is the page's one task
 * lifecycle: it opens a run when it saw one start and closes it with an outcome the frames support
 * (design 4.B). The live counter above it stays in `ChatView`, driven by the session's own working
 * state, and the 10-minute long-turn highlight stays there too: those two answer "is it still going,
 * and is it taking a long time?", which is a different question from "what did the finished run
 * cost", and neither is allowed to decide the other.
 *
 * A run that ended on `unknown` is kept as unconfirmed. The page can lose a run's stream, leave the
 * session, or land on a session that was already working, and then it has no evidence of how the run
 * ended; the line says the run ended and shows no verdict, and no notification goes out for it.
 * Treating a session that merely went quiet as completed is how a reader learns to distrust the
 * notice, so completion is only ever claimed on evidence.
 *
 * Entries are keyed by machine and session and kept in this browser, because the question is usually
 * asked after a reload, and a number that lived only in the page that saw the finish would be gone.
 */

const STORAGE_PREFIX = "pi-web-task-run";

/** What one finished run is worth to the reader. */
export interface TaskRunRecord {
  readonly outcome: SessionRunOutcome;
  /** The span this device measured, in milliseconds. */
  readonly elapsedMs: number;
  readonly finishedAtMs: number;
  /** The page did not hold the run from its start, so the span is a lower bound. */
  readonly partial: boolean;
}

/** What the surfaces show. `unconfirmed` is the honest answer when the page has no evidence. */
export type TaskRunVerdict = "completed" | "failed" | "cancelled" | "unconfirmed";

export function taskRunVerdict(record: TaskRunRecord): TaskRunVerdict {
  if (record.outcome === "unknown") return "unconfirmed";
  if (record.outcome === "completed") return "completed";
  if (record.outcome === "failed") return "failed";
  return "cancelled";
}

/** The run as the status line says it: the verdict, then the time it took. */
export function taskRunStatusText(record: TaskRunRecord): { text: string; title: string } {
  const span = runDuration(record.elapsedMs);
  const verdict = taskRunVerdict(record);
  const watched = record.partial ? " (this page watched part of it)" : "";
  if (verdict === "completed") return { text: `took ${span}`, title: `The page measured ${span} from seeing this task start to seeing it finish${watched}.` };
  if (verdict === "failed") return { text: `failed after ${span}`, title: `The page measured ${span} from seeing this task start to seeing it fail${watched}.` };
  if (verdict === "cancelled") return { text: `stopped after ${span}`, title: `The page measured ${span} from seeing this task start to seeing it stop${watched}.` };
  return { text: "ended", title: `The last task ended. This page did not see how it ended${record.partial ? " and joined it partway" : ""}.` };
}

/**
 * The finished runs of a device.
 *
 * It answers only about runs that have finished; the run in flight is the dock's, and the ledger
 * never grows while a task works.
 */
export class TaskRunLedger {
  private cached: Map<string, TaskRunRecord> | undefined;

  /** A run closed. The frozen span replaces the previous one for that session. */
  record(key: string, record: TaskRunRecord): void {
    const runs = this.read();
    runs.set(key, record);
    this.write(runs);
  }

  /** A new task started: its finished run stops being the answer to "how long did that take?". */
  clear(key: string): void {
    const runs = this.read();
    if (!runs.has(key)) return;
    runs.delete(key);
    this.write(runs);
  }

  last(key: string): TaskRunRecord | undefined {
    return this.read().get(key);
  }

  /** The in-memory map, seeded from this browser's storage on first use. */
  private read(): Map<string, TaskRunRecord> {
    if (this.cached !== undefined) return this.cached;
    this.cached = storedRuns();
    return this.cached;
  }

  private write(runs: Map<string, TaskRunRecord>): void {
    this.cached = runs;
    writeStoredRuns(runs);
  }
}

/**
 * The storage calls, probed rather than assumed.
 *
 * The `Storage` constructor is not referenced: an environment that provides a storage object without
 * that global - the DOM harness among them - throws on the reference, and this runs on the status
 * bar's render path.
 */
interface SmallStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  length: number;
}

function store(): SmallStore | undefined {
  const candidate: unknown = Reflect.get(globalThis, "localStorage");
  return isSmallStore(candidate) ? candidate : undefined;
}

function isSmallStore(value: unknown): value is SmallStore {
  if (typeof value !== "object" || value === null) return false;
  return typeof Reflect.get(value, "getItem") === "function"
    && typeof Reflect.get(value, "setItem") === "function"
    && typeof Reflect.get(value, "removeItem") === "function";
}

/** A machine and session id joined the way the app's own machine+session keys do. */
export function taskRunKey(machineId: string, sessionId: string): string {
  return `${machineId}\u0000${sessionId}`;
}

function storageKey(key: string): string {
  return `${STORAGE_PREFIX}/${key}`;
}

const STORED_RUN_LIMIT = 200;

function storedRuns(): Map<string, TaskRunRecord> {
  const runs = new Map<string, TaskRunRecord>();
  withStore((storage, prefix) => {
    for (const key of storedKeys(storage, prefix)) {
      const parsed = parseStored(storage.getItem(key));
      if (parsed === undefined) continue;
      runs.set(key.slice(prefix.length), parsed);
    }
  });
  return runs;
}

/**
 * Write the whole map.
 *
 * The map is bounded: the newest `STORED_RUN_LIMIT` runs are kept and every other entry of this
 * prefix loses its storage row, so a device's list cannot grow across thousands of sessions and a
 * write that prunes leaves no orphan behind. Foreign keys are left alone.
 */
function writeStoredRuns(runs: Map<string, TaskRunRecord>): void {
  withStore((storage, prefix) => {
    const entries = [...runs.entries()];
    const keep = entries.length <= STORED_RUN_LIMIT ? entries : entries.sort((a, b) => b[1].finishedAtMs - a[1].finishedAtMs).slice(0, STORED_RUN_LIMIT);
    const kept = new Set(keep.map(([key]) => storageKey(key)));
    for (const key of storedKeys(storage, prefix)) {
      if (!kept.has(key)) storage.removeItem(key);
    }
    for (const [key, record] of keep) {
      storage.setItem(storageKey(key), JSON.stringify(record));
    }
  });
}

/**
 * One read or write of this browser's storage, in the browser's terms.
 *
 * A storage that is present and throws is a real browser condition - a profile with site data
 * blocked, a quota reached, a private window - and the ledger answers a question about a finished
 * task. Losing the memory of it is the answer; throwing through the status bar's render path is not.
 */
function withStore(run: (storage: SmallStore, prefix: string) => void): void {
  const storage = store();
  if (storage === undefined) return;
  try {
    run(storage, `${STORAGE_PREFIX}/`);
  } catch {
    // Keep the in-memory map; this browser simply has no memory of its own.
  }
}

function storedKeys(storage: SmallStore, prefix: string): string[] {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key === null) continue;
    if (key.startsWith(prefix)) keys.push(key);
  }
  return keys;
}

const OUTCOMES: readonly SessionRunOutcome[] = ["completed", "stopped", "interrupted", "failed", "unknown"];
const OUTCOME_VALUES: ReadonlySet<string> = new Set(OUTCOMES);

function isOutcome(value: unknown): value is SessionRunOutcome {
  return typeof value === "string" && OUTCOME_VALUES.has(value);
}

function parseStored(value: string | null): TaskRunRecord | undefined {
  if (value === null) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed)) return undefined;
    const outcome = parsed["outcome"];
    const elapsedMs = parsed["elapsedMs"];
    const finishedAtMs = parsed["finishedAtMs"];
    if (!isOutcome(outcome)) return undefined;
    if (typeof elapsedMs !== "number" || !Number.isFinite(elapsedMs) || elapsedMs < 0) return undefined;
    if (typeof finishedAtMs !== "number" || !Number.isFinite(finishedAtMs)) return undefined;
    return { outcome, elapsedMs, finishedAtMs, partial: parsed["partial"] === true };
  } catch {
    return undefined;
  }
}
