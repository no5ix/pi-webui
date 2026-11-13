import type { NotificationEvent } from "./ntfy.js";
import { runDuration } from "./duration.js";

/**
 * What a notice says, written once for every provider.
 *
 * The reader asked one question of a notification: "what happened, and where do I go?" Two providers
 * answer it - the browser's notification centre and an ntfy topic - and a phone that gets both must
 * not read two different sentences about the same task. The words are therefore decided here, out of
 * reach of both surfaces, and each provider only carries them.
 *
 * The Ask User wording names the thing the reader has to do (answer), because a notice that only says
 * "input requested" is read as a log line and left.
 */

export interface NotificationFacts {
  /** The session's own name, as the reader gave it. Empty means the notice says "a session". */
  readonly sessionName: string;
  /** How long the finished task ran, when the caller has a number worth showing. */
  readonly durationMs?: number | undefined;
  /** Why a run failed, when the caller knows. */
  readonly failureReason?: string | undefined;
  /** What is being asked, e.g. a dialog's title. */
  readonly question?: string | undefined;
}

export interface NotificationContent {
  readonly title: string;
  readonly message: string;
  /** ntfy tag emoji for the notice. */
  readonly tags: readonly string[];
}

/**
 * One notice, in the words every provider uses.
 *
 * The title carries the product and the session, because a notification centre lists notices from
 * many places and the reader reads the title first. The message carries the event and, where the
 * caller has it, the number or the question.
 */
export function notificationContent(event: NotificationEvent, facts: NotificationFacts): NotificationContent {
  const subject = facts.sessionName.trim() === "" ? "a session" : facts.sessionName.trim();
  const title = `PI WEB · ${subject}`;
  if (event === "completed") {
    const span = facts.durationMs === undefined ? "" : ` (${runDuration(facts.durationMs)})`;
    return { title, message: `Task finished${span}. Open PI WEB to read the answer.`, tags: ["white_check_mark"] };
  }
  if (event === "failed") {
    const reason = facts.failureReason === undefined || facts.failureReason.trim() === "" ? "" : `: ${facts.failureReason.trim()}`;
    return { title, message: `Task failed${reason}. Open PI WEB to see what went wrong.`, tags: ["warning"] };
  }
  const question = facts.question === undefined || facts.question.trim() === "" ? "" : `: ${facts.question.trim()}`;
  return { title, message: `Your answer is needed${question}. Open PI WEB and respond.`, tags: ["speech_balloon"] };
}

/** The session route a notice opens, in the shape the browser's own routing reads (`?session=<id>`). */
export function notificationSessionRoute(sessionId: string): string {
  return `?session=${encodeURIComponent(sessionId)}`;
}
