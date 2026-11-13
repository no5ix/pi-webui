/**
 * The device notification events PI WEB knows about, and the shapes that carry them.
 *
 * Four events, in the reader's words, and one classifier that decides when one of them is worth
 * sending: `user_input_required` when a run is parked on an answer, `task_completed`, `task_failed`
 * and `task_cancelled` when a run's end is confirmed. The daemon owns the confirmed end of a run
 * (`runOutcome.ts`) and the open extension dialogs, so it mints these events; every delivery -
 * the page that is looking at the session, the Mac's notification centre, a phone's push
 * subscription - carries the same event with the same id, and an id is what makes one event one
 * notification on a device that receives it twice.
 *
 * A push subscription is a device's address, not a session's. It carries the application base the
 * device reached PI WEB on, because the daemon does not know the host, port, path prefix, or
 * Tailscale address a particular device typed into its browser, and the tap on a notification has
 * to land on the URL that device can open.
 */

import type { PendingExtensionDialog } from "./apiTypes.js";
import { isRecord } from "./unknownValues.js";

/** The four lifecycle events, in the order a reader would list them. */
export const NOTIFICATION_EVENT_KINDS = ["user_input_required", "task_completed", "task_failed", "task_cancelled"] as const;

export type NotificationEventKind = (typeof NOTIFICATION_EVENT_KINDS)[number];

/** How a confirmed run ended. `cancelled` covers the reader's own Stop and an interrupted run. */
export type TaskRunOutcome = "completed" | "failed" | "cancelled";

/**
 * One lifecycle event, sent to every eligible device.
 *
 * `id` is the deduplication key: the page posts its notice and the push service delivers the same
 * event to the same browser with the same `tag`, so a browser that gets both shows one notification
 * rather than two.
 */
export interface DeviceNotificationEvent {
  readonly id: string;
  readonly kind: NotificationEventKind;
  readonly sessionId: string;
  readonly sessionName: string;
  /** The project the session belongs to; empty when the daemon cannot name one. */
  readonly projectName: string;
  readonly occurredAt: string;
  /** The confirmed outcome, on the task events. */
  readonly outcome?: TaskRunOutcome;
  /** The run's execution time in milliseconds, measured by the daemon's own clock. */
  readonly elapsedMs?: number;
  /** How many questions are waiting, on `user_input_required`. */
  readonly questionCount?: number;
  readonly title: string;
  readonly body: string;
}

/** A device's push address, as PI WEB stores it. */
export interface PushSubscriptionRecord {
  readonly id: string;
  /** The push service's URL for this device. Push services require HTTPS. */
  readonly endpoint: string;
  /** The device's P-256 public key, base64url, used to encrypt the payload. */
  readonly publicKey: string;
  /** The device's auth secret, base64url. */
  readonly authToken: string;
  /**
   * The application address this device reached PI WEB on, with its path prefix. The notification's
   * tap is built from it, so a phone that opens PI WEB at a Tailscale address taps its own address.
   */
  readonly appBaseUrl: string;
  /** The browser's own words about the device, for the settings panel's device list. */
  readonly userAgent: string;
  readonly createdAt: string;
  readonly lastDeliveredAt: string | undefined;
  readonly failures: number;
}

/** What a browser sends when it registers: the subscription a push manager produced. */
export interface PushSubscriptionRegistration {
  readonly endpoint: string;
  readonly keys: { readonly p256dh: string; readonly auth: string };
  readonly appBaseUrl?: string | undefined;
  readonly userAgent?: string | undefined;
}

/** One subscription's delivery answer. `expired` and `rejected` mean the subscription is gone. */
export type PushDeliveryOutcome = "sent" | "expired" | "rejected" | "unauthorized" | "failed" | "unreachable";

export interface PushDeliveryResult {
  readonly subscriptionId: string;
  readonly outcome: PushDeliveryOutcome;
  readonly status: number | undefined;
  readonly reason: string | undefined;
}

/** What the push service can do right now, as the settings panel reports it. */
export interface PushServiceState {
  /** Config turned push off (`push.enabled: false`). */
  readonly disabled: boolean;
  /** Whether a VAPID key pair is available. Without one, no device can subscribe. */
  readonly configured: boolean;
  /** Where a VAPID key pair came from: configured, generated, or nowhere. */
  readonly source: "config" | "generated" | "none";
  /** Devices registered with this PI WEB. */
  readonly subscriptions: number;
}

/** The longest endpoint, key and label a subscription may carry. Status payloads are bounded everywhere. */
export const PUSH_ENDPOINT_MAX_LENGTH = 2048;
export const PUSH_KEY_MAX_LENGTH = 512;
export const PUSH_APP_BASE_MAX_LENGTH = 512;
export const PUSH_USER_AGENT_MAX_LENGTH = 256;

/** A registration that arrived over HTTP, read: either the subscription to store, or the reason it was refused. */
export type PushRegistrationParse =
  | { readonly ok: true; readonly registration: PushSubscriptionRegistration }
  | { readonly ok: false; readonly refusal: string };

/**
 * Whether a registration is a push subscription PI WEB is willing to store.
 *
 * It answers with the reason, not a boolean, because the browser is told *why* its registration was
 * refused: a push endpoint on plain HTTP is the browser's own refusal, a VAPID key the browser did
 * not ask for is a page that is not talking to this product, and a page that sends its base address
 * on a host the daemon has never seen is how a notification ends up pointing at somebody else's
 * server. The valid branch carries the value in its typed form, so the route stores what was
 * checked and nothing else.
 */
export function parsePushRegistration(value: unknown): PushRegistrationParse {
  const refuse = (refusal: string): PushRegistrationParse => ({ ok: false, refusal });
  if (!isRecord(value)) return refuse("The registration is not an object");
  const endpoint = value["endpoint"];
  if (typeof endpoint !== "string" || endpoint.trim() === "") return refuse("The subscription has no push endpoint");
  if (endpoint.length > PUSH_ENDPOINT_MAX_LENGTH) return refuse("The push endpoint is too long");
  if (!isPushEndpoint(endpoint)) return refuse("The push endpoint must be an HTTPS URL");
  const keys = value["keys"];
  if (!isRecord(keys)) return refuse("The subscription has no keys");
  const p256dh = keys["p256dh"];
  const auth = keys["auth"];
  if (typeof p256dh !== "string" || !isBase64Url(p256dh, PUSH_KEY_MAX_LENGTH)) return refuse("The subscription's public key is not base64url");
  if (typeof auth !== "string" || !isBase64Url(auth, PUSH_KEY_MAX_LENGTH)) return refuse("The subscription's auth secret is not base64url");
  const appBaseUrl = value["appBaseUrl"];
  if (appBaseUrl !== undefined && (typeof appBaseUrl !== "string" || !isAppBaseUrl(appBaseUrl))) return refuse("The application address must be an HTTP(S) URL");
  const userAgent = value["userAgent"];
  if (userAgent !== undefined && (typeof userAgent !== "string" || userAgent.length > PUSH_USER_AGENT_MAX_LENGTH)) return refuse("The device label is too long");
  return {
    ok: true,
    registration: {
      endpoint: endpoint.trim(),
      keys: { p256dh, auth },
      ...(typeof appBaseUrl === "string" ? { appBaseUrl } : {}),
      ...(typeof userAgent === "string" ? { userAgent } : {}),
    },
  };
}

/**
 * A push endpoint is HTTPS by the Web Push spec: the push service is a third party that receives the
 * encrypted payload, and a cleartext endpoint would expose the device's address and payload.
 */
export function isPushEndpoint(value: string): boolean {
  if (!/^https:\/\//iu.test(value)) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/** The address a notification's tap is built on. Same-origin http(s) only, no credentials, no query. */
export function isAppBaseUrl(value: unknown): boolean {
  if (typeof value !== "string" || value.length === 0 || value.length > PUSH_APP_BASE_MAX_LENGTH) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    return url.username === "" && url.password === "" && url.search === "" && url.hash === "";
  } catch {
    return false;
  }
}

export function isBase64Url(value: unknown, max: number): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= max && /^[A-Za-z0-9_-]+$/u.test(value);
}

/**
 * How many questions an open extension dialog is asking.
 *
 * A declared card asks one question per answerable field - pi-ask-user's questionnaire is a card of
 * question fields, and a text field is a heading, not a question. A `confirm`, `select`, `input` or
 * `editor` dialog asks the one thing its title says. Both the page that posts its own notice and the
 * daemon that pushes the same event count here, so a reader is not told "3 questions" by one path and
 * "2 questions" by the other.
 */
export function askUserQuestionCount(dialog: Pick<PendingExtensionDialog, "kind" | "screen" | "options">): number {
  const fields = dialog.screen?.fields ?? [];
  const answerable = fields.filter((field) => field.type !== "text").length;
  return answerable > 0 ? answerable : 1;
}

/** A dialog whose declared card asks something: a questionnaire, not a drawn terminal frame and not a card that only presents. */
export function isQuestionnaireCard(dialog: Pick<PendingExtensionDialog, "kind" | "screen">): boolean {
  return dialog.kind === "custom" && dialog.screen?.kind === "card" && dialog.screen.fields.some((field) => field.type !== "text");
}

/**
 * The key a notification centre deduplicates on: one task verdict per session, one asking notice per session.
 *
 * Both paths - the page that has the session open, and the push message that wakes a device whose
 * browser is closed - put this key on the same event, so a device that receives both shows one
 * notice. The key is deliberately coarser than the event's own id: it names the session and the
 * verdict, never the run. A key that named the run would have to be minted from the run's end, and
 * the two paths do not share a clock - a page on a laptop and a daemon on a server are two clocks,
 * and a key they mint apart deduplicates nothing. The newest notice of a kind replaces the older one
 * of the same kind, which is what a reader who ran a session twice wants left on the screen; the
 * event's own id stays unique per run, for the server's own bookkeeping and the audit line.
 */
export function taskNoticeTag(sessionId: string, outcome: TaskRunOutcome): string {
  return `${sessionId}:task:${outcome}`;
}

/** The key of a session's asking notice: one per session, because it says "this session needs you", not "dialog 3 needs you". */
export function askNoticeTag(sessionId: string): string {
  return `${sessionId}:ask`;
}

/** The key of the notice an event produces, from the event itself - the one function both paths call. */
export function noticeTagFor(event: Pick<DeviceNotificationEvent, "kind" | "sessionId" | "outcome">): string {
  if (event.kind === "user_input_required") return askNoticeTag(event.sessionId);
  return taskNoticeTag(event.sessionId, event.outcome ?? "completed");
}

/**
 * Where a notification's tap lands: the session it speaks about, at the address this device uses.
 *
 * The session id is a query value, so it is encoded; the base is the device's own, already checked.
 */
export function notificationSessionUrl(appBaseUrl: string, sessionId: string): string | undefined {
  if (sessionId.trim() === "") return undefined;
  let url: URL;
  try {
    url = new URL(appBaseUrl);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
  if (url.username !== "" || url.password !== "") return undefined;
  url.hash = "";
  url.search = "";
  url.searchParams.set("session", sessionId);
  return url.toString();
}
