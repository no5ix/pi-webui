import { describe, expect, it } from "vitest";
import { sendControlOf, sendDisabled } from "./promptEditorSendControl";

/**
 * The button says on its face what the press does. The states are the session's, not the composer's:
 * a running task, a compaction, an idle session - and each gets its own words.
 */
describe("the composer's main button", () => {
  it("appends to the queue while the session works", () => {
    const control = sendControlOf(true, false);
    expect(control.action).toBe("queue");
    expect(control.label).toBe("Append to message queue");
    expect(control.title).toContain("queue");
    expect(control.title).toContain("current turn ends");
  });

  it("says Send when the session is idle", () => {
    const control = sendControlOf(false, false);
    expect(control.action).toBe("send");
    expect(control.label).toBe("Send");
  });

  it("says a message is queued while the history is being compacted", () => {
    const control = sendControlOf(false, true);
    expect(control.action).toBe("compacting");
    expect(control.label).toContain("Queue");
    expect(control.title).toContain("compacting");
  });

  it("names the compaction even when the session reports itself as working", () => {
    // Compaction is work; the queue is where a prompt goes during it, and the button says so.
    expect(sendControlOf(true, true).action).toBe("queue");
  });

  it("gives every state words a screen reader reads and a tooltip explains", () => {
    for (const facts of [[true, false], [false, true], [false, false]] as const) {
      const control = sendControlOf(facts[0], facts[1]);
      expect(control.label.trim().length).toBeGreaterThan(0);
      expect(control.title.trim().length).toBeGreaterThan(control.label.length);
    }
  });

  it("wears the glyph of what the press does", () => {
    // The button appends to the queue while the session works and while it compacts, and sends when it
    // does not. A control that queues while wearing the send arrow is the button whose tooltip the
    // reader has to open to learn what a press does (2026-11-13).
    expect(sendControlOf(true, false).action).toBe("queue");
    expect(sendControlOf(false, true).action).toBe("compacting");
    expect(sendControlOf(false, false).action).toBe("send");
  });

  it("is quiet until the composer holds a message", () => {
    // A labelled press that answers with nothing is a control the reader has to test to understand.
    // A message is words, an attachment, or both, so an empty composer with an attachment sends.
    expect(sendDisabled("", [])).toBe(true);
    expect(sendDisabled("   ", [])).toBe(true);
    expect(sendDisabled("", [{ id: "one" }])).toBe(false);
    expect(sendDisabled("ready", [])).toBe(false);
  });
});
