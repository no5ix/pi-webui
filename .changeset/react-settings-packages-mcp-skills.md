---
"@gang-of-beads/pi-web": patch
---

Settings → **Pi Packages**, **MCP Servers** and **Skills** are React screens now, and they are the whole screen: packages list what pi found on the selected machine with its source, scope, install path and status, and install, update, update all, enable, disable and remove all reach pi's own package management. **MCP Servers** and **Skills** show the project's list and the machine's global list as two sections, each naming the file it reads and writes, and the page says which scope a control writes to before it writes. An MCP edit round-trips headers and environment values as `***`, so a saved secret survives an edit and never appears in the browser, a log, or an API response. A project preference stays in the project's file and a global one stays in the machine's, so switching projects loads the right one and editing a project never touches global settings. Every card keeps the warning that packages and MCP servers are code pi runs, and that a running session needs `/reload` before a change reaches it.

The MCP form now carries a **Description** for a server, so a definition written in the browser
keeps the note its file already had, and the Skills and Packages pages say plainly when a list has
not been read yet instead of reporting it as empty. On a phone, the package and server switches are
real 44px switches with a visible focus ring.
