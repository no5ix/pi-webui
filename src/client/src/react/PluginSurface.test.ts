// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { html } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PluginSurface, pluginSurfaceResult } from "./PluginSurface";

let container: HTMLDivElement;
let root: Root;

async function show(contribution: Parameters<typeof PluginSurface>[0]["contribution"], pluginLabel = "deploy"): Promise<void> {
  await act(async () => {
    root.render(createElement(PluginSurface, { contribution, pluginLabel }));
    await Promise.resolve();
  });
}

describe("the React plugin surface", () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    document.body.replaceChildren();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    vi.restoreAllMocks();
  });

  it("renders a plugin's own template, with the plugin's own handler", async () => {
    const press = vi.fn();
    await show(html`<b>Deploys</b><button @click=${press}>Run</button>`);
    const surface = container.querySelector("[data-pi-plugin-surface]");
    expect(surface?.textContent).toContain("Deploys");
    const button = surface?.querySelector("button");
    await act(async () => {
      button?.click();
      await Promise.resolve();
    });
    expect(press).toHaveBeenCalledOnce();
  });

  it("replaces a contribution when the plugin returns a new one, without keeping the old content", async () => {
    await show(html`<b>first</b>`);
    expect(container.textContent).toContain("first");
    await show(html`<b>second</b>`);
    expect(container.textContent).toContain("second");
    expect(container.textContent).not.toContain("first");
  });

  it("leaves no plugin DOM behind when the surface unmounts", async () => {
    await show(html`<b>Deploys</b><button>Run</button>`);
    act(() => {
      root.render(createElement("div", null));
    });
    expect(container.querySelector("[data-pi-plugin-surface]")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("names the plugin whose template production throws, and keeps the surface usable", async () => {
    const contribution = pluginSurfaceResult("deploy", () => {
      throw new Error("boom while rendering");
    });
    await show(contribution);
    expect(container.textContent).toContain("deploy");
    expect(container.textContent).toContain("boom while rendering");
    const next = pluginSurfaceResult("deploy", () => html`<b>Deploys</b>`);
    await show(next);
    expect(container.textContent).toContain("Deploys");
    expect(container.textContent).not.toContain("boom");
  });

  it("keeps the surrounding surface when a plugin's own binding throws", async () => {
    // lit-html swallows an exception raised inside a binding's own function, so the host cannot name
    // the plugin for it; this is why `pluginSurfaceResult` catches where a template is produced.
    await show(html`<b>Deploys</b><span>${() => {
      throw new Error("inside a binding");
    }}</span>`);
    const surface = container.querySelector("[data-pi-plugin-surface]");
    expect(surface?.querySelectorAll("b").length).toBe(1);
    expect(surface?.textContent).toContain("Deploys");
  });
});
