import { browserLocalStorage } from "../browserLocalStorage";
import { resolveAppUrl } from "../appUrl";

/**
 * The device notification a finished task leaves in the notification centre.
 *
 * The reader asked for one thing: when the task ends, tell me, because I have left the page to do
 * something else. That is what this does, and its whole reach follows from where the notification
 * comes from: the page posts it, through a service worker registration, because Safari on macOS and
 * iOS shows no web notification that is not posted that way. So a notification arrives while this
 * browser is open - a background tab on the Mac, a backgrounded web app on the iPhone - and not
 * after the browser has been quit. Sending through Apple's push service after that needs a VAPID
 * key pair and a subscription store on the server (see docs/notifications.md); the page cannot
 * arrange that for itself.
 *
 * Two facts the UI must never blur: whether the browser allows notifications at all
 * ({@link notificationAvailability}, answered by the browser), and whether the reader wants them
 * (the stored preference, this device only). A denied permission is not a toggle that is off, and
 * an uninstalled web app on iOS is not a browser that is broken.
 */

/** Where the browser stands on notifications, as it answers - not as the page wishes. */
export type NotificationAvailability = "unsupported" | "insecure" | "unregistered" | "prompt" | "denied" | "granted";

/** What the page tells the notification centre about a task that ended. */
export interface TaskFinishedNotice {
  readonly title: string;
  readonly body: string;
  /** Where the tap lands: the session the notice speaks about. */
  readonly url: string;
}

const PREFERENCE_KEY = "pi-web.task-notifications";

/** The reader asked for a notification when a task finishes. Off until they turn it on. */
export function taskNotificationsWanted(): boolean {
  return browserLocalStorage()?.getItem(PREFERENCE_KEY) === "on";
}

export function setTaskNotificationsWanted(wanted: boolean): void {
  const storage = browserLocalStorage();
  if (storage === undefined) return;
  if (wanted) storage.setItem(PREFERENCE_KEY, "on");
  else storage.removeItem(PREFERENCE_KEY);
}

export function notificationAvailability(): NotificationAvailability {
  if (!Reflect.has(globalThis, "Notification") || !Reflect.has(navigator, "serviceWorker")) return "unsupported";
  if (!window.isSecureContext) return "insecure";
  return Notification.permission === "granted" ? "granted" : Notification.permission === "denied" ? "denied" : "prompt";
}

/**
 * The registration every notification is posted through.
 *
 * Registered at the application root, not at the origin root: a PI WEB served under `/piweb/` must
 * not claim a scope that covers other sites on the host.
 */
export async function ensureNotificationRegistration(): Promise<ServiceWorkerRegistration | undefined> {
  if (!Reflect.has(navigator, "serviceWorker")) return undefined;
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing !== undefined) return existing;
  const scriptUrl = resolveAppUrl("sw.js");
  const scope = new URL(".", scriptUrl).pathname;
  return navigator.serviceWorker.register(scriptUrl, { scope }).catch(() => undefined);
}

/**
 * Asks the browser for permission, registering the service worker first where the browser wants
 * that order. A denial is the browser's answer and is reported as such; the page never asks twice in
 * one go, and the reader turns the preference on from the browser's own site settings afterwards.
 */
export async function requestTaskNotificationPermission(): Promise<NotificationAvailability> {
  const availability = notificationAvailability();
  if (availability === "unsupported" || availability === "insecure" || availability === "denied") return availability;
  const registration = await ensureNotificationRegistration();
  // A granted permission with no registration posts nothing, so saying "allowed" would be a claim
  // about a notification centre the page cannot reach.
  if (registration === undefined) return "unregistered";
  if (Notification.permission === "granted") return "granted";
  const asked = await Notification.requestPermission();
  if (asked !== "granted") return asked === "denied" ? "denied" : "prompt";
  return (await navigator.serviceWorker.getRegistration()) === undefined ? "unregistered" : "granted";
}

/**
 * Posts the notice. Returns whether the notification centre got it, so the caller can say so
 * honestly rather than assuming.
 *
 * `tag` keeps one session's notices together: a second finished task replaces the first notice
 * rather than stacking a pile on a phone's lock screen.
 */
export async function notifyTaskFinished(notice: TaskFinishedNotice, tag: string): Promise<boolean> {
  if (!Reflect.has(globalThis, "Notification") || Notification.permission !== "granted") return false;
  const registration = (await navigator.serviceWorker.getRegistration()) ?? (await ensureNotificationRegistration());
  if (registration === undefined) return false;
  try {
    await registration.showNotification(notice.title, {
      body: notice.body,
      tag,
      data: { url: notice.url },
      icon: resolveAppUrl("pwa-icon-192.png"),
      badge: resolveAppUrl("pwa-icon-192.png"),
      silent: false,
    });
    return true;
  } catch {
    return false;
  }
}
