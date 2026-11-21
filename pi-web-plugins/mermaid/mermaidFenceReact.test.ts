// @vitest-environment happy-dom
import { act, createElement } from "react";
import { html, svg } from "lit";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMermaidDrawer, type MermaidLike } from "./mermaidRenderer.js";
import { createMermaidReactFenceRenderer } from "./mermaidFenceReact.js";
import mermaidPlugin from "./pi-web-plugin.js";
import { asReactNode } from "../../src/client/src/react/plugins/pluginReactNode";

/**
 * The React renderer returns a description of a figure, never a node: the React
 * transcript host draws what a plugin hands it, and an `HTMLElement` handed to
 * React is DOM the reconciler does not own. It must also refuse — throw, not
 * render nothing — for anything that is not a diagram, because the host reads a
 * refusal as "keep the code block".
 */

interface FakeMermaid extends MermaidLike {
  calls: { initialize: { startOnLoad: boolean; securityLevel: string; theme: string }[]; render: string[] };
}

function fakeMermaid(overrides: Partial<MermaidLike> = {}): FakeMermaid {
  const calls: FakeMermaid["calls"] = { initialize: [], render: [] };
  return {
    calls,
    initialize: (config) => { calls.initialize.push(config); },
    parse: () => Promise.resolve(true),
    render: (id) => { calls.render.push(id); return Promise.resolve({ svg: `<svg data-id="${id}"><g></g></svg>` }); },
    ...overrides,
  };
}

function harness(overrides: Partial<MermaidLike> = {}, dark = { value: true }) {
  const mermaid = fakeMermaid(overrides);
  const loadMermaid = vi.fn(() => Promise.resolve(mermaid));
  const renderReact = createMermaidReactFenceRenderer(createMermaidDrawer({ loadMermaid, darkTheme: () => dark.value }));
  return { mermaid, loadMermaid, renderReact };
}

/** Draw a contributed node the way the host does: through the React seam, into a root. */
async function drawNode(node: Awaited<ReturnType<ReturnType<typeof createMermaidReactFenceRenderer>>>) {
  await act(async () => {
    root.render(createElement("div", { className: "rw-markdown-fence" }, asReactNode(node, "mermaid:mermaid")));
    await Promise.resolve();
  });
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
});

describe("the mermaid React fence renderer", () => {
  it("describes a figure React can draw, and hands React the diagram inside it", async () => {
    const { renderReact } = harness();

    const node = await renderReact("graph TD; A-->B");

    expect(node).not.toBeInstanceOf(Node);
    await drawNode(node);

    const figure = container.querySelector("figure.pi-web-mermaid");
    expect(figure).not.toBeNull();
    expect(figure?.querySelector("svg")).not.toBeNull();
    expect(figure?.getAttribute("style")).toContain("overflow-x: auto");
  });

  it("refuses an invalid diagram so the host keeps the plain code block", async () => {
    const { mermaid, renderReact } = harness({ parse: () => Promise.reject(new Error("Parse error on line 1")) });

    await expect(renderReact("not a diagram")).rejects.toThrow("Parse error on line 1");
    expect(mermaid.calls.render).toEqual([]);
  });

  it("refuses an empty fence and a drawing with no svg", async () => {
    const empty = harness();
    await expect(empty.renderReact("   ")).rejects.toThrow("Empty mermaid fence");
    expect(empty.loadMermaid).not.toHaveBeenCalled();

    const noSvg = harness({ render: () => Promise.resolve({ svg: "<p>nope</p>" }) });
    await expect(noSvg.renderReact("graph TD; A")).rejects.toThrow("Mermaid produced no SVG");
  });

  it("draws each fence with its own id, so an update never shows the previous diagram", async () => {
    const { mermaid, renderReact } = harness();

    await drawNode(await renderReact("graph TD; A-->B"));
    await drawNode(await renderReact("graph LR; C-->D"));

    const diagrams = container.querySelectorAll("figure.pi-web-mermaid svg");
    expect(diagrams).toHaveLength(1);
    expect(diagrams[0]?.getAttribute("data-id")).toBe("pi-web-mermaid-2");
    expect(mermaid.calls.render).toEqual(["pi-web-mermaid-1", "pi-web-mermaid-2"]);
  });

  it("keeps the strict security level, and never loads the engine for a fence it refuses", async () => {
    const dark = { value: true };
    const { mermaid, loadMermaid, renderReact } = harness({}, dark);

    await renderReact("graph TD; A-->B");
    dark.value = false;
    await renderReact("graph TD; B-->C");

    expect(mermaid.calls.initialize.map((config) => config.securityLevel)).toEqual(["strict", "strict"]);
    expect(mermaid.calls.initialize.map((config) => config.theme)).toEqual(["dark", "default"]);
    expect(loadMermaid).toHaveBeenCalledTimes(1);
  });

  it("registers its React renderer beside the legacy one, under the same fence language", () => {
    const activation = mermaidPlugin.activate({ apiVersion: 2, pluginId: "mermaid", runtimePluginId: "mermaid", html, svg });
    const fences = activation.contributions.codeFenceRenderers ?? [];

    expect(fences).toHaveLength(1);
    expect(fences[0]?.language).toBe("mermaid");
    expect(fences[0]?.render).toBeTypeOf("function");
    expect(fences[0]?.renderReact).toBeTypeOf("function");
  });
});
