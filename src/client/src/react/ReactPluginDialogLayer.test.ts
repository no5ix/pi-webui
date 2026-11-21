// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { html } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReactPluginDialogLayer } from "./ReactPluginDialogLayer";
import type { ReactPluginDialogEntry } from "./usePluginRegistry";

let container: HTMLDivElement;
let root: Root;
let invoker: HTMLButtonElement;

function entry(presentation: "overlay" | "fullscreen" = "overlay", close = vi.fn(), id = 1): ReactPluginDialogEntry {
  return {
    kind: "lit",
    id,
    dialog: { label: "Plugin details", presentation, content: html`<button>Plugin action</button>` },
    close,
  };
}

describe("React plugin dialog host", () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    invoker = document.createElement("button");
    document.body.append(invoker);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    document.body.replaceChildren();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    vi.restoreAllMocks();
  });

  it("renders a named plugin surface, traps focus, and closes on Escape", async () => {
    invoker.focus();
    const close = vi.fn();
    await act(async () => {
      root.render(createElement(ReactPluginDialogLayer, { entries: [entry("overlay", close)] }));
      await Promise.resolve();
    });

    const dialog = container.querySelector<HTMLElement>("[role='dialog']");
    const closeButton = container.querySelector<HTMLButtonElement>("[aria-label='Close plugin dialog']");
    if (dialog === null || closeButton === null) throw new Error("Plugin dialog did not render.");
    expect(dialog.getAttribute("aria-label")).toBe("Plugin details");
    expect(container.textContent).toContain("Plugin action");
    expect(document.activeElement).toBe(closeButton);
    const pluginAction = container.querySelector<HTMLButtonElement>(".rw-plugin-surface button");
    if (pluginAction === null) throw new Error("Plugin dialog action did not render.");
    act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true })); });
    expect(document.activeElement).toBe(pluginAction);
    act(() => { pluginAction.focus(); document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true })); });
    expect(document.activeElement).toBe(closeButton);

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(close).toHaveBeenCalledOnce();

    act(() => { root.render(createElement(ReactPluginDialogLayer, { entries: [] })); });
    expect(document.activeElement).toBe(invoker);
  });

  it("keeps focus in the remaining dialog when a stacked dialog closes", async () => {
    const first = entry("overlay", vi.fn(), 1);
    const second = entry("overlay", vi.fn(), 2);
    await act(async () => {
      root.render(createElement(ReactPluginDialogLayer, { entries: [first] }));
      await Promise.resolve();
    });
    await act(async () => {
      root.render(createElement(ReactPluginDialogLayer, { entries: [first, second] }));
      await Promise.resolve();
    });
    const firstClose = container.querySelectorAll<HTMLButtonElement>("[aria-label='Close plugin dialog']")[0];
    const topClose = container.querySelectorAll<HTMLButtonElement>("[aria-label='Close plugin dialog']")[1];
    if (firstClose === undefined || topClose === undefined) throw new Error("Stacked plugin dialogs did not render.");
    expect(document.activeElement).toBe(topClose);
    await act(async () => { root.render(createElement(ReactPluginDialogLayer, { entries: [first] })); await Promise.resolve(); });
    expect(document.activeElement).toBe(firstClose);
  });

  it("keeps fullscreen plugin dialogs open on Escape and closes overlays from the backdrop", async () => {
    const fullscreenClose = vi.fn();
    await act(async () => {
      root.render(createElement(ReactPluginDialogLayer, { entries: [entry("fullscreen", fullscreenClose)] }));
      await Promise.resolve();
    });
    act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(fullscreenClose).not.toHaveBeenCalled();

    const overlayClose = vi.fn();
    await act(async () => {
      root.render(createElement(ReactPluginDialogLayer, { entries: [entry("overlay", overlayClose)] }));
      await Promise.resolve();
    });
    const backdrop = container.querySelector<HTMLElement>(".rw-plugin-dialog-backdrop");
    if (backdrop === null) throw new Error("Plugin dialog backdrop did not render.");
    act(() => { backdrop.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
    expect(overlayClose).toHaveBeenCalledOnce();
  });
});
