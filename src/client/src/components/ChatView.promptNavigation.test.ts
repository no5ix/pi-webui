// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatView } from "./ChatView";
import type { ChatLine } from "./shared";
import type { SessionStatus } from "../api";

function status(over: Partial<SessionStatus> = {}): SessionStatus {
  return {
    sessionId: "s",
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    pendingMessageCount: 0,
    queuedMessages: [],
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
    ...over,
  };
}

function line(role: ChatLine["role"], text: string, timestamp?: string): ChatLine {
  return { role, parts: [{ type: "text", text }], ...(timestamp === undefined ? {} : { meta: { timestamp } }) };
}

async function transcript(messages: ChatLine[]): Promise<{ view: ChatView; host: ShadowRoot }> {
  const view = new ChatView();
  view.sessionId = "s";
  view.status = status();
  view.messages = messages;
  document.body.append(view);
  await view.updateComplete;
  const host = view.shadowRoot;
  if (host === null) throw new Error("the transcript rendered no shadow root");
  return { view, host };
}

/**
 * happy-dom has no layout, so a transcript measured with rects reports every message at offset zero.
 * The steppers are built on those offsets, so the test gives the rows the positions a browser would.
 * The prompts are addressed by index: a message's text is rendered by a lazy element, so a card's
 * `textContent` is its header label, and matching a card by its words would be a test that passes by
 * accident when the lazy renderer is ahead.
 */
function withLayout(host: ShadowRoot, promptTops: number[]) {
  const chat = host.querySelector<HTMLElement>(".chat");
  if (chat === null) throw new Error("the transcript has no scroller");
  const prompts = Array.from(host.querySelectorAll("article.msg.user:not(.command)"));
  // A browser reports a rect in the viewport, so a scrolled transcript puts a prompt above the window at
  // a negative top. The stub models that - content offset minus the scroll - so a test cannot pass by
  // giving every row the position it has at the top of the transcript.
  const rectOf = (contentTop: number) => rectObject(contentTop - chat.scrollTop, 100);
  for (const card of Array.from(host.querySelectorAll("article.msg"))) {
    const index = prompts.indexOf(card);
    Object.defineProperty(card, "getBoundingClientRect", { configurable: true, value: () => (index >= 0 ? rectOf(promptTops[index] ?? 0) : rectObject(0, 100)) });
  }
  Object.defineProperty(chat, "getBoundingClientRect", { configurable: true, value: () => rectObject(0, 600) });
  Object.defineProperty(chat, "clientHeight", { configurable: true, value: 600 });
  Object.defineProperty(chat, "scrollTop", { configurable: true, writable: true, value: 0 });
  const scrollTo = vi.fn();
  Object.defineProperty(chat, "scrollTo", { configurable: true, value: scrollTo });
  return { chat, scrollTo, prompts: prompts.length };
}

function rectObject(top: number, height: number): DOMRect {
  return { top, bottom: top + height, left: 0, right: 0, width: 0, height, x: 0, y: top, toJSON: () => ({}) };
}

/** A control the reader presses, read from the rendered transcript. */
function press(host: ShadowRoot, label: string): void {
  const button = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (button === null) throw new Error(`the transcript has no ${label} control`);
  button.click();
}

afterEach(() => { document.body.replaceChildren(); });

describe("the controls at both ends of a message", () => {
  // A reader who has read a long reply looks for copy, date and time where the text ended. A reader who
  // has not started one looks where the card begins. Both, not a choice between the two.
  it("draws the meta row at the top of the card and at its end", async () => {
    const { host } = await transcript([line("user", "the prompt", "2026-03-01T10:00:00.000Z"), line("assistant", "the reply", "2026-03-01T10:02:00.000Z")]);
    const card = host.querySelectorAll("article.msg");
    expect(card.length).toBeGreaterThan(0);
    for (const message of Array.from(card)) {
      if (message.querySelector(".msg-header") === null) continue;
      expect(message.querySelector(".msg-header > .msg-meta-row.top")).not.toBeNull();
      expect(message.querySelector(".msg-meta-row.bottom")).not.toBeNull();
    }
  });

  it("puts a copy control in each row, so the reader reaches it from where their eyes are", async () => {
    const { host } = await transcript([line("assistant", "the reply", "2026-03-01T10:02:00.000Z")]);
    const card = host.querySelector("article.msg");
    if (card === null) throw new Error("the transcript rendered no message");
    expect(card.querySelectorAll(".msg-actions").length).toBe(2);
    expect(card.querySelectorAll('button[title="Copy message"]').length).toBe(2);
  });

  it("keeps the same meta label in both rows, so there is one state to expand", async () => {
    const { host } = await transcript([line("assistant", "the reply", "2026-03-01T10:02:00.000Z")]);
    const metas = Array.from(host.querySelectorAll("article.msg .msg-meta")).map((element) => element.getAttribute("title"));
    expect(metas.length).toBeGreaterThanOrEqual(2);
    expect(new Set(metas).size).toBe(1);
  });
});

describe("stepping between the reader's prompts", () => {
  const prompts = [
    line("user", "first", "2026-03-01T10:00:00.000Z"),
    line("assistant", "answer one", "2026-03-01T10:01:00.000Z"),
    line("user", "second", "2026-03-01T10:05:00.000Z"),
    line("assistant", "answer two", "2026-03-01T10:06:00.000Z"),
  ];

  it("offers the steppers once there is a prompt to step between", async () => {
    const { host } = await transcript(prompts);
    const nav = host.querySelector(".prompt-nav");
    expect(nav).not.toBeNull();
    expect(nav?.querySelector('button[aria-label="Previous prompt"]')).not.toBeNull();
    expect(nav?.querySelector('button[aria-label="Next prompt"]')).not.toBeNull();
  });

  it("keeps exactly two controls present even when there is only one prompt", async () => {
    const { host } = await transcript([line("user", "only"), line("assistant", "answer")]);
    expect(host.querySelectorAll(".prompt-nav button")).toHaveLength(2);
  });

  it("moves the transcript's own scroller when a stepper is pressed", async () => {
    const { view, host } = await transcript(prompts);
    const { chat, prompts: count } = withLayout(host, [0, 900]);
    expect(count).toBe(2);
    press(host, "Next prompt");
    await view.updateComplete;
    // The contract is the position the reader lands on, not the call used to get there: the same
    // smooth-scroll call was a no-op on this scroller in a real browser (2026-11-13).
    expect(Math.round(chat.scrollTop)).toBe(900);
  });

  it("keeps both controls mounted when the conversation changes from one prompt to many", async () => {
    const { view, host } = await transcript([line("user", "first"), line("assistant", "answer")]);
    expect(host.querySelectorAll(".prompt-nav button")).toHaveLength(2);
    view.messages = prompts;
    await view.updateComplete;
    expect(host.querySelectorAll(".prompt-nav button")).toHaveLength(2);
  });

  it("keeps both controls mounted when the jump-to-bottom button changes visibility", async () => {
    const { view, host } = await transcript(prompts);
    const navButtons = () => host.querySelectorAll(".prompt-nav button").length;
    expect(navButtons()).toBe(2);
    const jump = host.querySelector<HTMLButtonElement>(".jump-to-bottom");
    if (jump !== null) jump.click();
    await view.updateComplete;
    expect(navButtons()).toBe(2);
  });

  it("steps back to the previous prompt", async () => {
    const { view, host } = await transcript(prompts);
    const { chat } = withLayout(host, [0, 900]);
    chat.scrollTop = 900;
    press(host, "Previous prompt");
    await view.updateComplete;
    expect(Math.round(chat.scrollTop)).toBe(0);
  });

  it("goes to the newest message when the reader steps past the last prompt", async () => {
    const { view, host } = await transcript(prompts);
    const { chat, scrollTo } = withLayout(host, [0, 900]);
    chat.scrollTop = 900;
    press(host, "Next prompt");
    await view.updateComplete;
    // The scroller has no layout to compute a bottom against, so the follow runs through
    // `scrollToBottom`, whose effect is the follow state it restores.
    expect(view.followsNewest).toBe(true);
    expect(chat.scrollTop).toBe(900);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("leaves the bottom when the reader steps back, so a new message does not snap the view away", async () => {
    const { view, host } = await transcript(prompts);
    const { chat } = withLayout(host, [0, 900]);
    chat.scrollTop = 900;
    expect(view.followsNewest).toBe(true);
    press(host, "Previous prompt");
    await view.updateComplete;
    expect(view.followsNewest).toBe(false);
  });

  it("has nothing to step between in a transcript with no prompts", async () => {
    const { view, host } = await transcript([line("assistant", "answer only")]);
    const chat = host.querySelector<HTMLElement>(".chat");
  if (chat === null) throw new Error("the transcript has no scroller");
    Object.defineProperty(chat, "scrollTo", { configurable: true, value: vi.fn() });
    expect(host.querySelector(".prompt-nav")).toBeNull();
    expect(view.followsNewest).toBe(true);
  });
});
