import { PUSH_PAYLOAD_LIMIT_BYTES, encryptPushPayload, vapidJwt, type VapidKeyPair } from "./webPushCrypto.js";
import type { PushDeliveryResult, PushSubscriptionRecord } from "../../../shared/notificationEvents.js";

/**
 * One push message, sent to one device.
 *
 * The push service is a third party: it stores the encrypted blob and wakes the browser. Its answers
 * are the only evidence a sender gets, and they mean specific things. `410 Gone` and `404` say the
 * subscription is over - the browser unsubscribed, cleared site data, or the service expired it - and
 * the only right answer is to drop the address, because every later send to it is a wasted request
 * and a device list that never shrinks. `401`/`412` say the VAPID assertion is not accepted, which is
 * this server's problem and not the device's, so the address stays. `429` asks for a delay; the
 * message is time-bounded by its TTL, so the sender reports it rather than queueing a retry nobody
 * can see.
 *
 * The delivery is reported per device: an event that reaches two of three phones is a partial
 * delivery, and a log that only says "sent" would hide the phone that stopped being told.
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
  nowSeconds?: () => number;
}

export const DEFAULT_PUSH_TTL_SECONDS = 3600;
const DEFAULT_SEND_TIMEOUT_MS = 10_000;

export class WebPushSender {
  private readonly fetchPush: PushFetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: WebPushSenderOptions) {
    this.fetchPush = options.fetch ?? nodeFetch;
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
          "TTL": String(Math.max(0, Math.min(this.options.ttlSeconds, 60 * 60 * 24 * 7))),
          "Urgency": "normal",
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

const nodeFetch: PushFetch = async (request, signal) => {
  const response = await fetch(request.url, { method: request.method, headers: request.headers, body: Uint8Array.from(request.body), signal });
  return {
    status: response.status,
    statusText: response.statusText,
    header: (name) => response.headers.get(name) ?? undefined,
  };
};

function deliveryResult(id: string, response: PushHttpResponse): PushDeliveryResult {
  const status = response.status;
  if (status === 201 || status === 202) return { subscriptionId: id, outcome: "sent", status, reason: undefined };
  if (status === 404 || status === 410) return { subscriptionId: id, outcome: "expired", status, reason: "The push service says this subscription is gone" };
  if (status === 401 || status === 403 || status === 412) return { subscriptionId: id, outcome: "unauthorized", status, reason: "The push service refused the VAPID assertion" };
  if (status === 429) {
    const retryAfter = response.header("retry-after");
    return { subscriptionId: id, outcome: "failed", status, reason: retryAfter === undefined ? "The push service is rate limiting this sender" : `The push service is rate limiting this sender; retry after ${retryAfter}s` };
  }
  if (status === 413 || status === 414 || status === 431) return { subscriptionId: id, outcome: "rejected", status, reason: "The push service refused the request as too large" };
  if (status >= 400 && status < 500) return { subscriptionId: id, outcome: "rejected", status, reason: response.statusText === "" ? undefined : response.statusText };
  return { subscriptionId: id, outcome: "failed", status, reason: response.statusText === "" ? undefined : response.statusText };
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.name === "AbortError" ? "The push service did not answer in time" : error.message;
  return String(error);
}
