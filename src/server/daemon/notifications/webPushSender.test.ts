import { describe, it, expect } from "vitest";
import { createECDH, randomBytes } from "node:crypto";
import {
  DEFAULT_PUSH_TTL_SECONDS,
  MAX_PUSH_TTL_SECONDS,
  PUSH_URGENCY,
  WebPushSender,
  isConnectFailure,
  serviceReason,
  type PushHttpRequest,
  type PushHttpResponse,
} from "./webPushSender.js";
import { generateVapidKeyPair, base64UrlDecode, decryptPushPayload } from "./webPushCrypto.js";
import { present } from "./notifications.testSupport.js";
import type { PushSubscriptionRecord } from "../../../shared/notificationEvents.js";

/**
 * One Web Push request, as the sender builds it and as the push service answers it.
 *
 * The assertions are the ones a reader's diagnosis depends on: the urgency and TTL that decide
 * whether an idle phone is woken, the VAPID header a service checks, the coding a browser can decode,
 * and which of the service's answers is read as "gone", "refused us", "rate limited" or "unreachable".
 * The transport is injected, so the service's status and body are the scenario and no network is used.
 */

const keys = generateVapidKeyPair();

const ENDPOINT = "https://push.example.com/subscriptions/abcdef";

function subscription(): { record: PushSubscriptionRecord; privateKey: string; authToken: string } {
  const ecdh = createECDH("prime256v1");
  const authToken = randomBytes(16).toString("base64url");
  const publicKey = ecdh.generateKeys("base64url", "uncompressed");
  return {
    record: {
      id: "device-1",
      endpoint: ENDPOINT,
      publicKey,
      authToken,
      appBaseUrl: "https://pi.example/",
      userAgent: "Mozilla/5.0 (iPhone)",
      createdAt: new Date(0).toISOString(),
      lastDeliveredAt: undefined,
      failures: 0,
    },
    privateKey: ecdh.getPrivateKey("base64url"),
    authToken,
  };
}

function answer(status: number, options: { statusText?: string; body?: string; headers?: Record<string, string> } = {}): PushHttpResponse {
  const headers = options.headers ?? {};
  return { status, statusText: options.statusText ?? "", body: options.body ?? "", header: (name) => headers[name.toLowerCase()] ?? headers[name] };
}

function sender(fetch: (request: PushHttpRequest) => Promise<PushHttpResponse>, options: { ttlSeconds?: number; subject?: string } = {}) {
  const requests: PushHttpRequest[] = [];
  const instance = new WebPushSender({
    keys,
    subject: options.subject ?? "https://github.com/Gang-of-Beads/pi-web",
    ttlSeconds: options.ttlSeconds ?? DEFAULT_PUSH_TTL_SECONDS,
    fetch: (request) => {
      requests.push(request);
      return fetch(request);
    },
  });
  return { instance, requests };
}

const NOTICE = JSON.stringify({ notification: { title: "Build finished", body: "The task is done.", tag: "session-1:task:completed" } });

describe("WebPushSender.send", () => {
  it("sends a message the device can read, at high urgency, with a VAPID assertion for the push service", async () => {
    const device = subscription();
    const { instance, requests } = sender(() => Promise.resolve(answer(201)));
    const result = await instance.send(device.record, NOTICE);

    expect(result).toEqual({ subscriptionId: "device-1", outcome: "sent", status: 201, reason: undefined });
    const request = present(requests[0], "the request");
    expect(request.method).toBe("POST");
    expect(request.url).toBe(ENDPOINT);
    expect(request.headers["Urgency"]).toBe(PUSH_URGENCY);
    expect(request.headers["TTL"]).toBe(String(DEFAULT_PUSH_TTL_SECONDS));
    expect(request.headers["Content-Type"]).toBe("aes128gcm");
    expect(request.headers["Content-Length"]).toBe(String(request.body.length));

    const authorization = present(request.headers["Authorization"], "the Authorization header");
    const assertion = /^vapid t=([\w.-]+), k=([\w-]+)$/u.exec(authorization);
    expect(assertion).not.toBeNull();
    expect(assertion?.[2]).toBe(keys.publicKey);
    const claims = present(assertion?.[1], "the assertion");
    const [header, payload, signature] = present(claims, "the assertion").split(".");
    expect(JSON.parse(String(Buffer.from(present(header, "the header"), "base64url")))).toEqual({ typ: "JWT", alg: "ES256" });
    const parsed = JSON.parse(String(Buffer.from(present(payload, "the payload"), "base64url"))) as { aud: string; exp: number; sub: string };
    expect(parsed.aud).toBe("https://push.example.com");
    expect(parsed.sub).toBe("https://github.com/Gang-of-Beads/pi-web");
    expect(parsed.exp - Math.floor(Date.now() / 1000)).toBeGreaterThan(0);
    expect(signature).toBeTruthy();

    const decrypted = decryptPushPayload(device.privateKey, device.authToken, request.body);
    expect(decrypted).toBe(NOTICE);
  });

  it("keeps a TTL inside the ceiling every push service honors", async () => {
    const device = subscription();
    const { instance, requests } = sender(() => Promise.resolve(answer(201)), { ttlSeconds: MAX_PUSH_TTL_SECONDS * 4 });
    await instance.send(device.record, NOTICE);
    expect(present(requests[0], "the request").headers["TTL"]).toBe(String(MAX_PUSH_TTL_SECONDS));
  });

  it("reports a subscription the push service says is gone, quoting its answer", async () => {
    const device = subscription();
    const { instance } = sender(() => Promise.resolve(answer(410, { body: "push subscription has unsubscribed or expired." })));
    const result = await instance.send(device.record, NOTICE);
    expect(result.outcome).toBe("expired");
    expect(result.status).toBe(410);
    expect(result.reason).toBe("push subscription has unsubscribed or expired.");
  });

  it("reports a refused VAPID assertion with the reason the service gave, so a reader can tell whose key is at fault", async () => {
    const device = subscription();
    const { instance } = sender(() => Promise.resolve(answer(403, { body: '{"reason":"BadJwtToken"}' })));
    const result = await instance.send(device.record, NOTICE);
    expect(result.outcome).toBe("unauthorized");
    expect(result.status).toBe(403);
    expect(result.reason).toBe("BadJwtToken");
  });

  it("reports a rejected request and a service failure with the status that produced them", async () => {
    const device = subscription();
    const rejected = sender(() => Promise.resolve(answer(400, { body: '{"reason":"BadWebPushRequest"}' })));
    expect(await rejected.instance.send(device.record, NOTICE)).toMatchObject({ outcome: "rejected", status: 400, reason: "BadWebPushRequest" });

    const broken = sender(() => Promise.resolve(answer(503, { statusText: "Service Unavailable" })));
    expect(await broken.instance.send(device.record, NOTICE)).toMatchObject({ outcome: "failed", status: 503, reason: "Service Unavailable" });
  });

  it("reports rate limiting with the delay the service asked for", async () => {
    const device = subscription();
    const { instance } = sender(() => Promise.resolve(answer(429, { headers: { "retry-after": "30" } })));
    const result = await instance.send(device.record, NOTICE);
    expect(result.outcome).toBe("failed");
    expect(result.status).toBe(429);
    expect(result.reason).toContain("30s");
  });

  it("reports a device the network never reached, with the code that says why", async () => {
    const device = subscription();
    const timeout = Object.assign(new TypeError("fetch failed"), { cause: { code: "UND_ERR_CONNECT_TIMEOUT" } });
    const { instance } = sender(() => Promise.reject(timeout));
    const result = await instance.send(device.record, NOTICE);
    expect(result.outcome).toBe("unreachable");
    expect(result.status).toBeUndefined();
    expect(result.reason).toContain("UND_ERR_CONNECT_TIMEOUT");
  });

  it("refuses a payload over the budget and a subscription with no usable key, without asking the network", async () => {
    const device = subscription();
    const oversized = sender(() => Promise.resolve(answer(201)));
    const tooBig = JSON.stringify({ notification: { title: "x", body: "y".repeat(4000) } });
    const bigResult = await oversized.instance.send(device.record, tooBig);
    expect(bigResult.outcome).toBe("rejected");
    expect(bigResult.reason).toContain("budget");
    expect(oversized.requests).toHaveLength(0);

    const brokenKeys = sender(() => Promise.resolve(answer(201)));
    const result = await brokenKeys.instance.send({ ...device.record, publicKey: "not-a-key" }, NOTICE);
    expect(result.outcome).toBe("rejected");
    expect(brokenKeys.requests).toHaveLength(0);
  });

  it("refuses an endpoint whose origin it cannot read, without asking the network", async () => {
    const device = subscription();
    const { instance, requests } = sender(() => Promise.resolve(answer(201)));
    const result = await instance.send({ ...device.record, endpoint: "push.example.com/1" }, NOTICE);
    expect(result.outcome).toBe("rejected");
    expect(result.reason).toContain("HTTPS");
    expect(requests).toHaveLength(0);
  });
});

describe("the push transport's address family", () => {
  it("treats a socket that never connected as a reason to try the other family, and a service's answer as one", () => {
    expect(isConnectFailure(Object.assign(new Error("fetch failed"), { cause: { code: "ETIMEDOUT" } }))).toBe(true);
    expect(isConnectFailure(Object.assign(new Error("fetch failed"), { cause: { code: "EHOSTUNREACH" } }))).toBe(true);
    expect(isConnectFailure(Object.assign(new Error("boom"), { code: "UND_ERR_SOCKET" }))).toBe(true);
    expect(isConnectFailure(Object.assign(new Error("aggregate"), { cause: Object.assign(new Error("aggregate"), { errors: [Object.assign(new Error("nested"), { code: "ENETUNREACH" })] }) }))).toBe(true);
    expect(isConnectFailure(new Error("The push service answered 403"))).toBe(false);
  });
});

describe("serviceReason", () => {
  it("quotes a push service's own reason on one line", () => {
    expect(serviceReason('{"reason":"BadJwtToken"}')).toBe("BadJwtToken");
    expect(serviceReason("push subscription\n   has unsubscribed.")).toBe("push subscription has unsubscribed.");
    expect(serviceReason("")).toBeUndefined();
    expect(serviceReason(undefined)).toBeUndefined();
    expect(serviceReason("not json at all")).toBe("not json at all");
  });

  it("caps what it repeats, so a page never renders a megabyte of service body", () => {
    const long = serviceReason("x".repeat(4000));
    expect(long ?? "").toHaveLength(160);
    expect(long?.endsWith("\u2026")).toBe(true);
  });

  it("decodes a public key the sender puts on the wire", () => {
    expect(base64UrlDecode(keys.publicKey)).toHaveLength(65);
  });
});
