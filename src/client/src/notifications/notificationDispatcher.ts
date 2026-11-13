import { notificationContent } from "../../../shared/notificationEvents";
import type { NotificationEvent } from "../../../shared/ntfy";
import { notifyTaskFinished, taskNotificationsWanted } from "./taskNotifications";

/**
 * The browser's channel, and the honest word about what it did.
 *
 * PI WEB now has two notification providers, and they are configured and delivered apart on purpose.
 * ntfy is posted by the session daemon, so it reaches a phone with no browser open; the browser's own
 * notice is posted by this page, through a service worker registration, because Safari on macOS and iOS
 * shows no web notification that is not posted that way. Neither one can stop the other: this module
 * never talks to ntfy, the daemon never posts to a browser, and a reader who turned one off gets the
 * other.
 *
 * The rule this module exists to enforce is the honest one. A page-posted notification is not shown
 * while the page is focused, and it is not shown at all where the permission is denied, so a page that
 * calls `showNotification` and reports "notified" is describing a notification centre it did not reach.
 * So the delivery is reported as one of four things, and where the reader is looking at the page and the
 * centre took nothing, the same words go to the page's own notice row instead - the reader asked to be
 * told, and a notice they can see is the truth of that.
 */
export type ProviderDelivery = "system" | "in-page" | "skipped" | "failed";

export interface SessionEventNotice {
  readonly event: NotificationEvent;
  /** The session the notice speaks about; it is what a tap opens. */
  readonly sessionId: string;
  /**
   * The machine the session was read from. Session ids are per daemon, so the same id can be live on
   * two machines; a notice that replaces another machine's notice tells the reader about a task they
   * are not watching (2026-11-13).
   */
  readonly machineId?: string;
  readonly sessionName: string;
  /** The task's span, from the server's own measurement when one is available. */
  readonly durationMs?: number;
  readonly failureReason?: string;
  readonly question?: string;
}

export interface BrowserNoticeOptions {
  /**
   * Where the notice goes when the notification centre did not take it and the page is on screen: the
   * app's own notice row. The page shows it, so the page decides how.
   */
  onInPageNotice?: (notice: { title: string; body: string }) => void;
  /** Where a tap lands. The page knows this address; that is what a browser notice is for. */
  url?: () => string;
}

/**
 * Post this event to this device's notification centre.
 *
 * The reader's switch is asked first (a device that was not told to notify is not an error). A notice
 * that the centre refused is answered by the in-page row when the page is visible, and by nothing at
 * all when it is not: the page cannot show a banner to a reader who is not looking at it, and the
 * delivery is reported as a failure rather than as a notice.
 */
export async function notifyBrowserChannel(notice: SessionEventNotice, options: BrowserNoticeOptions = {}): Promise<ProviderDelivery> {
  if (!taskNotificationsWanted()) return "skipped";
  const content = notificationContent(notice.event, {
    sessionName: notice.sessionName,
    ...(notice.durationMs === undefined ? {} : { durationMs: notice.durationMs }),
    ...(notice.failureReason === undefined ? {} : { failureReason: notice.failureReason }),
    ...(notice.question === undefined ? {} : { question: notice.question }),
  });
  const posted = await notifyTaskFinished(
    { title: content.title, body: content.message, url: options.url?.() ?? currentLocation() },
    // One notice per machine, session and event: a second finished task replaces the first instead of
    // stacking a pile on a phone's lock screen, and a session on another machine gets its own notice.
    `task-${notice.event}-${notice.machineId ?? "local"}-${notice.sessionId}`,
  );
  if (posted) return "system";
  if (pageVisible() && options.onInPageNotice !== undefined) {
    options.onInPageNotice({ title: content.title, body: content.message });
    return "in-page";
  }
  return "failed";
}

function pageVisible(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "visible";
}

function currentLocation(): string {
  return typeof window === "undefined" ? "" : window.location.href;
}
