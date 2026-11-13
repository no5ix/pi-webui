import { WebPushSender, DEFAULT_PUSH_TTL_SECONDS, type PushFetch } from "./webPushSender.js";
import type { PushSubscriptionStore } from "./pushSubscriptionStore.js";
import type { ResolvedVapidKeys } from "./vapidKeys.js";
import { noticeTagFor, notificationSessionUrl, type DeviceNotificationEvent, type PushDeliveryResult, type PushServiceState } from "../../../shared/notificationEvents.js";
import { PUSH_PAYLOAD_LIMIT_BYTES } from "./webPushCrypto.js";


/**
 * One lifecycle event, delivered to every device that asked for it.
 *
 * The event is minted once, by the party that knows the run's end is confirmed, and this is the only
 * place that turns it into sends. Two rules keep a device's notification centre honest:
 *
 * - **One event, one notification.** Every send of an event carries its id, and the browser shows a
 *   notification under that id as its `tag`, so the page that is looking at the session and the push
 *   service that reaches the same browser leave one notice, not two. An event id seen a second time
 *   inside the deduplication window is dropped here, which is what a replayed frame, a retried
 *   request, or a session that reported its end twice must not defeat.
 * - **Dead addresses are removed, not retried.** A subscription the push service says is gone is
 *   dropped from the store, so the device list shrinks when devices leave and a phone that cleared
 *   its site data does not receive messages at an address it no longer owns.
 *
 * Every send is logged with its outcome. A reader whose iPhone stopped being told has one place to
 * look, and "we sent it" is not an answer: only the push service's response says the device was
 * woken, and even that is not a claim that a person saw a notification.
 */

export interface DeviceNotificationLogger {
  info(message: string): void;
  warn(message: string): void;
}

export interface DeviceNotificationServiceOptions {
  subscriptions: PushSubscriptionStore;
  keys: ResolvedVapidKeys;
  subject: string;
  ttlSeconds?: number;
  /** `push.enabled: false`. With push off the events still reach the page, which is the browser's own notice. */
  enabled?: boolean;
  logger?: DeviceNotificationLogger;
  fetch?: PushFetch;
  /** How long an event id is remembered as already sent. */
  dedupeWindowMs?: number;
  dedupeLimit?: number;
  now?: () => Date;
}

export interface DeviceNotificationDelivery {
  readonly event: DeviceNotificationEvent;
  /** The event was already sent inside the deduplication window, so nothing went out. */
  readonly deduped: boolean;
  readonly targets: number;
  readonly results: PushDeliveryResult[];
}

const DEFAULT_DEDUPE_WINDOW_MS = 60_000;
const DEFAULT_DEDUPE_LIMIT = 256;

export class DeviceNotificationService {
  private readonly sender: WebPushSender | undefined;
  private readonly ttlSeconds: number;
  private readonly enabled: boolean;
  private readonly logger: DeviceNotificationLogger;
  private readonly dedupeWindowMs: number;
  private readonly dedupeLimit: number;
  private readonly now: () => Date;
  /** Event ids already sent, oldest first. Bounded: a daemon that ran a year must not grow a list forever. */
  private readonly sent = new Map<string, number>();
  private readonly inFlight = new Set<string>();

  constructor(private readonly options: DeviceNotificationServiceOptions) {
    this.ttlSeconds = options.ttlSeconds ?? DEFAULT_PUSH_TTL_SECONDS;
    this.enabled = options.enabled !== false;
    this.logger = options.logger ?? silentLogger;
    this.dedupeWindowMs = options.dedupeWindowMs ?? DEFAULT_DEDUPE_WINDOW_MS;
    this.dedupeLimit = options.dedupeLimit ?? DEFAULT_DEDUPE_LIMIT;
    this.now = options.now ?? (() => new Date());
    this.sender = options.keys.keys === undefined ? undefined : new WebPushSender({
      keys: options.keys.keys,
      subject: options.subject,
      ttlSeconds: this.ttlSeconds,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });
  }

  /** What this server can do about push, as the settings panel reports it. */
  async state(): Promise<PushServiceState> {
    const subscriptions = await this.options.subscriptions.count();
    return {
      disabled: !this.enabled,
      configured: this.sender !== undefined,
      source: this.keysSource(),
      subscriptions,
    };
  }

  keysSource(): PushServiceState["source"] {
    if (!this.enabled) return "none";
    return this.sender === undefined ? "none" : this.options.keys.source;
  }

  /** Why push is not available, in the words the settings panel shows. Undefined when it is. */
  problem(): string | undefined {
    if (!this.enabled) return "Push is turned off in the PI WEB config (push.enabled: false).";
    return this.options.keys.problem ?? (this.sender === undefined ? "No VAPID key pair is available." : undefined);
  }

  publicKey(): string | undefined {
    return this.enabled && this.sender !== undefined ? this.options.keys.keys?.publicKey : undefined;
  }

  /**
   * Send one event to every registered device.
   *
   * Never throws: a notification is a convenience, and a push service that is down must not become a
   * failed prompt.
   */
  async notify(event: DeviceNotificationEvent): Promise<DeviceNotificationDelivery> {
    if (this.isDeduped(event.id) || this.inFlight.has(event.id)) return { event, deduped: true, targets: 0, results: [] };
    const sender = this.sender;
    if (!this.enabled || sender === undefined) {
      this.logger.info(`[notifications] ${event.kind} for ${event.sessionId}: push is off (${this.problem() ?? "unavailable"})`);
      return { event, deduped: false, targets: 0, results: [] };
    }
    const subscriptions = await this.options.subscriptions.list().catch(() => undefined);
    if (subscriptions === undefined) {
      this.logger.warn(`[notifications] ${event.kind} for ${event.sessionId}: the device list could not be read, so nothing was sent`);
      return { event, deduped: false, targets: 0, results: [] };
    }
    if (subscriptions.length === 0) {
      this.logger.info(`[notifications] ${event.kind} for ${event.sessionId}: no devices are registered for push`);
      return { event, deduped: false, targets: 0, results: [] };
    }
    this.inFlight.add(event.id);
    const results: PushDeliveryResult[] = [];
    try {
      for (const subscription of subscriptions) {
        const payload = JSON.stringify(pushPayload(fitEvent(event, subscription.appBaseUrl), subscription.appBaseUrl));
        results.push(await sender.send(subscription, payload).catch((error: unknown): PushDeliveryResult => ({
          subscriptionId: subscription.id,
          outcome: "failed",
          status: undefined,
          reason: error instanceof Error ? error.message : String(error),
        })));
      }
    } finally {
      this.inFlight.delete(event.id);
    }
    const expired = results.filter((result) => result.outcome === "expired").map((result) => result.subscriptionId);
    if (expired.length > 0) await this.options.subscriptions.removeMany(expired).catch(() => undefined);
    for (const result of results) {
      const gone = result.outcome === "expired";
      if (!gone) await this.options.subscriptions.recordDelivery(result.subscriptionId, result.outcome === "sent").catch(() => undefined);
    }
    this.recordSent(event.id);
    const delivered = results.filter((result) => result.outcome === "sent").length;
    const line = `[notifications] ${event.kind} for ${event.sessionId}: ${String(delivered)} of ${String(results.length)} device(s) woken`;
    if (delivered === results.length) this.logger.info(line);
    else this.logger.warn(`${line}; ${results.filter((result) => result.outcome !== "sent").map(describeResult).join("; ")}`);
    return { event, deduped: false, targets: results.length, results };
  }

  /**
   * Whether this event was already sent inside the window.
   *
   * The id is recorded only once the send has been attempted: an event that reached no device - push
   * off, no subscriptions, a push service that refused it - is not an event the reader has been told
   * about, and a producer that tries it again inside the window must still be able to tell them.
   */
  private isDeduped(id: string): boolean {
    const previous = this.sent.get(id);
    return previous !== undefined && this.now().getTime() - previous < this.dedupeWindowMs;
  }

  private recordSent(id: string): void {
    this.sent.set(id, this.now().getTime());
    while (this.sent.size > this.dedupeLimit) {
      const oldest = this.sent.keys().next();
      if (oldest.done === true) break;
      this.sent.delete(oldest.value);
    }
  }
}

/**
 * The bytes a service worker receives.
 *
 * The notice's `tag` is the shared notification-centre key - the session and its verdict - which is
 * what makes the page's own notice and this push message one notice on a device that gets both; the
 * event's own id rides as `eventId`, unique per run, so a device can be told which run a notice is
 * about. The `url` is built from the address this device registered with, so the tap opens PI WEB
 * where the device can reach it.
 */
export function pushPayload(event: DeviceNotificationEvent, appBaseUrl?: string): Record<string, unknown> {
  const data: Record<string, unknown> = {
    tag: noticeTagFor(event),
    eventId: event.id,
    title: event.title,
    body: event.body,
    kind: event.kind,
    sessionId: event.sessionId,
    projectName: event.projectName,
    occurredAt: event.occurredAt,
  };
  if (event.outcome !== undefined) data["outcome"] = event.outcome;
  if (event.elapsedMs !== undefined) data["elapsedMs"] = event.elapsedMs;
  if (event.questionCount !== undefined) data["questionCount"] = event.questionCount;
  const target = appBaseUrl === undefined || appBaseUrl === "" ? undefined : notificationSessionUrl(appBaseUrl, event.sessionId);
  if (target !== undefined) data["url"] = target;
  return { notification: data };
}

/**
 * The notice inside the budget a push service accepts.
 *
 * The two prose fields are what gets long: a session title and the first line of an error. They are
 * clipped by code point (never mid-character), and the payload is rebuilt after each clip, so what
 * goes on the wire is always valid JSON. A notice that cannot be made to fit is reported by the
 * sender, not sent as bytes nobody can read.
 */
export function fitEvent(event: DeviceNotificationEvent, appBaseUrl: string | undefined): DeviceNotificationEvent {
  const size = (title: string, body: string): number => Buffer.byteLength(JSON.stringify(pushPayload({ ...event, title, body }, appBaseUrl)), "utf8");
  if (size(event.title, event.body) <= PUSH_PAYLOAD_LIMIT_BYTES) return event;
  const title = clip(event.title, 120);
  let body = clip(event.body, 280);
  while (body.length > 0 && size(title, body) > PUSH_PAYLOAD_LIMIT_BYTES) {
    body = clip(body, Math.floor(Array.from(body).length / 2));
  }
  return { ...event, title, body };
}

function clip(text: string, limit: number): string {
  const characters = Array.from(text);
  if (characters.length <= limit) return text;
  return `${characters.slice(0, Math.max(0, limit - 1)).join("")}${limit === 0 ? "" : "\u2026"}`;
}

function describeResult(result: PushDeliveryResult): string {
  const status = result.status === undefined ? "" : ` status ${String(result.status)}`;
  return `${result.subscriptionId.slice(0, 8)}: ${result.outcome}${status}${result.reason === undefined ? "" : ` (${result.reason})`}`;
}

const silentLogger: DeviceNotificationLogger = { info: () => undefined, warn: () => undefined };
