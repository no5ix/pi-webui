import { describe, it, expect, beforeEach } from "vitest";
import { createECDH } from "node:crypto";
import { DeviceNotificationService, fitEvent, pushPayload, type DeviceNotificationLogger } from "./deviceNotificationService.js";
import { PUSH_PAYLOAD_LIMIT_BYTES } from "./webPushCrypto.js";
import { PushSubscriptionStore } from "./pushSubscriptionStore.js";
import { generateVapidKeyPair } from "./webPushCrypto.js";
import type { PushHttpRequest, PushHttpResponse } from "./webPushSender.js";
import { askNoticeTag, taskNoticeTag, type DeviceNotificationEvent } from "../../../shared/notificationEvents.js";
import { noticeOf, present } from "./notifications.testSupport.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const keys = generateVapidKeyPair();

const event = (id: string, kind: DeviceNotificationEvent["kind"] = "task_completed"): DeviceNotificationEvent => ({
  id,
  kind,
  sessionId: "session-1",
  sessionName: "Refactor the parser",
  projectName: "pi-webui",
  occurredAt: "2026-11-05T10:00:00.000Z",
  outcome: "completed",
  elapsedMs: 134_000,
  title: "Refactor the parser finished",
  body: "Finished in 2m 14s. pi-webui - open PI WEB to read the answer.",
});

function device(endpoint: string, appBaseUrl = "https://pi.example/laptop/") {
  const ecdh = createECDH("prime256v1");
  return {
    endpoint,
    keys: { p256dh: ecdh.generateKeys("base64url", "uncompressed"), auth: "cHVzaC1hdXRoLXNlY3JldC0xMjM0" },
    appBaseUrl,
    userAgent: "iPhone",
  };
}

class Harness {
  readonly directory = mkdtempSync(join(tmpdir(), "pi-web-notify-"));
  readonly store = new PushSubscriptionStore({ filePath: join(this.directory, "subscriptions.json") });
  readonly sent: PushHttpRequest[] = [];
  readonly log: string[] = [];
  responses = new Map<string, PushHttpResponse>();
  logger: DeviceNotificationLogger = {
    info: (message) => { this.log.push(message); },
    warn: (message) => { this.log.push(message); },
  };

  constructor(options: { enabled?: boolean } = {}) {
    this.service = new DeviceNotificationService({
      subscriptions: this.store,
      keys: { keys, source: "config", problem: undefined },
      subject: "mailto:reader@example.com",
      ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
      logger: this.logger,
      fetch: (request) => {
        this.sent.push(request);
        const response = this.responses.get(request.url);
        return Promise.resolve(response ?? { status: 201, statusText: "Created", header: () => undefined });
      },
    });
  }

  service: DeviceNotificationService;

  async registerDevices(count: number): Promise<string[]> {
    const ids: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const registered = await this.store.register(device(`https://push.example.com/${String(index)}`));
      ids.push(present(registered, "the registration").record.id);
    }
    return ids;
  }

  cleanup(): void {
    rmSync(this.directory, { recursive: true, force: true });
  }
}

let harness: Harness;

beforeEach(() => {
  harness = new Harness();
});

describe("DeviceNotificationService", () => {
  it("sends one event to every registered device, each with its own address for the tap", async () => {
    const devices = await harness.registerDevices(3);
    const delivery = await harness.service.notify(event("session-1:task:1:completed"));
    expect(delivery.targets).toBe(3);
    expect(delivery.results.map((result) => result.outcome)).toEqual(["sent", "sent", "sent"]);
    expect(harness.sent.length).toBe(3);
    for (const request of harness.sent) {
      expect(request.headers["Authorization"]).toMatch(/^vapid t=/u);
      expect(request.headers["Content-Type"]).toBe("aes128gcm");
      expect(request.headers["TTL"]).toBeTypeOf("string");
    }
    // The body is the aes128gcm record: a 16-byte salt, the record size, the ephemeral key length and
    // point, then the ciphertext. Its plaintext is not readable here by design - the payload is
    // encrypted to the device - and the round trip is proven in webPushCrypto.test.
    const body = present(harness.sent[0], "the request the service sent").body;
    expect(body.readUInt32BE(16)).toBe(4096);
    expect(body.readUInt8(20)).toBe(65);
    expect(body.length).toBeGreaterThan(21 + 65);
    // The tap address is built per device from the address that device registered with.
    const built = pushPayload(event("e"), "https://pi.example/phone/");
    expect(noticeOf(built, "the payload")["url"]).toBe("https://pi.example/phone/?session=session-1");
    expect(devices.length).toBe(3);
  });

  it("sends one event once: an id already sent inside the window is dropped", async () => {
    await harness.registerDevices(2);
    const first = await harness.service.notify(event("session-1:task:1:completed"));
    const second = await harness.service.notify(event("session-1:task:1:completed"));
    expect(first.deduped).toBe(false);
    expect(second.deduped).toBe(true);
    expect(harness.sent.length).toBe(2);
  });

  it("sends an event that reached no device again, once a device exists", async () => {
    const before = await harness.service.notify(event("session-1:task:5:completed"));
    expect(before.targets).toBe(0);
    await harness.registerDevices(1);
    const after = await harness.service.notify(event("session-1:task:5:completed"));
    // An event that told nobody is not an event the reader has been told about. The id is only spent
    // on a send that was attempted, so the same lifecycle fact is still able to reach a phone.
    expect(after.deduped).toBe(false);
    expect(after.results[0]?.outcome).toBe("sent");
  });

  it("clips a notice that is too long in its prose fields, and keeps the payload valid JSON", () => {
    const long = { ...event("session-1:task:7:completed"), title: "Session ".padEnd(4000, "\u00fc"), body: "Failed after 3m. ".padEnd(9000, "q") };
    const payload = JSON.stringify(pushPayload(fitEvent(long, "https://pi.example/phone/"), "https://pi.example/phone/"));
    expect(Buffer.byteLength(payload, "utf8")).toBeLessThanOrEqual(PUSH_PAYLOAD_LIMIT_BYTES);
    const notice = noticeOf(JSON.parse(payload), "the clipped payload");
    expect(String(notice["title"])).toContain("Session");
    expect(String(notice["body"])).toContain("\u2026");
    expect(notice["tag"]).toBe(taskNoticeTag("session-1", "completed"));
  });

  it("refuses a notice that cannot be made to fit, and says so, instead of sending bytes nobody can read", async () => {
    await harness.registerDevices(1);
    const impossible = { ...event("session-1:task:8:completed"), projectName: "p".repeat(5000), body: "done" };
    const delivery = await harness.service.notify(impossible);
    expect(delivery.results[0]?.outcome).toBe("rejected");
    expect(delivery.results[0]?.reason).toContain("budget");
    expect(harness.sent).toHaveLength(0);
  });

  it("drops the subscriptions the push service says are gone, and keeps the live ones", async () => {
    await harness.registerDevices(3);
    harness.responses.set("https://push.example.com/1", { status: 410, statusText: "Gone", header: () => undefined });
    const delivery = await harness.service.notify(event("session-1:task:2:completed"));
    expect(delivery.results.map((result) => result.outcome)).toEqual(["sent", "expired", "sent"]);
    const rest = await harness.store.list();
    expect(rest.map((entry) => entry.endpoint)).toEqual(["https://push.example.com/0", "https://push.example.com/2"]);
    expect(harness.log.some((line) => line.includes("of 3 device(s)"))).toBe(true);
  });

  it("reports a partial delivery as a warning, and counts it against the device", async () => {
    await harness.registerDevices(2);
    harness.responses.set("https://push.example.com/0", { status: 500, statusText: "Push service unavailable", header: () => undefined });
    const delivery = await harness.service.notify(event("session-1:task:3:completed"));
    expect(delivery.results.map((result) => result.outcome)).toEqual(["failed", "sent"]);
    expect(harness.log.some((line) => line.startsWith("[notifications] task_completed") && line.includes("1 of 2"))).toBe(true);
    const failing = (await harness.store.list()).find((entry) => entry.endpoint === "https://push.example.com/0");
    expect(failing?.failures).toBe(1);
  });

  it("treats an unreachable push service as a failed send, not a crash", async () => {
    await harness.registerDevices(1);
    harness.responses.clear();
    const failing = new DeviceNotificationService({
      subscriptions: harness.store,
      keys: { keys, source: "config", problem: undefined },
      subject: "mailto:reader@example.com",
      logger: harness.logger,
      fetch: () => Promise.reject(new Error("socket hang up")),
    });
    const delivery = await failing.notify(event("session-1:task:4:completed"));
    expect(delivery.results[0]?.outcome).toBe("unreachable");
  });

  it("sends nothing when push is off, and says why", async () => {
    const off = new Harness({ enabled: false });
    await off.registerDevices(2);
    const delivery = await off.service.notify(event("session-1:task:5:completed"));
    expect(delivery.targets).toBe(0);
    expect(off.service.publicKey()).toBeUndefined();
    expect(off.service.problem()).toContain("push.enabled");
    off.cleanup();
  });

  it("sends nothing when it has no VAPID key pair, and reports the reason", async () => {
    const service = new DeviceNotificationService({ subscriptions: harness.store, keys: { keys: undefined, source: "none", problem: "No VAPID key pair is available." }, subject: "mailto:a@b.c", logger: harness.logger });
    const delivery = await service.notify(event("session-1:task:6:completed"));
    expect(delivery.targets).toBe(0);
    expect(await service.state()).toMatchObject({ configured: false, subscriptions: 0 });
  });

  it("carries the shared notification key as the tag, so a browser that gets both paths shows one", () => {
    const payload = pushPayload(event("session-1:task:9:completed", "task_failed"), "https://pi.example/phone/");
    const notice = noticeOf(payload, "the payload");
    expect(notice["tag"]).toBe(taskNoticeTag("session-1", "completed"));
    expect(notice["eventId"]).toBe("session-1:task:9:completed");
    expect(notice["kind"]).toBe("task_failed");
    expect(notice["outcome"]).toBe("completed");
    expect(notice["elapsedMs"]).toBe(134_000);
  });

  it("puts an asking notice on the session's asking key, not the dialog's", () => {
    const asking: DeviceNotificationEvent = {
      id: "session-1:ask:dialog-7",
      kind: "user_input_required",
      sessionId: "session-1",
      sessionName: "Refactor the parser",
      projectName: "pi-webui",
      occurredAt: "2026-11-05T10:00:00.000Z",
      questionCount: 2,
      title: "Refactor the parser is asking",
      body: "2 questions are waiting. pi-webui",
    };
    expect(noticeOf(pushPayload(asking, "https://pi.example/phone/"), "the asking payload")["tag"]).toBe(askNoticeTag("session-1"));
  });

  it("leaves out the url for a device that registered no application address", () => {
    const empty = noticeOf(pushPayload(event("e"), ""), "the payload of a request with no base address");
    expect(empty["url"]).toBeUndefined();
  });

  it("reports its state for the settings panel", async () => {
    await harness.registerDevices(2);
    expect(await harness.service.state()).toEqual({ disabled: false, configured: true, source: "config", subscriptions: 2 });
  });
});
