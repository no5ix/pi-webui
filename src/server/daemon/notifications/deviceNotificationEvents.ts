import { askingNoticeLines, taskNoticeLines } from "../../../shared/notificationContent.js";
import type { PendingExtensionDialog } from "../../../shared/apiTypes.js";
import type { RunEnding } from "../sessions/runOutcome.js";
import type { DeviceNotificationEvent, TaskRunOutcome } from "../../../shared/notificationEvents.js";

/**
 * When a session's facts deserve a notification, said once.
 *
 * The daemon is the only party that knows a run's end is *confirmed*: its `agent_settled` handling
 * decides `completed`, `failed`, `stopped` or `interrupted` (`runOutcome.ts`), and the page's activity
 * classifier only sees a session go quiet, which happens between turns of a run that is still working.
 * So the event is minted here, from the daemon's decision, and the browser never invents a completion.
 *
 * The reader's own Stop is a cancellation. The page's notice kept quiet about it because the reader's
 * thumb did it; the server says "stopped", because a phone that is not looking at the page cannot tell
 * a stop from a crash on its own.
 *
 * The sentences themselves are the shared ones (`shared/notificationContent.ts`): a laptop and a phone
 * are told the same thing about one event, and the only fact a page has that the daemon does not is
 * the project folder, which the daemon knows and the page usually does not.
 */

/** The words of a run's end, in the order the reader meets them: which session, how it ended, how long it took. */
export interface TaskFinishedFacts {
  readonly sessionId: string;
  readonly sessionName: string;
  readonly projectName: string;
  readonly ending: RunEnding;
  /** The run's span on the daemon's clock, in milliseconds. Absent when the daemon never saw it start. */
  readonly elapsedMs: number | undefined;
  readonly occurredAt: string;
  /** The event's own identity. One run, one id; the notification's key is the shared coarser one. */
  readonly id: string;
}

/** The task event a confirmed run end produces, and the outcome the surfaces show. */
export function taskFinishedEvent(facts: TaskFinishedFacts): { event: DeviceNotificationEvent; outcome: TaskRunOutcome } {
  const outcome = runNoticeOutcome(facts.ending.outcome);
  const kind = outcome === "completed" ? "task_completed" : outcome === "failed" ? "task_failed" : "task_cancelled";
  // pi's failure text is a runtime message: it can carry a prompt, a file path, a command, or a
  // tool's argument. None of that goes into a payload that leaves this machine and sits on a push
  // service on its way to a pocket. The page has the same facts locally and shows the reason there;
  // a notice on a device says that the run failed, how long it ran, and to open PI WEB.
  const lines = taskNoticeLines({
    sessionName: facts.sessionName,
    verdict: outcome,
    elapsedMs: facts.elapsedMs,
    projectName: facts.projectName,
  });
  return {
    event: {
      id: facts.id,
      kind,
      sessionId: facts.sessionId,
      sessionName: facts.sessionName,
      projectName: facts.projectName,
      occurredAt: facts.occurredAt,
      outcome,
      ...(facts.elapsedMs === undefined ? {} : { elapsedMs: facts.elapsedMs }),
      title: lines.title,
      body: lines.body,
    },
    outcome,
  };
}

/**
 * The reader's four outcomes from the daemon's five words.
 *
 * `stopped` and `interrupted` are one thing to a device that is not looking at the page: the run is
 * over and nothing completed it.
 */
export function runNoticeOutcome(ending: RunEnding["outcome"]): TaskRunOutcome {
  if (ending === "completed") return "completed";
  if (ending === "failed") return "failed";
  return "cancelled";
}

export interface AskUserNoticeFacts {
  readonly id: string;
  readonly sessionId: string;
  readonly sessionName: string;
  readonly projectName: string;
  readonly occurredAt: string;
  readonly dialog: PendingExtensionDialog;
}

/**
 * The event a session parked on an answer produces.
 *
 * An open extension dialog is a run parked on the reader: `ctx.ui.confirm`, `select`, `input`,
 * `editor` and a declared card all block the extension's own promise until the browser answers, so the
 * dialog record is the waiting-for-input state and not a tool that happens to be running. pi-ask-user's
 * questionnaire arrives as a declared card of question fields, which is the case that carries a count;
 * a dialog that asks one thing is reported as waiting for an answer, not as a questionnaire.
 */
export function askUserEvent(facts: AskUserNoticeFacts): DeviceNotificationEvent {
  const lines = askingNoticeLines({
    sessionName: facts.sessionName,
    dialogs: [facts.dialog],
    projectName: facts.projectName,
  });
  return {
    id: facts.id,
    kind: "user_input_required",
    sessionId: facts.sessionId,
    sessionName: facts.sessionName,
    projectName: facts.projectName,
    occurredAt: facts.occurredAt,
    ...(lines.questionCount === undefined ? {} : { questionCount: lines.questionCount }),
    title: lines.title,
    body: lines.body,
  };
}
