import type { NtfyConfig, NtfyDelivery, NotificationEvent, NtfyFetch } from "../../../shared/ntfy.js";
import { ntfyFetch } from "../../notifications/ntfyFetch.js";
import { ntfyReadiness, ntfyWantsEvent, sendNtfyNotice } from "../../../shared/ntfy.js";

/**
 * ntfy delivery, from the machine that ran the task.
 *
 * The reader's whole reason for turning this on is to be told about a task while looking at something
 * that is not this browser, so delivery runs here, in the session daemon, and not in a page: a notice
 * reaches the phone when the laptop's browser is closed. The transport itself is shared with the web
 * process (`shared/ntfy.ts`), because the Settings panel's test notice must travel the same path the
 * real ones do. What lives here is only the daemon's own business: the switches, the dedupe, the
 * status.
 *
 * Three properties are the contract:
 *
 * - **Nothing here is on a task's path.** `notify` returns immediately; the send is a floating
 * promise. A timeout bounds the fetch, the attempts are bounded, and every failure - an unreachable
 * server, a 410, an offline phone - leaves only this provider's status. A task never waits for a
 * notification and never fails because of one, and the browser's own notices are a separate provider
 * that cannot be reached from here at all.
 * - **The topic stays on the machine.** It is a bearer secret on a public server, so it is never
 * written to a log; the delivery's reason is already redacted where it is produced.
 * - **One event, one notice.** A dedupe key carries the session and the span it describes, so a daemon
 * that reports a run's end twice, or a dialog that redraws, does not put two notices on a phone.
 */
export interface NtfyNoticeRequest {
  readonly event: NotificationEvent;
  readonly title: string;
  readonly message: string;
  readonly dedupeKey: string;
  /** A provider-relative route, such as `?session=<id>`, appended to the config's click base. */
  readonly route?: string;
  readonly tags?: readonly string[];
}

export interface NtfyNotifier {
  /** Fire a notice. Never throws, never awaits the network. */
  notify(request: NtfyNoticeRequest): void;
  /** What the last delivery of this process did, for a settings panel that asks. */
  status(): NtfyNotifierStatus;
}

export interface NtfyNotifierStatus {
  readonly enabled: boolean;
  readonly ready: boolean;
  readonly readyReason?: string;
  readonly configured: boolean;
  readonly lastAttemptAt?: string;
  readonly lastOutcome?: "attempted" | "delivered" | "failed" | "skipped";
  readonly lastReason?: string;
  readonly lastEvent?: NotificationEvent;
}

export interface NtfyNotifierDependencies {
  /** Read the ntfy block as it stands now, so a settings change is used by the next notice. */
  readConfig: () => NtfyConfig | undefined;
  fetchImpl?: NtfyFetch;
  /** A log line. Its fields arrive already free of the topic. */
  log?: (fields: Record<string, unknown>, message: string) => void;
  now?: () => number;
  /** How long a duplicate of the same key is suppressed. */
  dedupeWindowMs?: number;
}

const DEFAULT_DEDUPE_WINDOW_MS = 5 * 60 * 1000;
const DEDUPE_KEYS_LIMIT = 200;
/**
 * How many publishes run at once, and how many more wait.
 *
 * Every session that ends posts a notice, so a daemon that restarts 40 sessions, or a fleet where a
 * model comes back after an outage, finishes them together. Unthrottled that is 40 connections to one
 * ntfy server at once - the server that answers slowly is the one that then drops everything. Past the
 * waiting room a notice is dropped and said so: a queue that grows without bound is a memory that
 * fills with notices nobody will read.
 */
const NTFY_MAX_IN_FLIGHT = 4;
const NTFY_MAX_QUEUED = 32;

type QueuedNotice = Parameters<NtfyNotifier["notify"]>[0];

export function createNtfyNotifier(dependencies: NtfyNotifierDependencies): NtfyNotifier {
  const now = dependencies.now ?? (() => Date.now());
  const dedupeWindowMs = dependencies.dedupeWindowMs ?? DEFAULT_DEDUPE_WINDOW_MS;
  const sent = new Map<string, number>();
  const waiting: QueuedNotice[] = [];
  let inFlight = 0;
  let last: NtfyNotifierStatus = { enabled: false, ready: false, configured: false };

  const publish = (request: QueuedNotice, base: NtfyNotifierStatus): void => {
    inFlight += 1;
    const config = dependencies.readConfig();
    if (config === undefined) {
      inFlight -= 1;
      last = { ...base, ready: false, lastOutcome: "skipped", lastReason: "ntfy was turned off before this notice was sent." };
      const next = waiting.shift();
      if (next !== undefined) publish(next, base);
      return;
    }
    void sendNtfyNotice(request, config, {
      fetchImpl: dependencies.fetchImpl ?? ntfyFetch,
      now,
      ...(dependencies.log === undefined ? {} : { log: dependencies.log }),
    }).then((delivery: NtfyDelivery) => {
      last = { ...base, ready: true, lastOutcome: delivery.delivered ? "delivered" : "failed", ...(delivery.reason === undefined ? {} : { lastReason: delivery.reason }) };
    }).finally(() => {
      inFlight -= 1;
      const next = waiting.shift();
      if (next !== undefined) publish(next, base);
    });
  };

  return {
    notify: (request) => {
      const config = dependencies.readConfig();
      const base: NtfyNotifierStatus = {
        enabled: config?.enabled === true,
        ready: false,
        configured: config !== undefined,
        lastEvent: request.event,
        lastAttemptAt: new Date(now()).toISOString(),
      };
      if (config === undefined) {
        last = { ...base, ready: false, readyReason: "ntfy is not configured in Settings.", lastOutcome: "skipped" };
        return;
      }
      const refusal = refuse(config, request.event, request.dedupeKey, sent, now(), dedupeWindowMs);
      if (refusal !== undefined) {
        last = { ...base, ready: refusal.ready, ...(refusal.reason === undefined ? {} : { readyReason: refusal.reason }), lastOutcome: "skipped" };
        return;
      }
      recordSent(sent, request.dedupeKey, now());
      last = { ...base, ready: true, lastOutcome: "attempted" };
      if (inFlight >= NTFY_MAX_IN_FLIGHT) {
        if (waiting.length >= NTFY_MAX_QUEUED) {
          last = { ...base, ready: true, lastOutcome: "failed", lastReason: "Too many notices are already on their way; this one was dropped." };
          dependencies.log?.({ event: request.event, queued: waiting.length }, "ntfy notice dropped: the send queue is full");
          return;
        }
        waiting.push(request);
        return;
      }
      publish(request, base);
    },
    status: () => last,
  };
}

/**
 * Why this notice is not this provider's to send, in the words a panel can show; undefined when it is.
 *
 * The switches are the reader's, so an event they did not ask for is not sent and is not an error.
 * The config is read on every notice, which is what makes the settings panel's answer immediate:
 * turning ntfy on is felt by the next finished task, with no daemon restart.
 */
function refuse(
  config: NtfyConfig,
  event: NotificationEvent,
  dedupeKey: string,
  sent: Map<string, number>,
  at: number,
  dedupeWindowMs: number,
): { ready: boolean; reason?: string } | undefined {
  if (config.enabled !== true) return { ready: false, reason: "ntfy is switched off." };
  const readiness = ntfyReadiness(config);
  if (!readiness.ready) return { ready: false, ...(readiness.reason === undefined ? {} : { reason: readiness.reason }) };
  if (!ntfyWantsEvent(config, event)) return { ready: true, reason: `The ${event} notice is switched off.` };
  const previous = sent.get(dedupeKey);
  if (previous !== undefined && at - previous < dedupeWindowMs) return { ready: true, reason: "The same notice was sent recently." };
  return undefined;
}

function recordSent(sent: Map<string, number>, key: string, at: number): void {
  sent.set(key, at);
  while (sent.size > DEDUPE_KEYS_LIMIT) {
    const oldest = sent.keys().next();
    if (oldest.done === true) return;
    sent.delete(oldest.value);
  }
}
