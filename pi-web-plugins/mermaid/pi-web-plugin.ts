import type { PiWebPlugin } from "@gang-of-beads/pi-web/plugin-api";
import { createMermaidDomFenceRenderer, createMermaidDrawer, pageIsDark, type MermaidLike } from "./mermaidRenderer.js";
import { createMermaidReactFenceRenderer } from "./mermaidFenceReact.js";

/**
 * The library ships beside this module as a vendored, chunked ESM bundle
 * (see piWeb.vendorBundles in package.json), resolved against this file so
 * the same plugin works under any application prefix. The URL is built at
 * call time, not bundled, so the bundler leaves the graph lazy.
 */
function loadMermaid(): Promise<MermaidLike> {
  const url = new URL("./vendor/mermaid/mermaid.core.js", import.meta.url).href;
  return import(/* @vite-ignore */ url).then((module: { default: MermaidLike }) => module.default);
}

function pageIsDarkNow(): boolean {
  return pageIsDark(getComputedStyle(document.documentElement), matchMedia("(prefers-color-scheme: dark)").matches);
}

/**
 * One drawer, two presenters.
 *
 * The transcript that draws a fence is the Lit one on the pages that still run
 * it and the React one on the React workbench, and both are served from this
 * module, so the engine loads once per page and the two hosts cannot be handed
 * the same mermaid render id.
 */
const draw = createMermaidDrawer({ loadMermaid, darkTheme: pageIsDarkNow });
const render = createMermaidDomFenceRenderer(draw, (tag) => document.createElement(tag));
const renderReact = createMermaidReactFenceRenderer(draw);

const plugin: PiWebPlugin = {
  apiVersion: 2,
  name: "Mermaid Diagrams",
  activate: () => ({
    contributions: {
      codeFenceRenderers: [{ id: "mermaid", language: "mermaid", render, renderReact }],
    },
  }),
};

export default plugin;
