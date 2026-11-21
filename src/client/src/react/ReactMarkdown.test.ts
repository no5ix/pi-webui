// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReactMarkdown } from "./ReactMarkdown";
import type { QualifiedCodeFenceRendererContribution } from "../plugins/types";
import type { PluginReactNode } from "../../../plugin-api";

/**
 * The fence host is where a plugin's React contribution reaches the transcript.
 * A claimed fence is drawn by its plugin; an unclaimed fence, a fence still
 * drawing, and a fence whose plugin refused all keep the plain code block, so
 * the reader always sees the text they typed. A plugin that hands back something
 * React cannot draw is named, not silently dropped.
 */

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

function render(node: Parameters<Root["render"]>[0]) {
  return act(async () => {
    root.render(node);
    await Promise.resolve();
  });
}

function fence(renderReact: QualifiedCodeFenceRendererContribution["renderReact"]): QualifiedCodeFenceRendererContribution {
  return {
    id: "mermaid:mermaid",
    pluginId: "mermaid",
    localId: "mermaid",
    language: "mermaid",
    render: () => document.createTextNode("lit"),
    ...(renderReact === undefined ? {} : { renderReact }),
  };
}

function host(text: string, renderer?: QualifiedCodeFenceRendererContribution) {
  const findFenceRenderer = vi.fn(() => renderer);
  return { findFenceRenderer, node: createElement(ReactMarkdown, { text, findFenceRenderer }) };
}

const diagram = '```mermaid\ngraph TD; A-->B\n```';

describe("the React fence host", () => {
  it("draws a claimed fence with its plugin's React element", async () => {
    const renderer = fence(() => createElement("figure", { className: "pi-web-mermaid" }, createElement("svg")));
    const { node } = host(diagram, renderer);

    await render(node);

    expect(container.querySelector("figure.pi-web-mermaid svg")).not.toBeNull();
    expect(container.querySelector("pre.rw-markdown-code")).toBeNull();
  });

  it("keeps the code block standing while an asynchronous diagram draws", async () => {
    let settle: (node: PluginReactNode) => void = () => undefined;
    const renderer = fence(() => new Promise<PluginReactNode>((resolve) => { settle = resolve; }));
    const { node } = host(diagram, renderer);

    await render(node);
    expect(container.querySelector("pre.rw-markdown-code code")?.textContent).toContain("graph TD; A-->B");

    await act(async () => {
      settle(createElement("figure", { className: "pi-web-mermaid" }, createElement("svg")));
      await Promise.resolve();
    });
    expect(container.querySelector("figure.pi-web-mermaid")).not.toBeNull();
    expect(container.querySelector("pre.rw-markdown-code")).toBeNull();
  });

  it("keeps the code block when the plugin refuses, and draws nothing of its own", async () => {
    const renderer = fence(() => Promise.reject(new Error("Parse error on line 1")));
    const { node } = host(diagram, renderer);

    await render(node);

    expect(container.querySelector("figure.pi-web-mermaid")).toBeNull();
    expect(container.querySelector("pre.rw-markdown-code code")?.textContent).toContain("graph TD; A-->B");
  });

  it("names a plugin that hands back something React cannot draw, instead of drawing an empty hole", async () => {
    const renderer = fence(() => ({ type: 7, props: {} }));
    const { node } = host(diagram, renderer);

    await render(node);

    expect(container.textContent).toContain("cannot draw");
    expect(container.querySelector(".plugin-react-failure")).not.toBeNull();
    expect(container.querySelector("pre.rw-markdown-code")).toBeNull();
  });

  it("leaves an unclaimed fence, and an ordinary fence, as the code block the reader typed", async () => {
    const text = "```mermaid\ngraph TD; A-->B\n```\n\n```ts\nconst answer = 42;\n```\n";

    await render(host(text, undefined).node);

    const blocks = container.querySelectorAll("pre.rw-markdown-code");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.textContent).toContain("graph TD; A-->B");
    expect(blocks[1]?.textContent).toContain("const answer = 42;");
  });

  it("draws once for a fence, not once per transcript render, and re-draws when the source changes", async () => {
    const renderReact = vi.fn(() => createElement("figure", { className: "pi-web-mermaid" }, createElement("svg", { "data-n": "1" })));
    const renderer = fence(renderReact);

    await render(host(diagram, renderer).node);
    expect(renderReact).toHaveBeenCalledTimes(1);

    await render(host(diagram, renderer).node);
    expect(renderReact).toHaveBeenCalledTimes(1);

    const changed = "```mermaid\ngraph LR; C-->D\n```";
    await render(host(changed, renderer).node);
    expect(renderReact).toHaveBeenCalledTimes(2);
    expect(renderReact).toHaveBeenLastCalledWith("graph LR; C-->D");
    expect(container.querySelectorAll("figure.pi-web-mermaid")).toHaveLength(1);
  });

  it("re-draws when a new plugin registration claims the fence", async () => {
    const first = vi.fn(() => createElement("figure", { className: "pi-web-mermaid" }, createElement("svg", { "data-n": "1" })));
    const second = vi.fn(() => createElement("figure", { className: "pi-web-mermaid" }, createElement("svg", { "data-n": "2" })));

    await render(host(diagram, fence(first)).node);
    await render(host(diagram, fence(second)).node);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(container.querySelector("figure.pi-web-mermaid svg")?.getAttribute("data-n")).toBe("2");
  });

  it("stops drawing into a fence the transcript removed", async () => {
    let settle: (node: PluginReactNode) => void = () => undefined;
    const renderer = fence(() => new Promise<PluginReactNode>((resolve) => { settle = resolve; }));

    await render(host(diagram, renderer).node);
    await render(host("nothing here", renderer).node);
    await act(async () => {
      settle(createElement("figure", { className: "pi-web-mermaid" }, createElement("svg")));
      await Promise.resolve();
    });

    expect(container.querySelector("figure.pi-web-mermaid")).toBeNull();
    expect(container.textContent).toContain("nothing here");
  });
});
