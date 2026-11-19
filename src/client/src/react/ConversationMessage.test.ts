// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatLine } from "../chatTypes";
import { ConversationMessage } from "./ConversationMessage";

let container: HTMLDivElement;
let root: Root;

describe("React conversation messages", () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    });
    vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function (this: HTMLDialogElement) {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    });
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    document.body.replaceChildren();
    Reflect.deleteProperty(window, "isSecureContext");
    Reflect.deleteProperty(navigator, "clipboard");
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    vi.restoreAllMocks();
  });

  it("copies the words from a user message through the clipboard service", async () => {
    const copy = vi.fn(() => Promise.resolve());
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copy } });
    const message: ChatLine = { role: "user", parts: [{ type: "text", text: "  preserve this text  " }] };
    await act(async () => { root.render(createElement(ConversationMessage, { message, streaming: false, session: undefined, machineId: "local" })); await Promise.resolve(); });
    const button = container.querySelector<HTMLButtonElement>("button[aria-label='Copy user message']");
    expect(button).not.toBeNull();
    await act(async () => { button?.click(); await Promise.resolve(); });
    expect(copy).toHaveBeenCalledWith("preserve this text");
    expect(container.querySelector("button[aria-label='Copied message']")).not.toBeNull();
  });

  it("opens attached images in a modal viewer and closes it with the native close action", async () => {
    const message: ChatLine = { role: "assistant", parts: [{ type: "image", mimeType: "image/png", data: "aGVsbG8=" }] };
    await act(async () => { root.render(createElement(ConversationMessage, { message, streaming: false, session: undefined, machineId: "local" })); await Promise.resolve(); });
    const image = container.querySelector<HTMLButtonElement>("button[aria-label='View attached image']");
    expect(image).not.toBeNull();
    await act(async () => { image?.click(); await Promise.resolve(); });
    const viewer = container.querySelector<HTMLDialogElement>("dialog[aria-label='Image preview']");
    expect(viewer?.hasAttribute("open")).toBe(true);
    expect(viewer?.querySelector("img")).not.toBeNull();
    const close = container.querySelector<HTMLButtonElement>("button[aria-label='Close image preview']");
    await act(async () => { close?.click(); await Promise.resolve(); });
    expect(viewer?.hasAttribute("open")).toBe(false);
  });
});
