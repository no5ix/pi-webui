---
"@gang-of-beads/pi-web": patch
---

**Settings stops waiting forever.** The shell disables a panel's controls
while one of its changes runs, and a change that reaches outside the machine
has no deadline: testing an MCP connection starts the server's own process
and waits for a handshake, a package operation runs pi's installer, so a
request that never answered kept the busy line set and every control on the
page disabled, with no stated deadline and no way to press anything again.
The shell now runs every mutation against a named 20-second bound and says
what it knows when the bound passes: the machine did not answer, the
controls work again, Reload reads the machine's answer because a change
already sent may have landed. The MCP page adds its action's own sentence:
a connection test changes nothing and can be pressed again; a write may
have saved, removed or changed the entry.
