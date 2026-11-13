import { describe, it, expect } from "vitest";
import {
  notificationSessionUrl,
  noticeTagFor,
  parsePushRegistration,
  pushDeviceLabel,
  pushDeviceView,
  pushServiceHost,
  type PushSubscriptionRecord,
} from "./notificationEvents.js";

/**
 * The device-facing half of the push contract, said once.
 *
 * A reader with four devices is picking a row to revoke, and a page is being told which push service
 * refused, so these two derivations are the words the settings panel is built from. The tap target and
 * the notification-centre key are here too: the page that posts its own notice and the push service that
 * delivers the same event call the same functions, and a key they minted apart deduplicates nothing.
 */

function record(overrides: Partial<PushSubscriptionRecord> = {}): PushSubscriptionRecord {
  return {
    id: "device-1",
    endpoint: "https://web.push.apple.com/aAbBcCdD",
    publicKey: "BFimTfWRcGJiyMOeHRC9k7FMCiLrxBMNwBCA4HqmSBMF6",
    authToken: "cHVzaC1hdXRoLXNlY3JldC0xMjM0",
    appBaseUrl: "https://tail.example/piweb/",
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
    tailnetLogin: "reader@example.com",
    tailnetName: "A reader",
    createdAt: "2026-01-01T00:00:00.000Z",
    lastDeliveredAt: undefined,
    lastFailure: { at: "2026-01-02T00:00:00.000Z", outcome: "unauthorized", status: 403, reason: "BadJwtToken" },
    failures: 3,
    ...overrides,
  };
}

describe("pushDeviceLabel", () => {
  it("names a device by the browser and the system a user-agent string carries", () => {
    expect(pushDeviceLabel(record().userAgent)).toBe("Safari on iPhone");
    expect(pushDeviceLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15")).toBe("Safari on Mac");
    expect(pushDeviceLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")).toBe("Chrome on Mac");
    expect(pushDeviceLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0")).toBe("Edge on Mac");
    expect(pushDeviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0")).toBe("Firefox on Windows");
    expect(pushDeviceLabel("Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/131.0.2909.76 Version/17.0 Mobile/15E148 Safari/604.1")).toBe("Edge on iPad");
    expect(pushDeviceLabel("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.135 Mobile Safari/537.36")).toBe("Chrome on Android");
    expect(pushDeviceLabel("Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0")).toBe("Firefox on Linux");
  });

  it("reports what it cannot read as itself, never as a guess", () => {
    expect(pushDeviceLabel("")).toBe("An unlabelled device");
    expect(pushDeviceLabel("PiProbe/1.0")).toBe("PiProbe/1.0");
    expect(pushDeviceLabel(`unreadable-agent-string-without-a-browser-or-a-system-token-anywhere-${"x".repeat(40)}`)).toMatch(/…$/u);
  });
});

describe("pushServiceHost", () => {
  it("names the push service without the token in its endpoint", () => {
    expect(pushServiceHost(record().endpoint)).toBe("web.push.apple.com");
    expect(pushServiceHost("https://wns2-bl2p.notify.windows.com/w/?token=busy-proxying")).toBe("wns2-bl2p.notify.windows.com");
    expect(pushServiceHost("not a url")).toBe("");
  });
});

describe("pushDeviceView", () => {
  it("gives a page everything about a device except what would let it send to the device", () => {
    const view = pushDeviceView(record());

    expect(view).toEqual({
      id: "device-1",
      label: "Safari on iPhone",
      userAgent: record().userAgent,
      pushService: "web.push.apple.com",
      tailnetLogin: "reader@example.com",
      tailnetName: "A reader",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastDeliveredAt: undefined,
      lastFailure: { at: "2026-01-02T00:00:00.000Z", outcome: "unauthorized", status: 403, reason: "BadJwtToken" },
      failures: 3,
    });
    const serialised = JSON.stringify(view);
    expect(serialised).not.toContain("aAbBcCdD");
    expect(serialised).not.toContain(record().authToken);
    expect(serialised).not.toContain(record().publicKey);
  });
});

describe("noticeTagFor", () => {
  it("keys a device's notices on the session and the verdict, never on the run", () => {
    expect(noticeTagFor({ kind: "task_completed", sessionId: "s1", outcome: "completed" })).toBe("s1:task:completed");
    expect(noticeTagFor({ kind: "task_failed", sessionId: "s1", outcome: "failed" })).toBe("s1:task:failed");
    expect(noticeTagFor({ kind: "user_input_required", sessionId: "s1" })).toBe("s1:ask");
    // Two runs that end the same way share a key, so a device shows one notice for a session, not a stack.
    expect(noticeTagFor({ kind: "task_completed", sessionId: "s1", outcome: "completed" }))
      .toBe(noticeTagFor({ kind: "task_completed", sessionId: "s1", outcome: "completed" }));
  });

  it("keeps sessions apart, so one session's notice never replaces another's", () => {
    expect(noticeTagFor({ kind: "task_completed", sessionId: "s1", outcome: "completed" }))
      .not.toBe(noticeTagFor({ kind: "task_completed", sessionId: "s2", outcome: "completed" }));
  });
});

describe("notificationSessionUrl", () => {
  it("builds the tap on the address the device itself registered with", () => {
    expect(notificationSessionUrl("https://tail.example/piweb/", "s 1")).toBe("https://tail.example/piweb/?session=s+1");
    expect(notificationSessionUrl("https://tail.example/piweb/?tool=chat#top", "s1")).toBe("https://tail.example/piweb/?session=s1");
    expect(notificationSessionUrl("https://tail.example/piweb/", "")).toBeUndefined();
    expect(notificationSessionUrl("javascript:alert(1)", "s1")).toBeUndefined();
  });
});

describe("parsePushRegistration", () => {
  const subscription = { endpoint: "https://push.example.com/1", keys: { p256dh: "BFimTfWRcGJiyMOeHRC9k7FMCiLrxBMNwBCA4HqmSBMF6", auth: "cHVzaC1hdXRoLXNlY3JldC0xMjM0" } };

  it("stores what a device registers, and says why it refused what it did not", () => {
    expect(parsePushRegistration(subscription)).toEqual({ ok: true, registration: { endpoint: "https://push.example.com/1", keys: subscription.keys } });
    expect(parsePushRegistration({ ...subscription, endpoint: "http://push.example.com/1" })).toMatchObject({ ok: false, refusal: "The push endpoint must be an HTTPS URL" });
    expect(parsePushRegistration({ ...subscription, keys: { p256dh: "not base64 url", auth: subscription.keys.auth } })).toMatchObject({ ok: false, refusal: "The subscription's public key is not base64url" });
    expect(parsePushRegistration({ ...subscription, appBaseUrl: "https://user@evil.example/" })).toMatchObject({ ok: false, refusal: "The application address must be an HTTP(S) URL" });
    expect(parsePushRegistration(null)).toMatchObject({ ok: false, refusal: "The registration is not an object" });
  });
});
