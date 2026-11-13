import { describe, expect, it } from "vitest";
import { notificationEdge, stoppedByReaderFacts } from "./sessionNotificationEdges";
import type { SessionActivityCategory } from "../../../shared/sessionActivityState";

const CATEGORIES: readonly SessionActivityCategory[] = ["asking", "error", "working", "opening", "background", "idle"];

/** Every pair the app can move between, so an unclassified edge fails here rather than in production. */
function edge(previous: SessionActivityCategory | undefined, next: SessionActivityCategory | undefined, stoppedByReader = false) {
  return notificationEdge({ previous, next, stoppedByReader });
}

describe("the notification edge", () => {
  it("calls a finished task completed, from every kind of work", () => {
    expect(edge("working", "idle")).toBe("completed");
    expect(edge("opening", "idle")).toBe("completed");
    expect(edge("background", "idle")).toBe("completed");
  });

  it("calls a session that died mid-task failed, from every kind of work", () => {
    expect(edge("working", "error")).toBe("failed");
    expect(edge("opening", "error")).toBe("failed");
    expect(edge("background", "error")).toBe("failed");
  });

  it("calls a question ask-user, once", () => {
    expect(edge("working", "asking")).toBe("ask-user");
    expect(edge("idle", "asking")).toBe("ask-user");
    expect(edge("asking", "asking")).toBe("none");
  });

  it("stays quiet when the reader answered their own question", () => {
    // Leaving `asking` is the reader responding: they are at the page, and the session going back to
    // work is not an event they asked to be told about.
    expect(edge("asking", "working")).toBe("none");
    expect(edge("asking", "idle")).toBe("none");
    expect(edge("asking", "error")).toBe("none");
  });

  it("stays quiet about a run the reader stopped themselves", () => {
    expect(edge("working", "idle", true)).toBe("none");
    expect(edge("working", "error", true)).toBe("none");
  });

  it("stays quiet when the run the reader stopped ends by asking", () => {
    // A dialog can open as the run is being cut. The falling edge then lands on `asking`, and a notice
    // that reports a run the reader interrupted is not news - the Stop is the reader's own act (2026-11-13).
    expect(edge("working", "asking", true)).toBe("none");
    expect(edge("background", "asking", true)).toBe("none");
    expect(edge("working", "asking", false)).toBe("ask-user");
  });

  it("invents nothing where it has not seen the session before", () => {
    expect(edge(undefined, "idle")).toBe("none");
    expect(edge("idle", undefined)).toBe("none");
  });

  it("invents nothing for a state that changed without ending work", () => {
    expect(edge("idle", "idle")).toBe("none");
    expect(edge("idle", "working")).toBe("none");
    expect(edge("working", "working")).toBe("none");
    expect(edge("idle", "error")).toBe("none");
    expect(edge("working", "asking")).not.toBe("completed");
  });

  it("answers every pair of states it can be shown", () => {
    for (const previous of CATEGORIES) {
      for (const next of CATEGORIES) {
        expect(["completed", "failed", "ask-user", "none"]).toContain(edge(previous, next));
      }
    }
  });
});

describe("whose stop ended the run", () => {
  it("is the reader's when the daemon says the run is stopping", () => {
    expect(stoppedByReaderFacts(true, false)).toBe(true);
  });

  it("is the reader's when this page sent the Stop, whose flag has already cleared", () => {
    expect(stoppedByReaderFacts(false, true)).toBe(true);
    expect(stoppedByReaderFacts(undefined, true)).toBe(true);
  });

  it("is nobody's when neither says so", () => {
    expect(stoppedByReaderFacts(undefined, false)).toBe(false);
  });
});
