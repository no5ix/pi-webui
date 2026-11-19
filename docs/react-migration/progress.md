# React migration progress and continuation checkpoint

Working notes for the migration described in [feature-parity.md](feature-parity.md). This file records
what has landed, what is verified, what is only implemented, and the exact next action. It is a
continuation point, not a product page: it is written so that a reader with no memory of the previous
session can pick the work up without re-discovering the facts below.

Branch: `feat/react-workspace-ui-from-main`. The React app is the entry point:
`src/client/index.html:397` loads `/src/react-main.tsx`, which renders `ReactWorkspaceApp`.
The Lit application (`src/client/src/main.ts`) is no longer an entry point, and 121 files under
`src/client/src` still import `lit`.

## Status of each milestone

| Milestone | State | Evidence |
| --- | --- | --- |
| React workspace shell, navigation, project/session tree | Implemented — needs browser verification | `ProjectTree.tsx`, `ReactWorkspaceApp.tsx`, parity ledger rows for navigation |
| Project create / close / undo, session lifecycle | Implemented — needs browser verification | commits `5e38a6ef`, `59a606b6`, `da53f231` |
| Settings dialog (floating, gear button) with eight pages | Implemented — needs verification | `ReactSettingsDialog.tsx` |
| Settings → MCP Servers: add and edit | Implemented — needs verification | `react/McpSettingsPanel.tsx`, `react/mcpForm.ts`, `piMcpService.save`; 121 tests across six files green on 2026-11-20 |
| Settings → Notifications: ntfy form and test delivery | Implemented — needs verification | `react/NotificationsSettingsPanel.tsx`, `notifications/ntfyForm.ts` (shared with the Lit page); panel tests green |
| Conversation rendering, streaming, composer | Partially implemented | parity ledger rows; `ConversationMessage.tsx` exists, composer/attachment/pagination work not finished |
| Plugin UI in React | Not implemented | no `plugins/registry` import anywhere under `src/client/src/react/` |
| Lit removal | Blocked by plugin UI and the composer | see the plan below |

## The plugin UI problem, in the terms that decide it

The plugin contract is Lit-shaped. `SettingsSectionContribution.render` returns a Lit `TemplateResult`
(`src/client/src/plugins/types.ts:166-171`), and the plugin runtime is Lit:
`src/client/src/plugins/registry.ts:1` imports `html, svg`, `types.ts:1` imports
`CSSResultGroup, TemplateResult`, `pluginContainment.ts:1` and `pluginHostUi.ts:3` import `lit`.

What the bundled plugins actually contribute (counted over `pi-web-plugins/`):

- `workspacePanels` × 5 (files, git, terminal, …), `globalPanels` × 3, `workspaceLabels`,
  `toolRenderers`, `navSections`, `listLabels`, `codeFenceRenderers` (mermaid).
- 38 files under `pi-web-plugins/` import `lit` — the browser modules of `terminal`, `updates`,
  `workspaces`, `files`, `git`, `goal`, `info`, `machines`, `mermaid`.
- No bundled plugin contributes `settingsSections`; that contribution is served by the API only.

Consequences, in the order they must be handled:

1. The React app renders no plugin UI at all today: no workspace panels, no nav sections, no
   code-fence or tool renderers, no workspace labels, no themes from plugins, no plugin settings
   sections, no composer contributions.
2. React cannot render a `TemplateResult` directly. Removing `lit` therefore requires either
   migrating every contribution to a React-shaped contract, or a compatibility adapter that mounts a
   Lit template inside a React tree.
3. The adapter keeps `lit-html` as a runtime dependency of the plugin runtime. The honest reading of
   the mission's "no Lit at runtime" is: the application's own UI is React-only (its components,
   dialogs, settings, conversation, workspace, styles), the plugin runtime keeps Lit rendering for
   third-party contributions, and bundled plugins are migrated to a React contribution shape so the
   repo's own code no longer depends on Lit. `docs/plugins.md` must state the migration strategy for
   external plugins; the adapter must isolate a plugin's errors and clean up on unmount.

## Milestone plan, with the next action

1. **Plugin host in React** (highest priority, unblocks Lit removal).
   - Boot the plugin runtime in the React app: load the registry, machine-scoped plugins, and the
     lifecycle (`src/client/src/plugins/registry.ts`, `pluginContainment.ts`, `pluginHostUi.ts`).
   - `PluginSurface` adapter: a React component that owns a container element, renders a
     `TemplateResult` into it through `lit-html`'s `render`, re-renders when the host context changes,
     renders `nothing` on unmount, and reports a thrown renderer as an isolated failure with the
     plugin's name.
   - Wire the contribution kinds in this order, each with tests against a real registry and a real
     bundled plugin: workspace panels → global panels → workspace labels → nav sections → code fence
     and tool renderers → list labels → settings sections → composer contributions.
   - Then migrate bundled plugins to a React contribution shape (38 files), one plugin per commit,
     starting with `mermaid` (one code fence renderer) and ending with `terminal`.
2. **Composer parity** (drafts, prompt history, attachments, completions, slash commands, model and
   provider controls, outbox).
3. **Conversation parity** (message types, streaming, pagination, scroll anchoring, tool states,
   extension renderers).
4. **Settings pages**: Machines (health, access approval, reconnect), Pi Packages (filters, per-package
   errors), Skills (validation errors), Plugins (status truthfulness, contributed settings), Appearance
   (contributed themes, reload behavior), General (save validation and failure reporting).
5. **Lit removal**: `src/client/src/main.ts`, `src/client/src/components/**`, `src/client/src/settings/**`,
   the Lit plugin runtime (`registry.ts`, `pluginContainment.ts`, `pluginHostUi.ts`, `types.ts`), the
   obsolete styles and tests, `lit` from `package.json` (keeping `lit-html` only if the adapter ships),
   the Vite entries, and the startup scripts.

**Exact next action**: add the plugin runtime boot to `ReactWorkspaceApp` and the `PluginSurface`
adapter, then render the workspace panels of the `files` plugin through it, with
`src/client/src/react/PluginSurface.test.ts` (happy-dom, `createElement` style — Vitest collects
`src/**/*.test.ts` only, so React DOM tests must be `.test.ts` files, not `.tsx`).

## Verification record

- 2026-11-20: `npx vitest run` over the MCP and notifications files: 6 files, 121 tests, all passing.
- 2026-11-20: `pnpm run build` exit 0. The chunk-size warning for the main React chunk (~940 kB) is
  open work: it must be split, not silenced.
- `pnpm run verify` (typecheck, lint, Knip, Vitest) is run per milestone; record the exit code and the
  test count here as each milestone lands.

## Test conventions this project uses

- Vitest collects `src/**/*.test.ts`; a React DOM test is a `.test.ts` file that uses `createElement`,
  `createRoot` and `act`, with `// @vitest-environment happy-dom` and
  `IS_REACT_ACT_ENVIRONMENT = true`.
- Typing a React-controlled input in a test must use the prototype setter
  (`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value)`)
  and then dispatch `new Event("input", { bubbles: true })`; assigning `input.value` directly leaves
  React's value tracker behind and the change is dropped.
- Server tests use the real file ports over a temp directory (`src/server/web/piMcpService.test.ts` is
  the model), never a mocked config file.
