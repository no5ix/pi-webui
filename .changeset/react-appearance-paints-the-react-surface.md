---
"@gang-of-beads/pi-web": patch
---

**Appearance changes the app again.** Choosing a theme in the React
**Settings → Appearance** page stored the choice and changed the window's
`color-scheme`, but the React surface kept its own fixed colours: the theme
applier paints the `--pi-*` tokens and the React sheet consulted a separate
`--rw-*` palette that no theme ever wrote. The React palette is now
projected from the theme — each React colour names a theme token the
applier paints, with its previous value as the fallback — so Material
Dark/Light and Darkness/Lightness repaint the workspace, and a theme
plugin's own palette reaches the React UI the same way.
