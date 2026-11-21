---
"@gang-of-beads/pi-web": patch
---

Render a plugin's code fence through the React workbench.

The Mermaid plugin draws a fenced block, and the React workbench is the surface a
reader uses. A React host can now claim a fence: the fence splits at the registry
boundary, the plugin draws it, and the host keeps the plain code block while the
draw is in flight and when the draw is refused. Mermaid splits into one drawing
core that returns SVG text and two presenters, so the Lit and React hosts share
the parse, the theme, the sanitising and the strict security level; the React
presenter returns a React element, and Mermaid stays lazy — nothing is fetched
for a chat with no diagram. A plugin contributes `renderReact` for a React host
and `render` for a Lit host, and the React build emits `react/jsx-runtime` as
`@gang-of-beads/pi-web/jsx-runtime` so a plugin's JSX resolves against the
published React and one React stays on the page.
