---
"@gang-of-beads/pi-web": patch
---

Show how long the current task ran in the status bar after it finishes - `took 2m 14s` beside the branch - measured by the page that watched the task from its first working frame to its finish and kept on that device across a reload. A session opened mid-task shows only the part it watched and says so on hover; a task this device never watched from the start shows no number rather than a made-up one.
