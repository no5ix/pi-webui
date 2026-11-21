---
"@gang-of-beads/pi-web": patch
---

Ship the React runtime plugins import with its exports.

The page publishes React to plugins at `@gang-of-beads/pi-web/jsx-runtime` and
`…/plugin-react-hooks`, and the client build emitted those three modules as
entries whose exports nobody in the application graph reached — so the bundler
tree-shook them into bare calls. A plugin's `import { jsx }` then failed to
link: the plugin module was fetched and evaluated to nothing, its React
contribution never registered, and the fence stayed a plain code block with no
console error and no failed request to follow. The published modules are now
emitted by their own build step with the plugin build's rule, and the build
refuses a shipped file that does not export every published name. The page also
reads the published modules back after installing React and reports a missing
member on the console. Verified in Chrome against the production build: a plugin
draws a Mermaid diagram in the transcript at 1440x900 and 393x850, from the one
published React.
