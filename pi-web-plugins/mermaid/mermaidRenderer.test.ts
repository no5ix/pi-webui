// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import {
  createMermaidDomFenceRenderer,
  createMermaidDrawer,
  createMermaidFenceRenderer,
  pageIsDark,
  type MermaidLike,
} from "./mermaidRenderer.js";

/**
 * The drawing core must load the engine once and lazily, parse before it draws,
 * refuse (throw) on anything that is not a diagram so the host keeps the plain
 * code block, keep the strict security level on every configuration, and
 * re-theme when the page changes. The presenters must add nothing to that: the
 * DOM one appends the SVG it was given, the React one describes it.
 */

interface FakeMermaid extends MermaidLike {
  calls: { initialize: { startOnLoad: boolean; securityLevel: string; theme: string }[]; render: string[]; parse: string[] };
}

function fakeMermaid(overrides: Partial<MermaidLike> = {}): FakeMermaid {
  const calls: FakeMermaid["calls"] = { initialize: [], render: [], parse: [] };
  return {
    calls,
    initialize: (config) => { calls.initialize.push(config); },
    parse: (source) => { calls.parse.push(source); return Promise.resolve(true); },
    render: (id) => { calls.render.push(id); return Promise.resolve({ svg: `<svg data-id="${id}"><g></g></svg>` }); },
    ...overrides,
  };
}

function harness(mermaid: MermaidLike, dark = { value: true }) {
  const loadMermaid = vi.fn(() => Promise.resolve(mermaid));
  const draw = createMermaidDrawer({ loadMermaid, darkTheme: () => dark.value });
  return { draw, loadMermaid };
}

describe("the mermaid drawing core", () => {
  it("loads the engine once, parses first, and reports the svg string", async () => {
    const mermaid = fakeMermaid();
    const { draw, loadMermaid } = harness(mermaid);

    const first = await draw("graph TD; A-->B");
    const second = await draw("graph TD; B-->C");

    expect(loadMermaid).toHaveBeenCalledTimes(1);
    expect(mermaid.calls.initialize).toEqual([{ startOnLoad: false, securityLevel: "strict", theme: "dark" }]);
    expect(mermaid.calls.parse).toEqual(["graph TD; A-->B", "graph TD; B-->C"]);
    expect(first).toContain("<svg");
    expect(second).toContain("<svg");
    expect(first).not.toBe(second);
  });

  it("names every draw with its own id, so a repeat never draws over the previous diagram", async () => {
    const mermaid = fakeMermaid();
    const { draw } = harness(mermaid);

    await draw("graph TD; A-->B");
    await draw("graph TD; A-->B");

    expect(mermaid.calls.render).toEqual(["pi-web-mermaid-1", "pi-web-mermaid-2"]);
  });

  it("throws on a parse error so the host keeps the code block", async () => {
    const mermaid = fakeMermaid({ parse: () => Promise.reject(new Error("Parse error on line 1")) });
    const { draw } = harness(mermaid);

    await expect(draw("not a diagram")).rejects.toThrow("Parse error on line 1");
    expect(mermaid.calls.render).toEqual([]);
  });

  it("throws on an empty fence and on an engine that produced no svg", async () => {
    const { draw } = harness(fakeMermaid({ render: () => Promise.resolve({ svg: "<p>nope</p>" }) }));

    await expect(draw("   ")).rejects.toThrow("Empty mermaid fence");
    await expect(draw("graph TD; A")).rejects.toThrow("Mermaid produced no SVG");
  });

  it("re-initializes when the page theme flips, and retries a failed load", async () => {
    const mermaid = fakeMermaid();
    const dark = { value: false };
    let attempts = 0;
    const loadMermaid = vi.fn(() => { attempts += 1; return attempts === 1 ? Promise.reject(new Error("offline")) : Promise.resolve(mermaid); });
    const draw = createMermaidDrawer({ loadMermaid, darkTheme: () => dark.value });

    await expect(draw("graph TD; A-->B")).rejects.toThrow("offline");
    await draw("graph TD; A-->B");
    dark.value = true;
    await draw("graph TD; A-->B");

    expect(loadMermaid).toHaveBeenCalledTimes(2);
    expect(mermaid.calls.initialize.map((config) => config.theme)).toEqual(["default", "dark"]);
  });

  it("keeps the strict security level on every re-configuration", async () => {
    const mermaid = fakeMermaid();
    const dark = { value: false };
    const { draw } = harness(mermaid, dark);

    await draw("graph TD; A-->B");
    dark.value = true;
    await draw("graph TD; B-->C");

    expect(mermaid.calls.initialize).toHaveLength(2);
    expect(mermaid.calls.initialize.every((config) => config.securityLevel === "strict" && !config.startOnLoad)).toBe(true);
  });
});

describe("the mermaid presenters", () => {
  it("the DOM presenter appends the svg the drawer reported", async () => {
    const draw = vi.fn(() => Promise.resolve('<svg data-id="one"><g></g></svg>'));
    const render = createMermaidDomFenceRenderer(draw, (tag) => document.createElement(tag));

    const figure = await render("graph TD; A-->B");

    expect(draw).toHaveBeenCalledWith("graph TD; A-->B");
    if (!(figure instanceof HTMLElement)) throw new Error("expected an element");
    expect(figure.tagName).toBe("FIGURE");
    expect(figure.className).toBe("pi-web-mermaid");
    expect(figure.querySelector("svg")?.getAttribute("data-id")).toBe("one");
  });

  it("the DOM presenter refuses a drawing with no svg element", async () => {
    const render = createMermaidDomFenceRenderer(() => Promise.resolve("<p>nope</p>"), (tag) => document.createElement(tag));

    await expect(render("graph TD; A")).rejects.toThrow("Mermaid produced no SVG");
  });

  it("the DOM presenter built from dependencies draws each fence in its own figure", async () => {
    const render = createMermaidFenceRenderer({
      loadMermaid: () => Promise.resolve(fakeMermaid()),
      darkTheme: () => true,
      createElement: (tag) => document.createElement(tag),
    });

    const first = await render("graph TD; A-->B");
    const second = await render("graph TD; B-->C");

    expect(first).not.toBe(second);
    if (!(first instanceof HTMLElement) || !(second instanceof HTMLElement)) throw new Error("expected elements");
    expect(first.querySelector("svg")?.getAttribute("data-id")).toBe("pi-web-mermaid-1");
    expect(second.querySelector("svg")?.getAttribute("data-id")).toBe("pi-web-mermaid-2");
  });
});

describe("pageIsDark", () => {
  it("judges by the page background and falls back when it is not a hex colour", () => {
    expect(pageIsDark({ getPropertyValue: () => "#0b0d10" }, false)).toBe(true);
    expect(pageIsDark({ getPropertyValue: () => "#fff9ee" }, true)).toBe(false);
    expect(pageIsDark({ getPropertyValue: () => "" }, true)).toBe(true);
    expect(pageIsDark(undefined, false)).toBe(false);
  });
});
