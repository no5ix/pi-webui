// @vitest-environment happy-dom

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * The browser's side of the push contract, against a faked HTTP boundary.
 *
 * The panel's words are the product here. A push service accepting a message is the most the server
 * can know, and a reader who is told "notifications sent" and sees no notification on a locked phone
 * learns to distrust the panel. So the sentences that report a send, and the state that says a device
 * list did not answer, are pinned against the answers the routes really give - and the device rows are
 * checked to carry nothing that would let a page send to a device on its own.
 */

const http = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../api/http", () => ({ request: http.request }));

import { emptyPushPanelState, pushPanelState, revokePushDevice, sendPushTest, sendPushTestToDevice } from "./webPush";

/**
 * Answer a call the way `request` does: the route's parser is applied to the body, because the module
 * under test hands `request` a parser and trusts it to run. A mock that returned the body directly
 * would test the fixture, not the parsing.
 */
function serve(value: unknown): void {
  http.request.mockImplementation((_path: string, parse: (body: unknown) => unknown) => Promise.resolve(parse(value)));
}

const STATE = {
  state: { disabled: false, configured: true, source: "config", subscriptions: 1, subject: "https://github.com/Gang-of-Beads/pi-web", ttlSeconds: 86400, allowedTailnetLogins: ["reader@example.com"] },
  publicKey: "BFimTfWRcGJiyMOeHRC9k7FMCiLrxBMNwBCA4HqmSBMF6",
  problem: undefined,
  devices: [{
    id: "device-1",
    label: "Safari on iPhone",
    userAgent: "Mozilla/5.0 (iPhone)",
    pushService: "web.push.apple.com",
    tailnetLogin: "reader@example.com",
    tailnetName: "A reader",
    createdAt: "2026-11-01T08:00:00.000Z",
    lastDeliveredAt: "2026-11-02T09:30:00.000Z",
    lastFailure: { at: "2026-11-03T10:00:00.000Z", outcome: "unauthorized", status: 403, reason: "BadJwtToken" },
    failures: 2,
    endpoint: "https://web.push.apple.com/super-secret-token",
    publicKey: "BFimTfWRcGJiyMOeHRC9k7FMCiLrxBMNwBCA4HqmSBMF6",
    authToken: "c3VwZXItc2VjcmV0LWF1dGg",
  }],
};

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  http.request.mockReset();
});

describe("pushPanelState", () => {
  it("reads the device list the server sends, including whose device each row is", async () => {
    serve(STATE);

    const panel = await pushPanelState();

    expect(panel.serverConfigured).toBe(true);
    expect(panel.allowedTailnetLogins).toEqual(["reader@example.com"]);
    expect(panel.devices[0]).toMatchObject({
      id: "device-1",
      label: "Safari on iPhone",
      pushService: "web.push.apple.com",
      tailnetLogin: "reader@example.com",
      tailnetName: "A reader",
      lastDeliveredAt: "2026-11-02T09:30:00.000Z",
      lastFailure: { outcome: "unauthorized", status: 403, reason: "BadJwtToken" },
      failures: 2,
    });
  });

  it("keeps a device's push address and keys out of the panel's state", async () => {
    serve(STATE);

    const panel = await pushPanelState();

    const serialised = JSON.stringify(panel);
    expect(serialised).not.toContain("super-secret-token");
    expect(serialised).not.toContain("c3VwZXItc2VjcmV0LWF1dGg");
  });

  it("says the list did not answer when the server did not answer, and does not call that zero devices", async () => {
    http.request.mockRejectedValue(new Error("the daemon is not listening"));

    const panel = await pushPanelState();

    expect(panel.devices).toEqual([]);
    expect(panel.readFailure).toBe("the daemon is not listening");
    expect(panel.devicesUnknown).toBeUndefined();
    expect(panel.serverConfigured).toBe(false);
  });

  it("carries the server's own reason for a device file it cannot read", async () => {
    serve({ ...STATE, devices: [], devicesUnknown: "the file is not JSON" });

    expect((await pushPanelState()).devicesUnknown).toBe("the file is not JSON");
  });

  it("flags this device as registered with a push key the server no longer has", async () => {
    localStorage.setItem("pi-web.push.subscription", "device-1");
    localStorage.setItem("pi-web.push.vapid", "OLD-PUBLIC-KEY");
    serve(STATE);

    expect((await pushPanelState()).keyChanged).toBe(true);

    localStorage.setItem("pi-web.push.vapid", STATE.publicKey);
    serve(STATE);
    expect((await pushPanelState()).keyChanged).toBe(false);
  });
});

describe("a test push's answer", () => {
  it("says the push service accepted, never that a person was notified", async () => {
    serve({ targets: 2, problem: undefined, results: [{ outcome: "sent" }, { outcome: "sent" }] });

    const answer = await sendPushTest("session-1", "Refactor the parser", "pi-webui");

    expect(answer.reason).toContain("The push service accepted the message for all 2 device(s)");
    expect(answer.reason).toContain("may accept a message and stay quiet");
    expect(answer.reason.toLowerCase()).not.toContain("notified");
  });

  it("counts the devices that refused, and points at the device rows for the reason", async () => {
    serve({ targets: 3, problem: undefined, results: [{ outcome: "sent" }, { outcome: "unauthorized" }, { outcome: "expired" }] });

    expect((await sendPushTest("session-1", "Refactor the parser", "pi-webui")).reason)
      .toContain("accepted the message for 1 of 3 device(s); 2 refused");
  });

  it("says nothing was sent when no device is registered, in the server's words when it has any", async () => {
    serve({ targets: 0, problem: "Push is turned off in the PI WEB config.", results: [] });

    expect((await sendPushTest("session-1", "Refactor the parser", "pi-webui")).reason).toBe("Push is turned off in the PI WEB config.");
  });

  it("sends to one device at its own route", async () => {
    serve({ targets: 1, problem: undefined, results: [{ outcome: "sent" }] });

    const answer = await sendPushTestToDevice("device 1", "session-1", "Refactor the parser", "pi-webui");

    expect(answer.reason).toContain("The push service accepted the message for all 1 device(s)");
    const url = String(http.request.mock.calls[0]?.[0]);
    expect(url).toBe("api/push/subscriptions/device%201/test");
  });
});

describe("revoking a device", () => {
  it("removes the device the server confirms, and says so", async () => {
    serve({ removed: true });

    expect((await revokePushDevice("device-1")).reason).toContain("no longer registered");
    expect(String(http.request.mock.calls[0]?.[0])).toBe("api/push/subscriptions/device-1");
  });

  it("says nothing was removed when the server says the row was not there", async () => {
    serve({ removed: false });

    const outcome = await revokePushDevice("device-1");
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toContain("nothing was removed");
  });

  it("reports a server that refused as a failed revocation, not as a success", async () => {
    http.request.mockRejectedValue(new Error("403 Forbidden"));

    const outcome = await revokePushDevice("device-1");
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toContain("403 Forbidden");
  });
});

describe("emptyPushPanelState", () => {
  it("is a state a panel can render before the server has answered, with no devices and no claims", () => {
    const panel = emptyPushPanelState("granted");

    expect(panel.support).toBe("granted");
    expect(panel.devices).toEqual([]);
    expect(panel.self).toBeUndefined();
    expect(panel.readFailure).toBeUndefined();
    expect(panel.keyChanged).toBe(false);
  });
});
