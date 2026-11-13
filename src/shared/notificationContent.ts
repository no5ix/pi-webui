import { runDuration } from "./runDuration.js";
import { askUserQuestionCount, isQuestionnaireCard, type TaskRunOutcome } from "./notificationEvents.js";
import type { PendingExtensionDialog } from "./apiTypes.js";

/**
 * The words of a notification, written once.
 *
 * Two paths post notices: the page that has the session open, and the session daemon pushing to
 * devices whose browser is closed. They report the same event, so they must say the same thing about
 * it - the same title, the same verdict, the same measured span - and a reader who gets both is
 * entitled to notice that a sentence they read on the phone is not the sentence on the laptop.
 *
 * What differs is what each path knows. The daemon knows the project the session is in; a page knows
 * only the session. A page knows whether it watched the whole run. So the shared builder takes the
 * facts each path has and leaves out the sentence it has no fact for: it never invents a project name,
 * and it never says "finished" about an end nothing confirmed.
 */

/** How long the first line of a failure may be in a notification centre. */

/**
 * What a finished task is reported as.
 *
 * `unconfirmed` is the page's own verdict - it saw a session go quiet with no evidence of how the run
 * ended - and it is a real answer, not a completed one. The daemon never has it: it mints notices only
 * from a run end it decided itself.
 */
export type NoticeVerdict = TaskRunOutcome | "unconfirmed";

export interface TaskNoticeFacts {
  readonly sessionName: string;
  readonly verdict: NoticeVerdict;
  /** The run's span. Absent when the party writing the notice never saw the run open. */
  readonly elapsedMs: number | undefined;
  /** The project folder the session is in, when this party knows it. */
  readonly projectName?: string;
  /** This party watched part of the run only, and says so. */
  readonly partial?: boolean;
  /** Say what to do next. Both paths do, today; a surface that has its own affordance can pass false. */
  readonly callToAction?: boolean;
}

export interface NoticeLines {
  readonly title: string;
  readonly body: string;
}

/** A session's name in the notification centre, with a noun for the session that has none. */
export function noticeSessionTitle(sessionName: string): string {
  const trimmed = sessionName.trim();
  return trimmed === "" ? "A pi session" : trimmed;
}

/**
 * The two lines a finished task is reported with.
 *
 * The span is said only when it was measured; the project only when it is known; the error's first
 * line only when there is one. A notice is read on a lock screen, so the verdict comes first and the
 * sentence that is left out is a sentence the reader is not lied to.
 */
export function taskNoticeLines(facts: TaskNoticeFacts): NoticeLines {
  const name = noticeSessionTitle(facts.sessionName);
  const span = facts.elapsedMs === undefined ? undefined : runDuration(facts.elapsedMs);
  const scope = project(facts.projectName);
  const known = scope === undefined ? [] : [scope];
  const watched = facts.partial === true ? " This page watched part of it." : "";
  if (facts.verdict === "unconfirmed") {
    return {
      title: `${name} ended`,
      body: body([span === undefined ? "This page did not see how the task ended" : `The task ran for ${span} and this page did not see how it ended`]) + watched,
    };
  }
  if (facts.verdict === "failed") {
    return {
      title: `${name} failed`,
      body: body([
        span === undefined ? "The task stopped on an error" : `Failed after ${span}`,
        ...known,
        ...(facts.callToAction === false ? [] : ["Open PI WEB to read what went wrong"]),
      ]) + watched,
    };
  }
  if (facts.verdict === "cancelled") {
    return {
      title: `${name} stopped`,
      body: body([
        span === undefined ? "The task stopped" : `Stopped after ${span}`,
        ...known,
        ...(facts.callToAction === false ? [] : ["Open PI WEB to see where it left off"]),
      ]) + watched,
    };
  }
  return {
    title: `${name} finished`,
    body: body([
      span === undefined ? "The task is done" : `Finished in ${span}`,
      ...known,
      ...(facts.callToAction === false ? [] : ["Open PI WEB to read the answer"]),
    ]) + watched,
  };
}

/** One sentence per known fact, in the order a reader meets them. */
function body(parts: readonly string[]): string {
  return parts.map((part) => (part.endsWith(".") ? part : `${part}.`)).join(" ");
}

/** The project the session is in, said as the fewest words that help a reader pick the right session. */
function project(projectName: string | undefined): string | undefined {
  const trimmed = projectName?.trim() ?? "";
  return trimmed === "" ? undefined : trimmed;
}

/**
 * The two lines a session parked on an answer is reported with.
 *
 * A declared card of question fields is a questionnaire, and a questionnaire can be counted: pi-ask-user
 * asks three questions, and the reader wants to know that before they open the laptop. `ctx.ui.confirm`,
 * `select`, `input` and `editor`, and a card that presents something rather than asks, ask one thing -
 * and are reported as waiting for an answer, not as a questionnaire with a count the reader cannot check.
 */
export function askingNoticeLines(facts: {
  readonly sessionName: string;
  readonly dialogs: readonly PendingExtensionDialog[];
  readonly projectName?: string;
  readonly callToAction?: boolean;
}): NoticeLines & { questionCount: number | undefined } {
  const name = noticeSessionTitle(facts.sessionName);
  const questionCards = facts.dialogs.filter((dialog) => isQuestionnaireCard(dialog));
  const questions = questionCards.reduce((total, dialog) => total + askUserQuestionCount(dialog), 0);
  const known = project(facts.projectName);
  const closing = facts.callToAction === false ? [] : ["Open PI WEB to answer"];
  if (questions === 0) {
    return {
      title: `${name} is waiting for you`,
      body: body(["It is waiting for an answer", ...(known === undefined ? [] : [known]), ...closing]),
      questionCount: undefined,
    };
  }
  const asked = questions === 1 ? "One question is" : `${String(questions)} questions are`;
  return {
    title: `${name} is asking`,
    body: body([`${asked} waiting`, ...(known === undefined ? [] : [known]), ...closing]),
    questionCount: questions,
  };
}

