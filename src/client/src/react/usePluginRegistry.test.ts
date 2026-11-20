// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { html } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PiWebPlugin, PiWebPluginRegistration } from "../plugins/types";

const { loadExternalPlugins } = vi.hoisted(() => ({ loadExternalPlugins: vi.fn() }));
vi.mock("../plugins/external", () => ({ loadExternalPlugins }));

import { usePluginRegistry } from "./usePluginRegistry";

let container: HTMLDivElement;
let root: Root;

function RegistryProbe({ machineId }: { readonly machineId: string }) {
  const runtime = usePluginRegistry({ machineId });
  const panels = runtime.registry?.getWorkspacePanels().map(panel => panel.title).join(",") ?? "loading";
  return createElement("output", null, `${panels}|${runtime.failures.join(";")}`);
}

function testRegistration(dispose: () => void): PiWebPluginRegistration {
  const plugin: PiWebPlugin = {
    apiVersion: 2,
    name: "External test plugin",
    activate: () => ({
      contributions: {
        workspacePanels: [{ id: "test", title: "External panel", render: () => html`<p>Ready</p>` }],
      },
      dispose,
    }),
  };
  return { id: "external-test", plugin };
}

describe("React plugin registry bootstrap", () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    loadExternalPlugins.mockReset();
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    document.body.replaceChildren();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    vi.restoreAllMocks();
  });

  it("registers core and external plugins, isolates duplicate ids, and disposes on machine change", async () => {
    const dispose = vi.fn();
    loadExternalPlugins.mockResolvedValue({
      registrations: [
        { id: "core", plugin: { apiVersion: 2, name: "duplicate", activate: () => ({ contributions: {} }) } },
        testRegistration(dispose),
      ],
      failures: [],
    });

    await act(async () => {
      root.render(createElement(RegistryProbe, { machineId: "local" }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("External panel");
    expect(container.textContent).toContain("core: Duplicate plugin id");
    expect(loadExternalPlugins).toHaveBeenCalledWith("pi-web-plugins/manifest.json", {});

    await act(async () => {
      root.render(createElement(RegistryProbe, { machineId: "remote-a" }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(loadExternalPlugins).toHaveBeenLastCalledWith("api/machines/remote-a/pi-web-plugins/manifest.json", { machineId: "remote-a" });
  });

  it("shows manifest failures without hiding the core registry", async () => {
    loadExternalPlugins.mockRejectedValue(new Error("manifest unavailable"));

    await act(async () => {
      root.render(createElement(RegistryProbe, { machineId: "local" }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("manifest unavailable");
    expect(container.textContent).not.toBe("loading|manifest unavailable");
  });
});
