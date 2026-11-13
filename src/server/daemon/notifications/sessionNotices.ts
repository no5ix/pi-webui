import { askUserEvent, taskFinishedEvent } from "./deviceNotificationEvents.js";
import { resolve, sep } from "node:path";
import type { DeviceNotificationEvent } from "../../../shared/notificationEvents.js";
import { isRecord } from "../../../shared/unknownValues.js";
import type { PendingExtensionDialog } from "../../../shared/apiTypes.js";
import type { RunEnding } from "../sessions/runOutcome.js";
import type { DeviceNotificationService } from "./deviceNotificationService.js";

/**
 * The session facts the notification service needs, and the notices built from them.
 *
 * `projectName` is asked of the project store, so a daemon whose project list is not loaded says so
 * with an empty name rather than inventing one: a notification that names the wrong folder is worse
 * than one that names none.
 */
export interface SessionNoticeFacts {
  projectName(cwd: string): Promise<string>;
}

export interface SessionTaskFacts {
  sessionId: string;
  sessionName: string;
  cwd: string;
  ending: RunEnding;
  /** The run's span on the daemon's clock. Absent when the daemon never saw it open. */
  elapsedMs: number | undefined;
}

export interface SessionAskFacts {
  sessionId: string;
  sessionName: string;
  cwd: string;
  dialog: PendingExtensionDialog;
}

/**
 * The project a session's working directory belongs to: the longest project folder that contains it,
 * so a worktree inside a project is named by that project. Empty means the daemon has no project for
 * it, which a notice reports as no name rather than as a folder it did not check.
 */
interface ProjectFolder {
  readonly path: string;
  readonly name: string;
}

function isProjectFolder(value: unknown): value is ProjectFolder {
  return isRecord(value) && typeof value["path"] === "string" && typeof value["name"] === "string";
}

export function projectScopeName(projects: readonly unknown[], cwd: string): string {
  if (!Array.isArray(projects) || typeof cwd !== "string" || cwd.trim() === "") return "";
  let target: string;
  try {
    target = resolve(cwd);
  } catch {
    return "";
  }
  let best: ProjectFolder | undefined;
  for (const candidate of projects) {
    if (!isProjectFolder(candidate)) continue;
    const root = resolve(candidate.path);
    if (root !== target && !target.startsWith(`${root}${sep}`)) continue;
    if (best === undefined || root.length > best.path.length) best = { path: root, name: candidate.name };
  }
  return best?.name.trim() ?? "";
}

/**
 * The notices a session produces, fired and forgotten.
 *
 * A notification is a side effect of a fact the daemon already decided, and it must never be able to
 * fail the fact: a push service that is down, a device list that cannot be read, and a notice whose
 * text could not be built are all logged and dropped. The task notices and the ask notices are built
 * by the same classifiers the page's own notice uses, so the reader is not told two different things
 * about one event.
 */
export class SessionNotices {
  private readonly now: () => Date;

  constructor(
    private readonly notifications: DeviceNotificationService,
    private readonly facts: SessionNoticeFacts,
    options: { now?: () => Date } = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }

  taskFinished(facts: SessionTaskFacts): void {
    const occurredAt = this.now();
    const id = `${facts.sessionId}:task:${String(occurredAt.getTime())}:${facts.ending.outcome}`;
    void this.facts.projectName(facts.cwd).then((projectName) => {
      const { event } = taskFinishedEvent({
        id,
        sessionId: facts.sessionId,
        sessionName: facts.sessionName,
        projectName,
        ending: facts.ending,
        elapsedMs: facts.elapsedMs,
        occurredAt: occurredAt.toISOString(),
      });
      return this.deliver(event);
    }).catch((error: unknown) => { this.failed("task", facts.sessionId, error); });
  }

  userInputRequired(facts: SessionAskFacts): void {
    const occurredAt = this.now();
    const id = `${facts.sessionId}:ask:${facts.dialog.dialogId}`;
    void this.facts.projectName(facts.cwd).then((projectName) => {
      const event = askUserEvent({
        id,
        sessionId: facts.sessionId,
        sessionName: facts.sessionName,
        projectName,
        occurredAt: occurredAt.toISOString(),
        dialog: facts.dialog,
      });
      return this.deliver(event);
    }).catch((error: unknown) => { this.failed("ask", facts.sessionId, error); });
  }

  /** A notice built for a session the page is about to show, so a test is sent the same way. */
  async testNotice(facts: SessionTaskFacts): Promise<DeviceNotificationEvent> {
    const projectName = await this.facts.projectName(facts.cwd);
    return taskFinishedEvent({
      id: `test:${facts.sessionId}:${String(this.now().getTime())}`,
      sessionId: facts.sessionId,
      sessionName: facts.sessionName,
      projectName,
      ending: { outcome: "completed" },
      elapsedMs: facts.elapsedMs,
      occurredAt: this.now().toISOString(),
    }).event;
  }

  private deliver(event: DeviceNotificationEvent): Promise<unknown> {
    return this.notifications.notify(event).then((delivery) => (delivery.deduped ? undefined : delivery));
  }

  private failed(kind: string, sessionId: string, error: unknown): void {
    console.warn(`[notifications] could not send the ${kind} notice for ${sessionId}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
