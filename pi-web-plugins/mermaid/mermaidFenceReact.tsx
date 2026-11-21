import type { PluginReactNode } from "@gang-of-beads/pi-web/plugin-api";
import type { MermaidDrawer } from "./mermaidRenderer.js";

/**
 * Draws one mermaid fence as a React element.
 *
 * The React transcript host cannot append a node: a plugin that hands back an
 * `HTMLElement` reaches past React and paints over DOM the reconciler owns, and
 * the next update that touches the message erases it in a way no reader can tie
 * to the plugin. So the React renderer describes a figure and lets the host's
 * React make it real, through the one runtime the page published.
 *
 * The SVG arrives as mermaid's own string, sanitized by the strict security
 * level the drawer configures, and is placed with React's explicit raw-HTML
 * escape on the element React gives it. That is the same boundary the Lit host
 * always had — `figure.innerHTML = svg` over the identical string — and not a
 * general HTML path: nothing the reader typed reaches it, and a fence whose
 * diagram fails never gets here at all, because a throw from the drawer leaves
 * the plain code block standing.
 */
export function createMermaidReactFenceRenderer(draw: MermaidDrawer): (source: string) => Promise<PluginReactNode> {
  return async (source: string): Promise<PluginReactNode> => {
    const svg = await draw(source);
    return <figure className="pi-web-mermaid" style={{ margin: "0", overflowX: "auto" }} dangerouslySetInnerHTML={{ __html: svg }} />;
  };
}
