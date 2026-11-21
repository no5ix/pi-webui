// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { html } from "lit";
import { PluginRegistry } from "../../plugins/registry";
import { PluginReactSurface } from "./PluginReactSurface";
import { createPluginReactHostUi } from "./pluginReactHostUi";
import { PluginReactConfirmLayer, usePluginReactConfirm, type ReactPluginConfirmQueue } from "./pluginReactConfirm";
import type { PluginActivationContext, PluginConfirmRequest, PluginReactHostUi } from "../../../../plugin-api";

let container: HTMLDivElement;
let root: Root;

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
  container.remove();
});

function render(node: Parameters<Root["render"]>[0]) {
  return act(async () => {
    root.render(node);
    await Promise.resolve();
  });
}

describe("the React contribution surface", () => {
  it("draws a plugin's React contribution", async () => {
    await render(createElement(PluginReactSurface, {
      contributionId: "panel:git",
      pluginLabel: "Git",
      node: createElement("strong", null, "3 changes"),
    }));
    expect(container.textContent).toContain("3 changes");
  });

  it("names the plugin when its contribution is not a React node, and keeps the rest of the page", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await render(createElement("div", null, [
      createElement(PluginReactSurface, { key: "a", contributionId: "panel:goal", pluginLabel: "Goals", node: html`<b>goal</b>` }),
      createElement("span", { key: "b" }, "the rest of the page"),
    ]));
    expect(container.textContent).toContain("Goals");
    expect(container.textContent).toContain("Lit template");
    expect(container.textContent).toContain("the rest of the page");
    expect(errors).toHaveBeenCalled();
  });

  it("shows the plugin's own report when its component throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const exploding = () => {
      throw new Error("the diagram engine is missing");
    };
    await render(createElement(PluginReactSurface, { contributionId: "fence:mermaid", pluginLabel: "Mermaid", node: createElement(exploding) }));
    expect(container.textContent).toContain("Mermaid");
    expect(container.textContent).toContain("diagram engine");
  });
});

describe("the React host UI a plugin is handed", () => {
  function activateOn(registry: PluginRegistry): PluginReactHostUi | undefined {
    let handed: PluginReactHostUi | undefined;
    registry.register({
      id: "react-plugin",
      plugin: {
        apiVersion: 2,
        name: "react-plugin",
        activate: (context: PluginActivationContext) => {
          handed = context.reactUi;
          return { contributions: {} };
        },
      },
    });
    return handed;
  }

  it("arrives on the activation context, with the host's components on it", () => {
    const registry = new PluginRegistry({
      reactUi: createPluginReactHostUi({ showDialog: () => ({ close: () => undefined }), confirm: () => Promise.resolve(false) }),
    });
    const handed = activateOn(registry);
    expect(handed).toBeDefined();
    expect(typeof handed?.Button).toBe("function");
    expect(typeof handed?.MessageField).toBe("function");
    expect(handed?.breakpoints.mobileNavigation).toContain("max-width");
    expect(typeof handed?.copyText).toBe("function");
    expect(handed?.describeError(new Error("boom"))).toContain("boom");
  });

  it("refuses to name React a plugin did not get", () => {
    expect(activateOn(new PluginRegistry({}))).toBeUndefined();
  });
});

describe("a plugin's confirmation", () => {
  let queue: ReactPluginConfirmQueue | undefined;

  function Harness() {
    const created = usePluginReactConfirm();
    queue = created;
    return createElement(PluginReactConfirmLayer, { queue: created });
  }

  function ask(title: string) {
    const request: PluginConfirmRequest = { title, message: "It cannot be undone.", confirmLabel: "Remove" };
    let answer: boolean | undefined;
    void queue?.ask(request).then((confirmed) => {
      answer = confirmed;
    });
    return () => answer;
  }

  async function press(label: string) {
    // The ask happened outside React's act scope, so the dialog is drawn on the next flush: pressing a
    // key the page has not drawn yet would answer nothing and read as a broken dialog.
    await act(async () => {
      await Promise.resolve();
    });
    const key = [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === label);
    return act(async () => {
      key?.click();
      await Promise.resolve();
    });
  }

  it("asks on the app's own dialog and waits", async () => {
    await render(createElement(Harness));
    const current = ask("Remove the worktree?");
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Remove the worktree?");
    expect(container.textContent).toContain("Remove");
    expect(current()).toBeUndefined();
  });

  it("answers true only for the confirming key", async () => {
    await render(createElement(Harness));
    const current = ask("Remove the worktree?");
    await press("Remove");
    expect(current()).toBe(true);
    expect(container.querySelector("dialog")).toBeNull();
  });

  it("answers false for a dismissal", async () => {
    await render(createElement(Harness));
    const current = ask("Remove the worktree?");
    await press("Cancel");
    expect(current()).toBe(false);
  });
});
