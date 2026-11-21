---
"@gang-of-beads/pi-web": patch
---

**MCP Servers stops waiting forever.** The page locks its controls while
one of its changes runs, and a change that reaches outside the machine has
no deadline: testing a connection starts the server's own process and waits
for a handshake, so a server that never answered kept the busy line set and
the whole page's controls disabled, with no stated deadline and no way to
press anything again. The page now waits a named 20 seconds and says what
it knows when that passes: a connection test changed nothing, press it
again; a write may have landed anyway, Reload reads the config files and
the control works now. The controls come back either way.
