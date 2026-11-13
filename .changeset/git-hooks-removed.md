---
"@gang-of-beads/pi-web": patch
---

The repository no longer installs git hooks. `pnpm install` leaves your git
configuration alone, commits and pushes run only the hooks your own machine has,
and `pnpm run verify` is the contributor's own step before a change reaches
`main`, as CI already runs it on every pull request.
