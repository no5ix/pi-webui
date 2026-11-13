// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "./ChatView";
import type { ChatView } from "./ChatView";
import type { ChatLine } from "./shared.js";

/**
 * The two conversation controls, against rows the page really rendered.
 *
 * happy-dom lays every row out at zero, so a scroll position cannot be asserted; what is asserted is
 * what the page decides - which rows are prompts and answers, what the controls are therefore able to
 * offer, and what they say they will do.
 */
describe("ChatView conversation navigation", () => {
  beforeEach(() => {
    document.body.innerHTML = "<chat-view></chat-view>";
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  const said = (role: "user" | "assistant", text: string): ChatLine => ({ role, parts: [{ type: "text", text }] });
  const worked = (name: string): ChatLine => ({
    role: "assistant",
    parts: [{ type: "toolExecution", toolName: name, summary: `Ran ${name}`, status: "success" }],
  });

  async function mount(messages: ChatLine[]): Promise<ChatView> {
    const view = document.body.querySelector<ChatView>("chat-view");
    if (view === null) throw new Error("chat view did not mount");
    view.messages = messages;
    await view.updateComplete;
    return view;
  }

  /**
   * The navigation state and the row reader the test drives, read through a boundary that is checked
   * at run time: a ChatView that renamed them fails the test with a sentence, not with `undefined`.
   */
  interface ConversationNavigationInternals {
    syncConversationNavigation(): void;
    conversationRowsInView(): { index: number; role: string }[];
    readonly jumpToPromptVisible: boolean;
    readonly nextResponseIndex: number | undefined;
  }

  function isNavigation(view: unknown): view is ConversationNavigationInternals {
    if (typeof view !== "object" || view === null) return false;
    return typeof Reflect.get(view, "syncConversationNavigation") === "function" && typeof Reflect.get(view, "conversationRowsInView") === "function";
  }

  function navigation(view: ChatView): ConversationNavigationInternals {
    if (!isNavigation(view)) throw new Error("ChatView has no conversation navigation to drive");
    return view;
  }

  const renderedRows = (view: ChatView): { index: number; role: string }[] => navigation(view).conversationRowsInView();

  const state = (view: ChatView): { promptVisible: boolean; nextResponse: number | undefined } => ({
    promptVisible: navigation(view).jumpToPromptVisible,
    nextResponse: navigation(view).nextResponseIndex,
  });

  it("reads the rows the page rendered, in the order the transcript has them", async () => {
    const view = await mount([said("user", "first"), worked("read"), said("assistant", "answer"), said("user", "second")]);
    expect(renderedRows(view).map((row) => [row.index, row.role])).toEqual([[0, "user"], [1, "other"], [2, "assistant"], [3, "user"]]);
  });

  it("offers the next answer, and no prompt, to a reader at the top of the transcript", async () => {
    const view = await mount([said("user", "first"), worked("read"), said("assistant", "answer")]);
    Reflect.set(view, "pinnedToBottom", false);
    navigation(view).syncConversationNavigation();
    expect(state(view)).toEqual({ promptVisible: false, nextResponse: 2 });
    await view.updateComplete;
    expect(view.renderRoot.querySelector(".jump-to-prompt")).toBeNull();
    expect(view.renderRoot.querySelector(".jump-to-newest")?.getAttribute("title")).toBe("Jump to the next answer");
  });

  it("offers the last prompt, and nothing below, to a reader at the bottom", async () => {
    const view = await mount([said("user", "first"), said("assistant", "answer"), said("user", "second")]);
    Reflect.set(view, "pinnedToBottom", true);
    Reflect.set(view, "jumpToBottomVisible", false);
    navigation(view).syncConversationNavigation();
    expect(state(view)).toEqual({ promptVisible: true, nextResponse: undefined });
    await view.updateComplete;
    const up = view.renderRoot.querySelector(".jump-to-prompt");
    expect(up?.getAttribute("aria-label")).toBe("Jump to the last prompt you sent");
    // At the newest row there is nothing under the reader, and a control that jumps nowhere is not shown.
    expect(view.renderRoot.querySelector(".jump-to-newest")).toBeNull();
  });

  it("keeps the newest control when there is no answer below, so the arrow at the bottom of a conversation never disappears", async () => {
    const view = await mount([said("user", "first"), said("assistant", "answer")]);
    Reflect.set(view, "pinnedToBottom", true);
    Reflect.set(view, "jumpToBottomVisible", true);
    navigation(view).syncConversationNavigation();
    await view.updateComplete;
    expect(state(view).nextResponse).toBeUndefined();
    expect(view.renderRoot.querySelectorAll(".jump-to-newest")).toHaveLength(1);
  });

  it("renders neither control when the transcript has nothing to navigate", async () => {
    const view = await mount([]);
    Reflect.set(view, "pinnedToBottom", true);
    Reflect.set(view, "jumpToBottomVisible", false);
    navigation(view).syncConversationNavigation();
    await view.updateComplete;
    expect(view.renderRoot.querySelector(".conversation-navigation")).toBeNull();
  });

  it("recomputes the targets on a new session's rows, not the ones the reader left", async () => {
    const view = await mount([said("user", "first"), said("assistant", "answer")]);
    Reflect.set(view, "pinnedToBottom", true);
    navigation(view).syncConversationNavigation();
    expect(state(view).promptVisible).toBe(true);

    view.sessionId = "session-2";
    view.messages = [];
    await view.updateComplete;
    expect(state(view)).toEqual({ promptVisible: false, nextResponse: undefined });
  });
});
