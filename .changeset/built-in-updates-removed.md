---
"@gang-of-beads/pi-web": patch
---

PI WEB no longer updates itself. The built-in Updates page is gone, along with the
release check that ran in the background, the version strip that announced a newer
PI WEB, the update dialog that opened on its own when a page was opened, and the
**Update** and **Update every machine** controls in **Settings → Machines**. Nothing
in the application starts a package install any more, so an update can no longer
interrupt the work in front of you, and no page asks for an update command.

Updating PI WEB is now a step you take yourself: `npm install -g
@gang-of-beads/pi-web --allow-scripts=node-pty` (or your own package manager) followed
by `pi-web restart`. **Settings → Machines** keeps its **Restart** and **Restart every
machine** controls, which run the installed service's restart and never touch the
installed package. The `updateCommand` config key and `PI_WEB_UPDATE_COMMAND` are gone;
a config file that still carries them ignores them. Git, package management for pi
resources, and every other server capability are unchanged.
