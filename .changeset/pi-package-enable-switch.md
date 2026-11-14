---
"@gang-of-beads/pi-web": patch
---

Add a switch to each package in **Settings → Pi Packages**, so a package can be turned off without uninstalling it. The switch uses Pi's own package filtering: the package stays installed and stays in Pi's settings, and supplies no extension, skill, prompt template, theme, or context file until it is switched back on. A package whose resources are selected individually is shown as filtered, and the panel says which of the two states a package is in; removal is still the control that takes a package out of the machine.
