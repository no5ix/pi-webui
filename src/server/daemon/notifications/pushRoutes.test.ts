import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createECDH } from "node:crypto";
import { registerPushRoutes } from "./pushRoutes.js";
import { DeviceNotificationService } from "./deviceNotificationService.js";
import { PushSubscriptionStore, PUSH_SUBSCRIPTION_LIMIT } from "./pushSubscriptionStore.js";
import { generateVapidKeyPair } from "./webPushCrypto.js";
import { answered, present } from "./notifications.testSupport.js";
import type { PushHttpResponse } from "./webPushSender.js";

/**
 * The push routes as the daemon serves them.
 *
 * The `describe` titles name the path a browser sees (`/api/push/*`), because that is the product
 * contract; the injected URLs are the daemon's own unprefixed paths, because the web/API strips
 * `/api` before it forwards. `sessionProxyRoutes.push.test.ts` pins the other half of that contract.
 */

const keys = generateVapidKeyPair();
const quiet = { info: () => undefined, warn: () => undefined };

function device(endpoint = "https://push.example.com/registered") {
  const ecdh = createECDH("prime256v1");
  return {
    endpoint,
    keys: { p256dh: ecdh.generateKeys("base64url", "uncompressed"), auth: "cHVzaC1hdXRoLXNlY3JldC0xMjM0" },
    appBaseUrl: "https://pi.example/laptop/",
    userAgent: "Mozilla/5.0 (iPhone)",
  };
}

let directory = "";
let app: FastifyInstance;
let service: DeviceNotificationService;
let store: PushSubscriptionStore;
let sent: number;

function buildApp(sender: (url: string) => Promise<PushHttpResponse> = () => Promise.resolve({ status: 201, statusText: "Created", header: () => undefined })): FastifyInstance {
  const instance = Fastify({ logger: false });
  service = new DeviceNotificationService({
    subscriptions: store,
    keys: { keys, source: "config", problem: undefined },
    subject: "mailto:reader@example.com",
    logger: quiet,
    fetch: async (request) => { sent += 1; return sender(request.url); },
  });
  registerPushRoutes(instance, service, store, { createId: () => "test-id" });
  return instance;
}

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "pi-web-push-routes-"));
  store = new PushSubscriptionStore({ filePath: join(directory, "subscriptions.json") });
  sent = 0;
  app = buildApp();
  await app.ready();
});

afterEach(async () => {
  await app.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("the daemon answers the paths the web/API forwards", () => {
  it("serves /push/* unprefixed, because the proxy strips `/api` before it forwards", async () => {
    const state = await app.inject({ method: "GET", url: "/push/state" });
    const registered = await app.inject({ method: "POST", url: "/push/subscriptions", payload: device() });
    expect(state.statusCode).toBe(200);
    expect(registered.statusCode).toBe(200);
    const prefixed = await app.inject({ method: "GET", url: "/api/push/state" });
    expect(prefixed.statusCode).toBe(404);
  });
});

describe("POST /push/subscriptions", () => {
  it("registers no device while the server has push turned off, and says why", async () => {
    const instance = Fastify({ logger: false });
    const off = new DeviceNotificationService({ subscriptions: store, keys: { keys, source: "config", problem: undefined }, subject: "mailto:reader@example.com", enabled: false, logger: quiet, fetch: () => Promise.resolve({ status: 201, statusText: "Created", header: () => undefined }) });
    registerPushRoutes(instance, off, store, { createId: () => "test-id" });
    await instance.ready();
    const refused = await instance.inject({ method: "POST", url: "/push/subscriptions", payload: device() });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toHaveProperty("error");
    expect(await store.list()).toEqual([]);
    expect((await instance.inject({ method: "GET", url: "/push/state" })).json()).toMatchObject({ state: { disabled: true } });
    await instance.close();
  });

  it("registers a device and hands back the id its unregistration needs", async () => {
    const response = await app.inject({ method: "POST", url: "/push/subscriptions", payload: device() });
    expect(response.statusCode).toBe(200);
    const body = answered(response.json(), "the registration");
    expect(body["created"]).toBe(true);
    expect(body["id"]).toBeTypeOf("string");
    const stored = await store.list();
    expect(stored[0]?.appBaseUrl).toBe("https://pi.example/laptop/");
    expect(stored[0]?.userAgent).toBe("Mozilla/5.0 (iPhone)");
  });

  it("keeps one registration per endpoint, so a browser that re-subscribes does not accumulate addresses", async () => {
    await app.inject({ method: "POST", url: "/push/subscriptions", payload: device() });
    const again = await app.inject({ method: "POST", url: "/push/subscriptions", payload: device() });
    expect(again.json()).toMatchObject({ created: false });
    expect((await store.list()).length).toBe(1);
  });

  it("refuses an endpoint that is not https: the browser's own rule, enforced at the door", async () => {
    const response = await app.inject({ method: "POST", url: "/push/subscriptions", payload: { ...device(), endpoint: "http://push.example/insecure" } });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "The push endpoint must be an HTTPS URL" });
    expect(await store.count()).toBe(0);
  });

  it("refuses a registration with no keys, and a body that is not a registration", async () => {
    const missingKeys = await app.inject({ method: "POST", url: "/push/subscriptions", payload: { endpoint: device().endpoint } });
    expect(missingKeys.statusCode).toBe(400);
    expect(missingKeys.json()).toEqual({ error: "The subscription has no keys" });
    // A body that is not JSON never reaches the validator: Fastify refuses the content type. What
    // matters is that nothing is stored.
    const notJson = await app.inject({ method: "POST", url: "/push/subscriptions", payload: "not json", headers: { "content-type": "text/plain" } });
    expect(notJson.statusCode).toBeGreaterThanOrEqual(400);
    expect(notJson.statusCode).toBeLessThan(500);
    expect(await store.count()).toBe(0);
  });

  it("does not let a device claim an address the browser would not navigate to", async () => {
    const response = await app.inject({ method: "POST", url: "/push/subscriptions", payload: { ...device(), appBaseUrl: "javascript:alert(1)" } });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "The application address must be an HTTP(S) URL" });
  });

  it("says the store is full instead of dropping the device", async () => {
    const full = new PushSubscriptionStore({ filePath: join(directory, "full.json") });
    const instance = Fastify({ logger: false });
    registerPushRoutes(instance, service, full);
    await instance.ready();
    for (let index = 0; index < PUSH_SUBSCRIPTION_LIMIT; index += 1) {
      await full.register(device(`https://push.example.com/${String(index)}`));
    }
    const second = await instance.inject({ method: "POST", url: "/push/subscriptions", payload: device("https://push.example.com/one-too-many") });
    expect(second.statusCode).toBe(507);
    expect(second.json()).toEqual({ error: "This PI WEB holds too many push subscriptions. Unsubscribe a device in its browser, then try again." });
    await instance.close();
  });
});

describe("GET /push/state", () => {
  it("gives the browser the public key, the device list, and why there is no key", async () => {
    await store.register(device());
    const response = await app.inject({ method: "GET", url: "/push/state" });
    expect(response.statusCode).toBe(200);
    const registered = await store.list();
    expect(response.json()).toEqual({
      state: { disabled: false, configured: true, source: "config", subscriptions: 1 },
      publicKey: keys.publicKey,
      problem: undefined,
      devices: [{ id: registered[0]?.id, userAgent: "Mozilla/5.0 (iPhone)", createdAt: registered[0]?.createdAt, lastDeliveredAt: undefined, failures: 0 }],
    });
  });

  it("says when the device file did not answer, instead of answering with no devices", async () => {
    writeFileSync(join(directory, "subscriptions.json"), "not json");
    const unreadable = buildApp();
    await unreadable.ready();
    const state: unknown = (await unreadable.inject({ method: "GET", url: "/push/state" })).json();
    expect(state).toMatchObject({ devices: [], devicesUnknown: "the file is not JSON" });
    await unreadable.close();
  });

  it("says so when the server has no key pair to send with", async () => {
    const unconfigured = Fastify({ logger: false });
    registerPushRoutes(unconfigured, new DeviceNotificationService({
      subscriptions: store,
      keys: { keys: undefined, source: "none", problem: "No VAPID key pair is available." },
      subject: "mailto:reader@example.com",
      logger: quiet,
    }), store);
    await unconfigured.ready();
    const unconfiguredState: unknown = (await unconfigured.inject({ method: "GET", url: "/push/state" })).json();
    expect(unconfiguredState).toEqual({
      state: { disabled: false, configured: false, source: "none", subscriptions: 0 },
      publicKey: undefined,
      problem: "No VAPID key pair is available.",
      devices: [],
    });
    await unconfigured.close();
  });
});

describe("DELETE /push/subscriptions/:id", () => {
  it("removes the device, and answers 404 for an id that is not registered", async () => {
    const registered = await store.register(device());
    const id = present(registered, "the registration").record.id;
    expect((await app.inject({ method: "DELETE", url: `/push/subscriptions/${id}` })).json()).toEqual({ removed: true });
    expect(await store.count()).toBe(0);
    expect((await app.inject({ method: "DELETE", url: `/push/subscriptions/${id}` })).statusCode).toBe(404);
  });
});

describe("POST /push/test", () => {
  it("sends a real test push to the registered devices, and reports what it did", async () => {
    await store.register(device());
    const response = await app.inject({ method: "POST", url: "/push/test", payload: { sessionId: "session-1", sessionName: "Refactor the parser", projectName: "pi-webui" } });
    expect(response.statusCode).toBe(200);
    const body = answered(response.json(), "the test push");
    expect(body["targets"]).toBe(1);
    const results = body["results"];
    expect(Array.isArray(results)).toBe(true);
    expect(answered(Array.isArray(results) ? results[0] : undefined, "the send to the registered device")).toMatchObject({ outcome: "sent" });
    expect(body["problem"]).toBeUndefined();
    expect(sent).toBe(1);
  });

  it("reports that nothing was sent when no device is registered", async () => {
    const response = await app.inject({ method: "POST", url: "/push/test", payload: { sessionId: "session-1" } });
    expect(response.statusCode).toBe(200);
    expect(answered(response.json(), "the test push")).toMatchObject({ targets: 0, results: [] });
    expect(sent).toBe(0);
  });

  it("refuses a test with no session to speak about", async () => {
    expect((await app.inject({ method: "POST", url: "/push/test", payload: {} })).statusCode).toBe(400);
  });

  it("reports a send the push service refused, with its status", async () => {
    await app.close();
    app = buildApp(() => Promise.resolve({ status: 500, statusText: "Push service unavailable", header: () => undefined }));
    await app.ready();
    await store.register(device());
    const body = answered((await app.inject({ method: "POST", url: "/push/test", payload: { sessionId: "session-1" } })).json(), "the test push");
    expect(body["targets"]).toBe(1);
    const refused = body["results"];
    expect(Array.isArray(refused)).toBe(true);
    expect(answered(Array.isArray(refused) ? refused[0] : undefined, "the refused send")).toMatchObject({ outcome: "failed", status: 500 });
  });
});
