
/**
 * When a finished task deserves a device notification, said once.
 *
 * The reader turned notifications on to hear about a task they are not watching. So the falling
 * edge of a turn is not enough on its own: a notification for work that finished while the page was
 * in front of them tells them nothing, and one for a run they stopped themselves tells them they
 * stopped it. The states are named here, in one classifier, so the caller stays a dumb executor and
 * an unhandled state is a type error rather than a silent notification.
 */
export interface TaskCompletionFacts {
  /** The session was working on the previous frame. */
  readonly wasWorking: boolean;
  /** The session is working on this frame. */
  readonly isWorking: boolean;
  /** The reader's own Stop cut the run that ended. */
  readonly stoppedByReader: boolean;
  /** The reader is looking at this page: it is visible and focused. */
  readonly readerWatching: boolean;
  /** The reader asked for these notifications on this device. */
  readonly enabled: boolean;
}

/** Why a finished turn is not worth a notification, or `notify` when it is. */
export type TaskCompletionVerdict = "notify" | "not-working" | "reader-watching" | "stopped-by-reader" | "turned-off";

export function taskCompletionVerdict(facts: TaskCompletionFacts): TaskCompletionVerdict {
  if (!facts.wasWorking || facts.isWorking) return "not-working";
  if (!facts.enabled) return "turned-off";
  if (facts.stoppedByReader) return "stopped-by-reader";
  if (facts.readerWatching) return "reader-watching";
  return "notify";
}
