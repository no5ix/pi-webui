import { describe, it, expect } from "vitest";
import {
  askNoticeTag,
  askUserQuestionCount,
  isAppBaseUrl,
  isBase64Url,
  isPushEndpoint,
  isQuestionnaireCard,
  noticeTagFor,
  notificationSessionUrl,
  parsePushRegistration,
  PUSH_APP_BASE_MAX_LENGTH,
  PUSH_ENDPOINT_MAX_LENGTH,
  PUSH_KEY_MAX_LENGTH,
  taskNoticeTag,
} from "./notificationEvents.js";

const device = {
  endpoint: "https://push.example.com/a",
  keys: { p256dh: "BKdfQlY3BpNWVwaGVraU5naGVpa29QYXNzd29yZDEyMzQ1Njc4OTBhYmNkZWY", auth: "tVfJ1-example-auth" },
};

describe("parsePushRegistration", () => {
  const refusal = (value: unknown): string => {
    const parsed = parsePushRegistration(value);
    if (parsed.ok) throw new Error("the registration was accepted, so there is no refusal to read");
    return parsed.refusal;
  };

  it("accepts the registration a browser hands over, and carries it in its typed form", () => {
    const parsed = parsePushRegistration({ ...device, appBaseUrl: "https://pi.example/laptop/", userAgent: "iPhone" });
    if (!parsed.ok) throw new Error(`the browser's own registration was refused: ${parsed.refusal}`);
    expect(parsed.registration).toEqual({
      endpoint: device.endpoint,
      keys: { p256dh: device.keys.p256dh, auth: device.keys.auth },
      appBaseUrl: "https://pi.example/laptop/",
      userAgent: "iPhone",
    });
  });

  it("refuses an endpoint that is not https, the rule the browser enforces on delivery", () => {
    expect(refusal({ ...device, endpoint: "http://push.example/a" })).toContain("HTTPS");
    expect(refusal({ ...device, endpoint: "not a url" })).toContain("HTTPS");
    expect(refusal({ ...device, endpoint: "   " })).toContain("endpoint");
    expect(isPushEndpoint("https://push.example/a?key=secret")).toBe(true);
  });

  it("refuses a subscription whose keys are not base64url, before it is stored and fails every send", () => {
    expect(refusal({ ...device, keys: { ...device.keys, p256dh: "not base64!" } })).toContain("public key");
    expect(refusal({ ...device, keys: { ...device.keys, auth: "not base64!" } })).toContain("auth");
    expect(refusal({ ...device, keys: undefined })).toContain("no keys");
  });

  it("refuses an application address the browser would not navigate to", () => {
    expect(refusal({ ...device, appBaseUrl: "javascript:alert(1)" })).toContain("application address");
    expect(refusal({ ...device, appBaseUrl: "https://pi.example/a?next=https://evil.example/" })).toContain("application address");
    expect(refusal({ ...device, appBaseUrl: "https://user:pw@pi.example/a" })).toContain("application address");
    expect(refusal({ ...device, appBaseUrl: "x".repeat(PUSH_APP_BASE_MAX_LENGTH + 1) })).toContain("application address");
    expect(parsePushRegistration({ ...device, appBaseUrl: "https://pi.example/a/b" }).ok).toBe(true);
  });

  it("refuses a device label that is not a label", () => {
    expect(refusal({ ...device, userAgent: "x".repeat(300) })).toContain("device label");
    expect(refusal({ ...device, userAgent: 7 })).toContain("device label");
  });

  it("is total about junk", () => {
    expect(refusal(undefined)).toContain("not an object");
    expect(refusal("x")).toContain("not an object");
    expect(refusal({ endpoint: 1, keys: {} })).toContain("endpoint");
  });

  it("bounds the fields at the sizes the Web Push ciphers and the push services use", () => {
    expect(PUSH_KEY_MAX_LENGTH).toBeGreaterThanOrEqual(43);
    expect(PUSH_ENDPOINT_MAX_LENGTH).toBeGreaterThan(1_000);
    expect(isBase64Url("BKdf-Quals_abc", PUSH_KEY_MAX_LENGTH)).toBe(true);
    expect(isBase64Url("", PUSH_KEY_MAX_LENGTH)).toBe(false);
    expect(isBase64Url("has spaces", PUSH_KEY_MAX_LENGTH)).toBe(false);
    expect(isBase64Url("x".repeat(PUSH_KEY_MAX_LENGTH + 1), PUSH_KEY_MAX_LENGTH)).toBe(false);
    expect(isAppBaseUrl("https://pi.example/")).toBe(true);
  });
});

describe("notificationSessionUrl", () => {
  it("is the address that opens the session the notice is about", () => {
    expect(notificationSessionUrl("https://pi.example/desktop/", "session-1")).toBe("https://pi.example/desktop/?session=session-1");
    expect(notificationSessionUrl("https://example.com/pi/", "session-1")).toBe("https://example.com/pi/?session=session-1");
  });

  it("carries only the session, so a stored address's query and fragment cannot ride along", () => {
    expect(notificationSessionUrl("https://pi.example/a?x=1", "session-1")).toBe("https://pi.example/a?session=session-1");
    expect(notificationSessionUrl("https://pi.example/a#frag", "session-1")).toBe("https://pi.example/a?session=session-1");
  });

  it("encodes the session id, because it is a query value", () => {
    expect(notificationSessionUrl("https://pi.example/a", "a/b")).toBe("https://pi.example/a?session=a%2Fb");
  });

  it("is total about the junk a stored address can have become", () => {
    expect(notificationSessionUrl("", "session-1")).toBeUndefined();
    expect(notificationSessionUrl("not a url", "session-1")).toBeUndefined();
    expect(notificationSessionUrl("javascript:alert(1)", "session-1")).toBeUndefined();
    expect(notificationSessionUrl("data:text/html,hi", "session-1")).toBeUndefined();
    expect(notificationSessionUrl("https://user@pi.example/a", "session-1")).toBeUndefined();
    expect(notificationSessionUrl("https://pi.example/a", "")).toBeUndefined();
  });
});

describe("notice tags", () => {
  it("is one key per session and verdict, so a device that hears about one event twice shows it once", () => {
    expect(taskNoticeTag("s", "completed")).toBe("s:task:completed");
    expect(taskNoticeTag("s", "failed")).toBe("s:task:failed");
    expect(taskNoticeTag("s", "cancelled")).toBe("s:task:cancelled");
    expect(taskNoticeTag("s", "failed")).not.toBe(taskNoticeTag("s", "cancelled"));
    expect(askNoticeTag("s")).toBe("s:ask");
  });

  it("is the same string the push payload carries and the page posts, because both call this one function", () => {
    expect(noticeTagFor({ kind: "task_completed", sessionId: "s", outcome: "completed" })).toBe(taskNoticeTag("s", "completed"));
    expect(noticeTagFor({ kind: "user_input_required", sessionId: "s" })).toBe(askNoticeTag("s"));
  });

  it("does not key a notice to a run's end time, which the page's clock and the daemon's clock mint apart", () => {
    const tag = noticeTagFor({ kind: "task_failed", sessionId: "s", outcome: "failed" });
    expect(tag).not.toContain(String(Date.now()));
  });
});

describe("askUserQuestionCount", () => {
  it("counts the answerable fields of a card, and a heading is not a question", () => {
    expect(askUserQuestionCount({ kind: "custom", screen: { kind: "card", fields: [
      { type: "text", id: "intro", text: "before we start" },
      { type: "choice", id: "a", label: "A?", options: [] },
      { type: "input", id: "b", label: "B?" },
    ] } })).toBe(2);
  });

  it("counts the one question a dialog with no card asks", () => {
    expect(askUserQuestionCount({ kind: "confirm" })).toBe(1);
    expect(askUserQuestionCount({ kind: "select", options: ["a", "b"] })).toBe(1);
    expect(askUserQuestionCount({ kind: "custom" })).toBe(1);
  });

  it("calls a card that asks nothing a card that asks nothing", () => {
    expect(isQuestionnaireCard({ kind: "custom", screen: { kind: "card", fields: [{ type: "text", id: "t", text: "presented" }] } })).toBe(false);
    expect(isQuestionnaireCard({ kind: "custom", screen: { kind: "card", fields: [{ type: "confirm", id: "c", label: "Ship?" }] } })).toBe(true);
    expect(isQuestionnaireCard({ kind: "custom" })).toBe(false);
  });
});
