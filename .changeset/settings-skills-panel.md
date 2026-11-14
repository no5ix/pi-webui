---
"@gang-of-beads/pi-web": patch
---

Add **Settings → Skills**, a panel for the skills Pi discovers on the selected machine: the skills in the agent directory, the ones a project ships, and the ones Pi packages supply, each with where it came from and which scope owns it. A switch turns a skill off for the next session without touching its file — the global answer is saved under the `skills` key of PI WEB's config, a project's answer under `skills` in `<project>/.pi-web/config.json`, and a project's entry never rewrites the global one. A preference names a skill, so a project can take a machine-wide skill out for itself. A skill nobody has written anything about keeps Pi's default of available. A running session keeps the skills it loaded, so the panel says to type `/reload` to apply a change.
