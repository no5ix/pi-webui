import { Agent, fetch as undiciFetch } from "undici";
import { PUSH_PAYLOAD_LIMIT_BYTES, encryptPushPayload, vapidJwt, type VapidKeyPair } from "./webPushCrypto.js";
import type { PushDeliveryResult, PushSubscriptionRecord } from "../../../shared/notificationEvents.js";

/**
 * One push message, sent to one device.
 *
 * The push service is a third party: it stores the encrypted blob and wakes the browser. Its answers
 * are the only evidence a sender gets, and they mean specific things. `410 Gone` and `404` say the
 * subscription is over - the browser unsubscribed, cleared site data, or the service expired it - and
 * the only right answer is to drop the address, because every later send to it is a wasted request
 * and a device list that never shrinks. `401`/`403`/`412` say the push service refused this sender's
 * VAPID assertion, which is this server's problem and not the device's, so the address stays. `429`
 * asks for a delay; the message is time-bounded by its TTL, so the sender reports it rather than
 * queueing a retry nobody can see.
 *
 * The delivery is reported per device: an event that reaches two of three phones is a partial
 * delivery, and a log that only says "sent" would hide the phone that stopped being told.
 *
 * Two wire choices are load-bearing and were measured against the live services (see
 * `docs/notifications.md`):
 *
 * - **`Urgency: high`, and a TTL that outlives a locked phone.** A lower urgency lets an idle device -
 *   iOS above all - defer the message to an arbitrary later window, and a one-hour TTL expires the
 *   message while the phone is still asleep.
 * - **The address family.** Desktop Chrome and Edge get their endpoints from Windows Notification
 *   Service (`wns2-*.notify.windows.com`), which publishes an AAAA record that is unreachable on
 *   networks a good number of PI WEB installs sit on (measured here: `curl -6` fails in 3 ms,
 *   `curl --ipv4` answers, Node's default connect times out on the IPv6 route). A sender that leaves
 *   the family to the platform reports every Chrome and Edge device as unreachable. So the send goes
 *   IPv4 first and falls back to the platform default, and the family that worked is remembered per
 *   push-service host so a flaky host is not paid for twice per event.
 */

export interface PushHttpRequest {
  readonly url: string;
  readonly method: "POST";
  readonly headers: Record<string, string>;
  readonly body: Buffer;
}

export interface PushHttpResponse {
  readonly status: number;
  readonly statusText: string;
  /** The service's own words, capped. Apple and Google answer a refusal with a reason worth showing. */
  readonly body?: string;
  header(name: string): string | undefined;
}

export type PushFetch = (request: PushHttpRequest, signal: AbortSignal) => Promise<PushHttpResponse>;

export interface WebPushSenderOptions {
  keys: VapidKeyPair;
  subject: string;
  /** How long a push service may keep an undeliverable message. A notification nobody saw is noise. */
  ttlSeconds: number;
  fetch?: PushFetch;
  timeoutMs?: number;
  /** How long the connect phase may take before the other address family is tried. */
  connectTimeoutMs?: number;
  nowSeconds?: () => number;
}

/** A day: long enough that a phone locked overnight is told when it wakes, inside every service's ceiling. */
export const DEFAULT_PUSH_TTL_SECONDS = 86_400;
/** The ceiling every push service honors; a message kept longer is kept by nobody. */
export const MAX_PUSH_TTL_SECONDS = 60 * 60 * 24 * 7;
/** Idle devices, iOS in particular, defer anything less than high. */
export const PUSH_URGENCY = "high";
const DEFAULT_SEND_TIMEOUT_MS = 10_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;
/** How long a host keeps the address family that last worked, before the order is tried again. */
const FAMILY_MEMORY_MS = 15 * 60 * 1000;
/** The longest service refusal this server repeats to a reader. Bodies are capped before they are shown. */
const REASON_MAX_LENGTH = 160;

export class WebPushSender {
  private readonly fetchPush: PushFetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: WebPushSenderOptions) {
    this.fetchPush = options.fetch ?? nodeFetch(this.options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_SEND_TIMEOUT_MS;
  }

  async send(subscription: PushSubscriptionRecord, payload: string, subscriptionId?: string): Promise<PushDeliveryResult> {
    const id = subscriptionId ?? subscription.id;
    // A payload over the budget is reported, never sliced. Cutting a serialised notification at a byte
    // boundary produces bytes that are not JSON, and a service worker that cannot read it shows nothing
    // while this side logs the send as a success.
    const size = Buffer.byteLength(payload, "utf8");
    if (size > PUSH_PAYLOAD_LIMIT_BYTES) {
      return { subscriptionId: id, outcome: "rejected", status: undefined, reason: `The notification is ${String(size)} bytes, over the ${String(PUSH_PAYLOAD_LIMIT_BYTES)}-byte budget a push service accepts` };
    }
    const encrypted = encryptPushPayload(subscription.publicKey, subscription.authToken, payload);
    if (encrypted === undefined) return { subscriptionId: id, outcome: "rejected", status: undefined, reason: "The subscription's keys are not a P-256 key, or the payload is too large" };
    const assertion = vapidJwt(this.options.keys, subscription.endpoint, this.options.subject, this.options.nowSeconds?.());
    if (assertion === undefined) return { subscriptionId: id, outcome: "rejected", status: undefined, reason: "The push endpoint is not an HTTPS origin" };
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); }, this.timeoutMs);
    try {
      const response = await this.fetchPush({
        url: subscription.endpoint,
        method: "POST",
        headers: {
          "TTL": String(Math.max(0, Math.min(this.options.ttlSeconds, MAX_PUSH_TTL_SECONDS))),
          "Urgency": PUSH_URGENCY,
          "Authorization": `vapid t=${assertion}, k=${this.options.keys.publicKey}`,
          "Content-Type": encrypted.contentEncoding,
          "Content-Length": String(encrypted.body.length),
        },
        body: encrypted.body,
      }, controller.signal);
      return deliveryResult(id, response);
    } catch (error: unknown) {
      return { subscriptionId: id, outcome: "unreachable", status: undefined, reason: describeError(error) };
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * The Node transport: IPv4 first, then the platform's own choice.
 *
 * Both families are real options, not a preference: an IPv6-only host has no route to an A record, and
 * a dual-stack host behind a broken 6to4 route has no route to an AAAA record. The order is remembered
 * per push-service host, so a device list of twelve Chrome endpoints does not pay a connect timeout per
 * device on every event.
 */
function nodeFetch(connectTimeoutMs: number): PushFetch {
  return async (request, signal) => {
    const host = hostOf(request.url);
    const families = connectFamilies(host);
    let lastError: unknown;
    for (const family of families) {
      const controller = new AbortController();
      const relay = () => controller.abort(signal.reason);
      if (signal.aborted) relay();
      else signal.addEventListener("abort", relay, { once: true });
      try {
        const response = await undiciFetch(request.url, {
          method: request.method,
          headers: request.headers,
          body: Uint8Array.from(request.body),
          signal: controller.signal,
          dispatcher: agentFor(family, connectTimeoutMs),
        });
        if (families.length > 1) rememberFamily(host, family);
        return {
          status: response.status,
          statusText: response.statusText,
          body: await response.text().catch(() => ""),
          header: (name) => response.headers.get(name) ?? undefined,
        };      } catch (error: unknown) {
        lastError = error;
        // A refusal from the service is an answer; only a connect-level failure means "try the other family".
        if (!isConnectFailure(error)) throw error;
      } finally {
        signal.removeEventListener("abort", relay);
      }
    }
    throw lastError;
  };
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

type AddressFamily = 4 | 0;

const familyMemory = new Map<string, { family: AddressFamily; at: number }>();

function connectFamilies(host: string, now = Date.now()): AddressFamily[] {
  const remembered = familyMemory.get(host);
  if (remembered !== undefined && now - remembered.at < FAMILY_MEMORY_MS) return [remembered.family, remembered.family === 4 ? 0 : 4];
  return [4, 0];
}

function rememberFamily(host: string, family: AddressFamily, at = Date.now()): void {
  familyMemory.set(host, { family, at });
}

/** Codes that mean "the socket never got to the push service", as opposed to "the push service answered". */
const CONNECT_FAILURE_CODES = new Set([
  "ETIMEDOUT", "ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH", "ENETDOWN", "EADDRNOTAVAIL", "EAI_AGAIN", "EPROTO",
  "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET", "ECONNRESET",
]);

export function isConnectFailure(error: unknown): boolean {
  const codes: unknown[] = [
    error instanceof Error ? Reflect.get(error, "code") : undefined,
    error instanceof Error ? Reflect.get(error, "cause") : undefined,
  ];
  for (const entry of codes) {
    if (typeof entry === "string" && CONNECT_FAILURE_CODES.has(entry)) return true;
    if (typeof entry === "object" && entry !== null) {
      const code = Reflect.get(entry, "code");
      if (typeof code === "string" && CONNECT_FAILURE_CODES.has(code)) return true;
      const errors = Reflect.get(entry, "errors");
      if (Array.isArray(errors) && errors.some((nested: unknown) => isConnectFailure(nested))) return true;
    }
  }
  return false;
}

const agents = new Map<string, Agent>();

function agentFor(family: AddressFamily, connectTimeoutMs: number): Agent {
  const key = `${String(family)}:${String(connectTimeoutMs)}`;
  const existing = agents.get(key);
  if (existing !== undefined) return existing;
  const agent = new Agent({ connect: { family, timeout: connectTimeoutMs } });
  agents.set(key, agent);
  return agent;
}

function deliveryResult(id: string, response: PushHttpResponse): PushDeliveryResult {
  const status = response.status;
  const serviceSays = serviceReason(response.body);
  if (status === 201 || status === 202 || status === 200) return { subscriptionId: id, outcome: "sent", status, reason: undefined };
  if (status === 404 || status === 410) return { subscriptionId: id, outcome: "expired", status, reason: serviceSays ?? "The push service says this subscription is gone" };
  if (status === 401 || status === 403 || status === 412) return { subscriptionId: id, outcome: "unauthorized", status, reason: serviceSays ?? "The push service refused the VAPID assertion" };
  if (status === 429) {
    const retryAfter = response.header("retry-after");
    return { subscriptionId: id, outcome: "failed", status, reason: retryAfter === undefined ? "The push service is rate limiting this sender" : `The push service is rate limiting this sender; retry after ${retryAfter}s` };
  }
  if (status === 413 || status === 414 || status === 431) return { subscriptionId: id, outcome: "rejected", status, reason: "The push service refused the request as too large" };
  if (status >= 400 && status < 500) return { subscriptionId: id, outcome: "rejected", status, reason: serviceSays ?? (response.statusText === "" ? undefined : response.statusText) };
  return { subscriptionId: id, outcome: "failed", status, reason: serviceSays ?? (response.statusText === "" ? undefined : response.statusText) };
}

/**
 * The push service's own reason, in a form this server repeats.
 *
 * Apple answers `{"reason":"BadJwtToken"}`, Google in a sentence, Mozilla with an empty body. The
 * reason is the most useful line a reader can get - it is the difference between "the phone is gone"
 * and "this server's VAPID identity is refused" - and it is the service's words about a request this
 * server made, not the reader's content, so quoting a capped, single-line slice of it is safe.
 */
export function serviceReason(body: string | undefined): string | undefined {
  const text = (body ?? "").replace(/\s+/g, " ").trim();
  if (text === "") return undefined;
  let reason: string | undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed !== null && typeof parsed === "object" && typeof Reflect.get(parsed, "reason") === "string") {
      reason = String(Reflect.get(parsed, "reason"));
    }
  } catch {
    reason = undefined;
  }
  const value = reason ?? text;
  return value.length > REASON_MAX_LENGTH ? `${value.slice(0, REASON_MAX_LENGTH - 1)}\u2026` : value;
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "AbortError") return "The push service did not answer in time";
    const code = Reflect.get(error, "code");
    const cause = Reflect.get(error, "cause");
    const causeCode = typeof cause === "object" && cause !== null ? Reflect.get(cause, "code") : undefined;
    const detail = typeof code === "string" ? code : typeof causeCode === "string" ? causeCode : "";
    return detail === "" ? error.message : `${error.message} (${detail})`;
  }
  return String(error);
}
