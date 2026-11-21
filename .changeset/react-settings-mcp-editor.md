---
"@gang-of-beads/pi-web": patch
---

**Settings → MCP Servers** now adds and edits servers, not just lists them. The React panel
carries pi's own form: a name, the transport (stdio command with arguments and working
directory, or a streamable HTTP URL with headers), the exposure, an enabled switch, and a
timeout. A saved server can be opened again from its row, and the editor writes to a scope the
press can see: the definition file, or this project's override of a global server - and an
override only carries the keys pi lets a project override, so a project's edit can never rewrite
the definition. Environment variables and headers are shown by name and never sent to the
browser: an edit that leaves them alone keeps the values the file already had, so a header's
secret survives an edit of the URL. An invalid name or a config pi would refuse is answered with
pi's own reason instead of being written.
