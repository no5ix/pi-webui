import { describe, expect, it } from "vitest";
import { appBaseFor, describeDevice, describeSend, describeState, notificationLogLines, probeRegistration, testBody } from "./push-probe.mjs";

/**
 * The reading side of the push test script.
 *
 * A push test is only useful if what it prints can be trusted, so the parts that decide what a
 * reader learns are tested: a probe subscription has to be a subscription a push service would
 * parse (a 65-byte uncompressed key, a 16-byte secret), the state has to name the VAPID contact
 * and the message window because those are the two settings that make Apple refuse every device,
 * a send has to report what the push service answered rather than that the request succeeded, and
 * a log line has to be printed without the address the notice was sent to.
 */

function decodeBase64Url(value) {
  return Buffer.from(value, "base64url");
}

describe("a probe device", () => {
  it("is a subscription a push service can parse, at a real push service", () => {
    const registration = probeRegistration("apple", "https://host.example/ts/");

    expect(registration.endpoint.startsWith("https://web.push.apple.com/")).toBe(true);
    expect(registration.appBaseUrl).toBe("https://host.example/ts/");
    const key = decodeBase64Url(registration.keys.p256dh);
    expect(key.length).toBe(65);
    expect(key[0]).toBe(0x04);
    expect(decodeBase64Url(registration.keys.auth).length).toBe(16);
  });

  it("addresses each push service the way that service is reached", () => {
    const endpoints = Object.keys({ apple: 1, fcm: 1, mozilla: 1, wns: 1 }).map((service) => probeRegistration(service, "http://127.0.0.1:8506/").endpoint);

    expect(endpoints).toEqual([
      expect.stringMatching(/^https:\/\/web\.push\.apple\.com\//u),
      expect.stringMatching(/^https:\/\/fcm\.googleapis\.com\/fcm\/send\//u),
      expect.stringMatching(/^https:\/\/updates\.push\.services\.mozilla\.com\/wpush\/v2\//u),
      expect.stringMatching(/^https:\/\/wns2-bl2p\.notify\.windows\.com\/w\/\?token=/u),
    ]);
  });

  it("refuses an unknown push service instead of registering a made-up address", () => {
    expect(() => probeRegistration("kde", "http://127.0.0.1:8506/")).toThrow(/Unknown probe push service/u);
  });
});

describe("the address a device's notices open", () => {
  it("keeps the app's path and ends in one slash", () => {
    expect(appBaseFor("https://host.example:8506")).toBe("https://host.example:8506/");
    expect(appBaseFor("https://host.example:8506/ts")).toBe("https://host.example:8506/ts/");
    expect(appBaseFor("https://host.example:8506/ts/")).toBe("https://host.example:8506/ts/");
  });

  it("drops a query a proxy link carried, which is not part of the app's address", () => {
    expect(appBaseFor("https://host.example:8506/?session=abc")).toBe("https://host.example:8506/");
  });
});

describe("what the server's push state teaches a reader", () => {
  const answer = {
    status: 200,
    body: {
      state: { configured: true, disabled: false, source: "generated", subject: "https://github.com/Gang-of-Beads/pi-web", ttlSeconds: 86400, allowedTailnetLogins: [] },
      publicKey: "BA8I8WO_QqRhK3WYxcm46Pw4Ebku1QMeebQkg6O4UcA",
      problem: undefined,
      devices: [{ id: "a1b2c3d4-0000-0000-0000-000000000000", label: "Safari on iPhone", pushService: "web.push.apple.com", tailnetLogin: "reader@example.com", createdAt: "2026-11-01T08:00:00.000Z", lastDeliveredAt: undefined, lastFailure: { at: "2026-11-02T09:00:00.000Z", outcome: "rejected", status: 400, reason: "BadWebPushRequest" }, endpoint: "https://web.push.apple.com/SECRET", publicKey: "SECRETKEY", authToken: "SECRETAUTH" }],
    },
  };

  it("names the contact and the window, the two settings that make a service refuse every device", () => {
    const text = describeState(answer).lines.join("\n");

    expect(text).toContain("contact sent to push services: https://github.com/Gang-of-Beads/pi-web");
    expect(text).toContain("message window: 86400s");
    expect(text).toContain("allowed tailnet logins: (none named: the network is the boundary)");
    expect(text).toContain("registered devices: 1");
    expect(text).toContain("by reader@example.com");
    expect(text).toContain("last refused rejected 400 BadWebPushRequest");
  });

  it("never prints the endpoint address or the subscription keys it was given", () => {
    const text = describeState(answer).lines.join("\n");

    expect(text).not.toContain("SECRET");
    expect(text).not.toContain("web.push.apple.com/SECRET");
    expect(text).not.toContain("SECRETKEY");
    expect(text).not.toContain("SECRETAUTH");
  });

  it("says a device was never accepted when nothing has arrived at it", () => {
    expect(describeDevice({ id: "a1b2c3d4", label: "Edge on macOS", pushService: "fcm.googleapis.com" })).toContain("never accepted");
  });
});

describe("what a send reports", () => {
  it("is the push services' answers, device by device, not a request that succeeded", () => {
    const send = describeSend({
      status: 200,
      body: {
        targets: 3,
        results: [
          { deviceId: "a", label: "Safari on iPhone", outcome: "rejected", status: 400, reason: "BadWebPushRequest" },
          { deviceId: "b", label: "Chrome on Android", outcome: "sent", status: 201 },
          { deviceId: "c", label: "An expired phone", outcome: "expired", status: 410, reason: "push subscription has unsubscribed or expired." },
        ],
      },
    });

    expect(send.total).toBe(3);
    expect(send.accepted).toBe(1);
    const text = send.lines.join("\n");
    expect(text).toContain("3 device(s) sent to");
    expect(text).toContain("Safari on iPhone: rejected 400 (BadWebPushRequest)");
    expect(text).toContain("Chrome on Android: sent 201");
  });

  it("reports 0 devices rather than a success when there was nobody to send to", () => {
    const send = describeSend({ status: 200, body: { targets: 0, results: [] } });

    expect(send.total).toBe(0);
    expect(send.lines.join("\n")).toContain("0 device(s) sent to");
  });

  it("shows the server's own refusal when the send was refused", () => {
    const send = describeSend({ status: 409, body: { problem: "This PI WEB has no VAPID key pair." } });

    expect(send.lines.join("\n")).toContain("server says: This PI WEB has no VAPID key pair.");
  });
});

describe("the daemon's delivery log", () => {
  it("reads the delivery lines and drops the address the notice was sent to", () => {
    const log = [
      '{"msg":"[notifications] task_completed for session-1: 0 of 1 device(s) accepted by their push service; a1b2c3d4: rejected status 400 (BadWebPushRequest)"}',
      '{"msg":"GET /api/push/state 200"}',
      '{"msg":"sending to https://wns2-bl2p.notify.windows.com/w/?token=SECRETVALUE"}',
    ].join("\n");

    const lines = notificationLogLines(log);

    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("0 of 1 device(s) accepted by their push service");
    expect(lines.join("\n")).not.toContain("SECRETVALUE");
  });

  it("keeps a refusal line with the reason the push service gave", () => {
    const line = notificationLogLines('{"msg":"[notifications] run_failed for s: 0 of 1; zz: timeout (connect ETIMEDOUT 20.236.44.4:443)"}')[0];

    expect(line).toContain("timeout");
    expect(line).toContain("ETIMEDOUT");
  });
});

describe("the session a test notice speaks about", () => {
  it("travels with the identity a notice opens, and carries no invented target", () => {
    expect(testBody({ sessionId: "s-1", sessionName: "Work" })).toEqual({ sessionId: "s-1", sessionName: "Work", projectName: "" });
  });
});
