import type { NotificationEvent } from "../../../shared/ntfy";
import type { SessionActivityCategory } from "../../../shared/sessionActivityState";

/**
 * Which event a session's change is, said once.
 *
 * The reader asked to be told three things: a task completed, a task failed, PI WEB is asking. The
 * session's own state machine already answers all three - `sessionActivityCategory` classifies a
 * status and an activity frame into `asking`, `error`, `working`, `opening`, `background`, `idle`,
 * and every surface (the dock, the rows, the header) reads the session through it. So an event is an
 * edge between two of those categories, and the classifier below is the only place that decides it.
 *
 * Two edges are deliberately not events.
 *
 * A run the reader stopped is not worth a notice: it would only report their own action, which is the
 * rule the browser channel has followed since it existed. And leaving `asking` is not an event - the
 * reader just answered, so they are already there.
 *
 * `opening` counts as work. A session that dies while its runtime is starting is a task that failed,
 * and a notice that arrives only for turns that got as far as streaming is a notice that misses the
 * failures the reader most needs to hear about.
 */
export type NotificationEdge = NotificationEvent | "none";

export interface SessionEdgeFacts {
  /** What the session was doing on the previous frame. `undefined` means this frame is the first seen. */
  readonly previous: SessionActivityCategory | undefined;
  /** What it is doing on this frame. */
  readonly next: SessionActivityCategory | undefined;
  /** The reader's own Stop cut the run that ended. */
  readonly stoppedByReader: boolean;
}

export function notificationEdge(facts: SessionEdgeFacts): NotificationEdge {
  const { previous, next, stoppedByReader } = facts;
  if (previous === undefined || next === undefined) return "none";
  // The reader's Stop answers every event: a run they cut is not worth a notice, and the falling edge
  // can land on `asking` when a dialog opened as the run ended, which is how a notice for a run the
  // reader interrupted used to arrive (2026-11-13).
  if (stoppedByReader) return "none";
  if (next === "asking") return previous === "asking" ? "none" : "ask-user";
  if (previous === "asking") return "none";
  if (next === "error" && isWork(previous)) return "failed";
  if (next === "idle" && isWork(previous)) return "completed";
  return "none";
}

function isWork(category: SessionActivityCategory): boolean {
  return category === "working" || category === "opening" || category === "background";
}

/**
 * Whether the reader's own Stop ended the work, from the frames that say so.
 *
 * `isStopping` is the daemon's word for a run the reader stopped that is still ending; the app also
 * remembers the Stop it sent, because the falling edge often arrives on a frame that no longer carries
 * the flag.
 */
export function stoppedByReaderFacts(statusStopping: boolean | undefined, stoppedByThisReader: boolean): boolean {
  return statusStopping === true || stoppedByThisReader;
}
