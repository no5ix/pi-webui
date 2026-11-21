---
"@gang-of-beads/pi-web": patch
---

**Pi Packages** reports a removal the way the machine answered it.
Removing a package that the named scope's settings do not carry — a path
package recorded in pi's plain string form, for instance — used to answer
"Removed …" while the package stayed in the list and in the settings file.
pi returns the fact (`removed: false`); the page now states it: "Nothing
was removed: … is not configured in Global settings." A machine that
answers without the fact keeps the old sentence.
