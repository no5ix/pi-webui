---
"@gang-of-beads/pi-web": patch
---

Lint the React workbench.

ESLint walked `.ts` and `.jsx` only, so the whole React UI — every `.tsx` under
`src/client/src/react` and the plugin's React fence — was outside every
type-aware rule the repository enforces: unawaited promises, unsafe assertions,
truthiness on a nullable, dependency arrays. The config now covers `.tsx` in
both trees with the same type-aware rules, plus `eslint-plugin-react-hooks` at
`error` for rules-of-hooks and exhaustive-deps, and the lint script names
`.tsx`. The findings that surfaced are fixed at the source, not by relaxing a
rule: an effect that read a project's git state field by field now reads one
scoped object, the CodeMirror editor tears down on the effect's own scope
capture, and style objects that set CSS custom properties use a `cssVariables`
helper whose React type augmentation replaces per-callsite assertions.
