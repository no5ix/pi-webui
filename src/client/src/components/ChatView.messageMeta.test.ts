// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { ChatView } from "./ChatView";
import { chatDeliveryMarkerVisible } from "./ChatView";
import type { ChatLine } from "./shared";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

async function mount(messages: ChatLine[]): Promise<ChatView> {
  const view = new ChatView();
  view.sessionId = "session-meta";
  view.messages = messages;
  document.body.append(view);
  await view.updateComplete;
  return view;
}

function metaSpans(view: ChatView): HTMLElement[] {
  return [...(view.shadowRoot?.querySelectorAll<HTMLElement>(".msg-meta") ?? [])];
}

describe("the message header's metadata", () => {
  it("names the top row's controls as the top row's", async () => {
    // The same controls hang at both ends of a long card on purpose. Two buttons that say only
    // "Copy user message" give a keyboard reader two indistinguishable stops, on a card that can be
    // many screens tall (2026-11-13).
    const view = await mount([{
      role: "user",
      parts: [{ type: "text", text: "the question" }],
      meta: { timestamp: "2026-07-10T19:15:30.000Z" },
    }]);
    const names = [...(view.shadowRoot?.querySelectorAll<HTMLElement>(".msg-meta-row button") ?? [])]
      .map((button) => button.getAttribute("aria-label") ?? "")
      .filter((name) => name.startsWith("Copy"));
    expect(names.length).toBe(2);
    expect(names.some((name) => name.includes("top of the message"))).toBe(true);
    expect(names.some((name) => !name.includes("top of the message"))).toBe(true);
  });

  it("is shown for a message the server has described", async () => {
    const view = await mount([{
      role: "assistant",
      parts: [{ type: "text", text: "answer" }],
      meta: { timestamp: "2026-07-10T19:15:30.000Z", model: { provider: "anthropic", id: "claude-opus-5" } },
    }]);

    const [span] = metaSpans(view);
    expect(span?.textContent).toContain("anthropic/claude-opus-5");
  });

  // A message just typed here has no server metadata, which is its ordinary
  // state: the header used to announce that in the place a timestamp sits.
  it("is left out entirely for a message that has none", async () => {
    const view = await mount([{ role: "user", parts: [{ type: "text", text: "just typed" }] }]);

    expect(metaSpans(view).length).toBe(0);
    expect(view.shadowRoot?.textContent ?? "").not.toContain("No Pi message metadata");
  });

  it("keeps the described message's header when an undescribed one sits beside it", async () => {
    const view = await mount([
      { role: "user", parts: [{ type: "text", text: "just typed" }] },
      {
        role: "assistant",
        parts: [{ type: "text", text: "answer" }],
        meta: { timestamp: "2026-07-10T19:15:30.000Z", model: { provider: "anthropic", id: "claude-opus-5" } },
      },
    ]);

    // The controls are drawn at both ends of a card, so a described message carries its metadata twice -
    // in the sticky strip and under the text - and the message the server has not described carries none
    // at all, at either end.
    const spans = metaSpans(view);
    expect(spans).toHaveLength(2);
    expect(spans.every((span) => span.textContent.includes("anthropic/claude-opus-5"))).toBe(true);
  });
});

describe("which messages carry a delivery marker", () => {
  /**
   * Messages read back from the transcript have no delivery record and showed
   * nothing, while messages sent this session kept a double tick forever. The
   * same settled message therefore looked one way before a reload and another
   * way after, and the transcript was a mix of ticks, yellow queue chips and
   * bare bubbles with no rule connecting them.
   *
   * A marker says the outcome is not settled yet. Once the agent has taken the
   * message, there is nothing left to report, and the bubble looks like every
   * other message the agent has taken - including the ones from before the
   * reload.
   */

  it("says nothing once the agent has taken the message", () => {
    expect(chatDeliveryMarkerVisible({ state: "delivered", clientMessageId: "m1" })).toBe(false);
  });

  it("says nothing about a message with no delivery record", () => {
    expect(chatDeliveryMarkerVisible(undefined)).toBe(false);
  });
});
