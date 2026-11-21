---
"@gang-of-beads/pi-web": patch
---

Publish the page's React to plugins by import map.

A plugin's JSX and hooks compile against `@gang-of-beads/pi-web/jsx-runtime` and
`…/plugin-react-hooks`, and a plugin module is loaded by URL with no bundler in front of it, so
those specifiers had nothing to resolve against: the React contribution contract could not be
used end to end by an external plugin. The client build now emits the three published modules as
stable, unhashed entries and names them to the browser in an import map, relative to the document
the way every other client asset resolves. The plugin build treats them as external and refuses a
bundle whose own inputs include `react` or `react-dom`, so one React stays on the page.
