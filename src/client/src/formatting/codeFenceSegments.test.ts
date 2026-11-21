// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { splitCodeFences } from "./codeFenceSegments";
import { ReactMarkdown } from "../react/ReactMarkdown";
import type { QualifiedCodeFenceRendererContribution } from "../plugins/types";
import type { PluginReactNode } from "../plugins/types";

describe("splitting a message at its fences", () => {
  it("keeps prose and fences in order", () => {
    expect(splitCodeFences("before\n```js\nconst a = 1;\n```\nafter")).toEqual([
      { kind: "markdown", text: "before" },
      { kind: "code", text: "const a = 1;", language: "js", marker: "```" },
      { kind: "markdown", text: "after" },
    ]);
  });

  it("names the info string's first word, lowercased", () => {
    const segments = splitCodeFences("```Mermaid title\ngraph TD;\n```");
    expect(segments[0]).toMatchObject({ kind: "code", language: "mermaid" });
  });

  it("leaves a fence with no language unnamed", () => {
    expect(splitCodeFences("```\nplain\n```")[0]).toMatchObject({ kind: "code", language: undefined });
  });

  it("runs an unterminated fence to the end, as a streaming message is half a message", () => {
    expect(splitCodeFences("intro\n```mermaid\ngraph TD;\n")).toEqual([
      { kind: "markdown", text: "intro" },
      { kind: "code", text: "graph TD;\n", language: "mermaid", marker: "```" },
    ]);
  });

  it("keeps a fence inside a longer fence out of the split", () => {
    const segments = splitCodeFences("````markdown\n```js\ncode\n```\n````");
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ kind: "code", language: "markdown" });
  });

  it("matches a tilde fence", () => {
    expect(splitCodeFences("~~~mermaid\ngraph TD;\n~~~")[0]).toMatchObject({ kind: "code", language: "mermaid" });
  });
});

function fenceRenderer(draw: (source: string) => PluginReactNode | Promise<PluginReactNode>): QualifiedCodeFenceRendererContribution {
  return {
    id: "probe:fence",
    pluginId: "probe",
    localId: "fence",
    language: "mermaid",
    render: () => document.createTextNode("lit"),
    renderReact: draw,
  };
}

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
}

function renderMarkdown(text: string, renderer: QualifiedCodeFenceRendererContribution | undefined): HTMLElement {
  const container = document.createElement("div");
  const root = createRoot(container);
  const props = renderer === undefined
    ? { text }
    : { text, findFenceRenderer: (language: string) => (language === renderer.language ? renderer : undefined) };
  act(() => {
    root.render(createElement(ReactMarkdown, props));
  });
  const html = container.innerHTML;
  act(() => {
    root.unmount();
  });
  return Object.assign(document.createElement("div"), { innerHTML: html });
}

describe("the React transcript's fence host", () => {
  it("draws an unclaimed fence as the code the reader typed", () => {
    const drawn = renderMarkdown("```mermaid\ngraph TD;\n```", undefined);
    expect(drawn.querySelector("pre code.language-mermaid")?.textContent).toBe("graph TD;");
  });

  it("keeps the code block standing while the plugin draws", () => {
    const drawn = renderMarkdown("```mermaid\ngraph TD;\n```", fenceRenderer(() => new Promise(() => undefined)));
    expect(drawn.querySelector("pre code.language-mermaid")?.textContent).toBe("graph TD;");
  });

  it("draws the plugin's node once it settles", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const renderer = fenceRenderer(() => Promise.resolve(createElement("svg", { "data-testid": "diagram" })));
    act(() => {
      root.render(createElement(ReactMarkdown, { text: "```mermaid\ngraph TD;\n```", findFenceRenderer: (language) => (language === "mermaid" ? renderer : undefined) }));
    });
    await act(settle);
    expect(container.querySelector("[data-testid=diagram]")).not.toBeNull();
    expect(container.querySelector("pre code.language-mermaid")).toBeNull();
    act(() => {
      root.unmount();
    });
  });

  it("keeps the plain code block when the plugin refuses", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const renderer = fenceRenderer(() => Promise.reject(new Error("No diagram in this fence")));
    act(() => {
      root.render(createElement(ReactMarkdown, { text: "```mermaid\ngraph TD;\n```", findFenceRenderer: (language) => (language === "mermaid" ? renderer : undefined) }));
    });
    await act(settle);
    expect(container.querySelector("pre code.language-mermaid")?.textContent).toBe("graph TD;");
    act(() => {
      root.unmount();
    });
  });

  it("renders prose through the sanitizer, fences aside", () => {
    const drawn = renderMarkdown("**bold** and <script>document.cookie</script>", undefined);
    expect(drawn.querySelector("strong")?.textContent).toBe("bold");
    expect(drawn.querySelector("script")).toBeNull();
  });
});
