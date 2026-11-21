---
"@gang-of-beads/pi-web": patch
---

**Settings stops loading after a change.** Enabling or disabling a skill,
or adding, editing, enabling, removing or testing an MCP server, left the
page at "Loading settings…" indefinitely: the write's refresh re-reads the
one list the page shows, and the read was counted against the five
resources a whole-scope read expects. One of five answered, four were
dropped with the read they belonged to, and the page stayed loading with
its rows on screen. The refresh now names the list it asks for, so it
drains on its own answer.
