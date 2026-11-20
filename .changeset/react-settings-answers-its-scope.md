---
"@gang-of-beads/pi-web": patch
---

The React **Settings** dialog answers again. It used to sit at *Loading settings…* forever: the page
showed *Skills have not been read yet* and *0 skills* under a heading naming a project it had never
read, with no failure to point at. Every page — **General**, **Appearance**, **Notifications**,
**Pi Packages**, **MCP Servers**, **Pi Web Plugins**, **Machines**, **Skills** — now loads its own
list, and a read that fails says what failed on the page that needed it instead of staying silent.

A read belongs to the scope it was made for: **one machine, and for Skills and MCP Servers one project
on that machine**. Choosing a project on the Skills or MCP page reads that project; switching machines
drops a project the new machine does not have, so the page never asks a machine for a directory that
only existed on another one, and an answer that arrives after the scope has left the screen is dropped
rather than drawn under a heading that names somewhere else. Each scope is read once per switch —
opening Settings, switching machine, and switching project each get their own read, and a page that
never opened Settings costs no reads at all.
