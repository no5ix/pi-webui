import { askingNoticeLines, taskNoticeLines } from "../../../shared/notificationContent";
import type { PendingExtensionDialog } from "../../../shared/apiTypes";
import type { TaskRunRecord } from "../taskRunLedger";
import { taskRunVerdict } from "../taskRunLedger";

/**
 * What the page posts to the notification centre, for the two events it knows about.
 *
 * The sentences are the shared ones (`shared/notificationContent.ts`), the same the session daemon
 * pushes to devices whose browser is closed, so a reader is not told two things about one event. The
 * page has two facts the daemon does not: whether it watched the whole run, and the run's verdict when
 * nothing confirmed its end. `unconfirmed` is a verdict the page is allowed to have - it saw a session
 * go quiet with no evidence of how the run ended - and it says the run ended without claiming a verdict,
 * because a notice that says "finished" for a run that is between two turns teaches a reader to ignore
 * notices.
 */

export interface DeviceNotice {
  readonly title: string;
  readonly body: string;
}

/** The task notice's two lines, from the finished run the page measured. */
export function taskNoticeContent(sessionName: string, record: TaskRunRecord): DeviceNotice {
  return taskNoticeLines({
    sessionName,
    verdict: taskRunVerdict(record),
    elapsedMs: record.elapsedMs,
    partial: record.partial,
  });
}

/**
 * The notice for a session parked on an answer.
 *
 * The count is the shared classifier's over every dialog that is open, so a phone and a laptop report
 * the same number of questions for the same questionnaire - and a dialog that asks one thing is
 * reported as waiting for an answer rather than as a questionnaire with a count.
 */
export function askUserNoticeContent(sessionName: string, dialogs: readonly PendingExtensionDialog[]): DeviceNotice & { questionCount: number | undefined } {
  return askingNoticeLines({ sessionName, dialogs });
}
