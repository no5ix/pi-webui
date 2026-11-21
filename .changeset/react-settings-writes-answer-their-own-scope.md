---
"@gang-of-beads/pi-web": patch
---

**Settings** keeps the list you are looking at. On the **Skills** and
**MCP Servers** pages, a change to a machine-wide entry used to replace the
page's list with the machine's own list, which has no project rows in it:
toggle a global skill while a project is selected and that project's skills
vanished from a page whose heading named the project, leaving nothing to
toggle next. The same happened after adding, editing, enabling or removing a
global MCP server. The page now answers a write with a fresh read of the
scope it is showing, and the write's own sentence stays as the notice.
