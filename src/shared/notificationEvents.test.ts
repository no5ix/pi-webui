import { describe, expect, it } from "vitest";
import { notificationContent, notificationSessionRoute } from "./notificationEvents.js";
import { NTFY_EVENT_FIELDS, type NotificationEvent } from "./ntfy.js";

/**
 * The wording is the product's, not a provider's: the browser's notification centre and the ntfy
 * notice a phone gets say the same sentence. These tests enumerate every event, so an event added
 * without its words fails here rather than arriving as an empty notification.
 */
describe("notification wording", () => {
  it("says a finished task with the span the server measured", () => {
    const content = notificationContent("completed", { sessionName: "work", durationMs: 125_000 });
    expect(content.title).toBe("PI WEB · work");
    expect(content.message).toContain("Task finished (2m 5s)");
    expect(content.message).toContain("Open PI WEB to read the answer");
  });

  it("says a finished task without inventing a span nobody measured", () => {
    expect(notificationContent("completed", { sessionName: "work" }).message).toBe("Task finished. Open PI WEB to read the answer.");
  });

  it("names the session, because a notification centre lists notices from many places", () => {
    expect(notificationContent("completed", { sessionName: "pi-webui" }).title).toBe("PI WEB · pi-webui");
    expect(notificationContent("completed", { sessionName: "   " }).title).toBe("PI WEB · a session");
  });

  it("says a failed task, and why when the reason is known", () => {
    expect(notificationContent("failed", { sessionName: "work", failureReason: "The provider rejected the request." }).message)
      .toContain("Task failed: The provider rejected the request.");
    expect(notificationContent("failed", { sessionName: "work" }).message).toContain("Task failed.");
  });

  it("says an answer is needed, and what is being asked", () => {
    const content = notificationContent("ask-user", { sessionName: "work", question: "Approve running the tests?" });
    expect(content.message).toContain("Your answer is needed: Approve running the tests?");
    expect(content.message).toContain("Open PI WEB and respond");
  });

  it("gives every event a tag, so a notice is recognisable on a lock screen", () => {
    const events: readonly NotificationEvent[] = ["completed", "failed", "ask-user"];
    for (const event of events) {
      expect(notificationContent(event, { sessionName: "work" }).tags.length).toBeGreaterThan(0);
    }
  });

  it("has words for every event the settings panel offers a switch for", () => {
    const worded = new Set<NotificationEvent>(["completed", "failed", "ask-user"]);
    const switches: readonly string[] = NTFY_EVENT_FIELDS.map((field) => field.key);
    expect(switches).toEqual(["onCompleted", "onFailed", "onAskUser"]);
    expect(worded.size).toBe(switches.length);
  });
});

describe("the route a notice opens", () => {
  it("names the session the notice is about, encoded", () => {
    expect(notificationSessionRoute("abc")).toBe("?session=abc");
    expect(notificationSessionRoute("a b&c")).toBe("?session=a%20b%26c");
  });
});
