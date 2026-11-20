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
| Parity ledger status vocabulary | Done | Every ledger row now uses `Not implemented`, `Partially implemented`, `Implemented — needs verification`, `Verified`, or `Intentionally removed` |
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

- 2026-11-20: `pnpm run verify` exit 0 over the MCP and notifications milestone — typecheck, lint, Knip
  and Vitest all clean; 689 test files, 6056 tests passed, 5 skipped. The baseline on the same branch
  before the milestone was 685 files and 5984 tests.
- 2026-11-20: `pnpm run build` exit 0 (a first attempt failed in `pnpm run clean` with `ENOTEMPTY` on
  `dist` because a dev stack was writing into it; the retry was clean).
- 2026-11-20: `npx vitest run` over the MCP and notifications files: 6 files, 121 tests, all passing.
- NOT run: the live browser flows for MCP add/edit and ntfy configuration. To run them:
  `scripts/stack-8505.sh up` (own data dir on port 8505), then drive the React settings dialog at
  1440px and 393x850 and watch the browser console. A check must fail loudly on a missing session
  daemon rather than pass empty.
- The chunk-size warning for the main React chunk (~940 kB) is open work: it must be split, not silenced.

## Exact next action

HEAD is `70cbe110` and the working tree is clean. Measured at this commit: 120 files under
`src/client/src` import `lit`, and there is no `react/PluginSurface.tsx`, no
`react/PiPackagesSettingsPanel.tsx`, and no composer completion work - those were described by an
earlier session's notes, and they are not in this branch. Do not trust a summary over `git log` and
`ls`; re-measure at the start of every session.

The largest unstarted feature is the plugin UI contract, and it blocks the Lit removal. The public
browser API is `src/plugin-api.ts` (1342 lines) and its contributions return Lit `TemplateResult`
values (`content: TemplateResult` at :310, `render(context)` at :355, :473, :515, :707, :735), so React
must render them through `lit/html`'s `render()` into a container it owns. The registry side is already
framework-neutral and ready to be read by React: `PluginRegistry.getSettingsSections(selectedMachineId)`
(`src/client/src/plugins/registry.ts:336`) returns `QualifiedSettingsSectionContribution[]` sorted by
`order` then `title` and filtered by `isContributionActive`, and `applyPluginSettings` (:407),
`pluginSettings` (:447), `findMessageRenderer`, `findToolRenderer` and `pluginName` are the matching
reads. The steps, in order:

1. **Done at `e57fc4c2`+this commit:** `src/client/src/react/PluginSurface.tsx` exists and is tested
   (`PluginSurface.test.ts`, 5 tests): it renders a plugin's `TemplateResult` through lit-html, replaces
   it on change, clears the container on unmount, names a plugin whose template production throws, and
   keeps the surrounding surface when a plugin's own binding throws. The measured behavior that shaped
   it: lit-html swallows an exception raised inside a binding's own function and reports nothing, so the
   isolation that works is the catch around *producing* the template (`pluginSurfaceResult`), and that
   is where a host must catch.
2. **Next:** bootstrap `PluginRegistry` for React. It is constructed only inside the Lit app today,
   at `createPluginRegistry(...)` (`src/client/src/components/PiWebApp.ts:7008`), and its arguments are
   the whole cost of the step: `ui: createPluginHostUi(dialogHost)` (a Lit host that renders a plugin's
   dialogs and pages - React needs its own), `readPiWebStatus(machineId)`, `openPage(pageId)`,
   `fleet: PluginFleetSource`, and `fetchJson(path, init)` built on `request()`. The Lit app also
   registers the built-in plugin itself: `registry.register({ id: "core", plugin: corePlugin })`.
   External plugins arrive through `src/client/src/plugins/external.ts`:
   `loadExternalPlugins` (:47), `resolvePluginModuleUrl` (:94), `readPluginManifest` (:121), and a
   dynamic `import(moduleUrl)` (:108).
   The reads a React host must call, measured on `src/client/src/plugins/registry.ts`:
   `getSettingsSections(selectedMachineId)`, `getWorkspacePanels()`, `getGlobalPanels()`,
   `getActiveGlobalPanels(selectedMachineId)`, `getNavSections(selectedMachineId)`,
   `getListSections/getListLabels/getListActions(list)`, `getComposerContributions(selectedMachineId)`,
   `findMessageRenderer(tag, selectedMachineId)`, `findToolRenderer(toolName, selectedMachineId)`,
   `findCodeFenceRenderer(language, ...)`, `getMessageActions(selectedMachineId)`,
   `getActivityNotes(selectedMachineId)`, `getThemes()`, `getThemePairs()`, `getWorkspaceLabelItems(context)`,
   `getActions(context)`, `getReservedAction(context)`, `applyPluginSettings(runtimePluginId, settings)`
   (:407), `pluginSettings(runtimePluginId)` (:447), `showPage`, `isPageShown`, `open`,
   `emit(event)`, `disposePlugin(runtimePluginId)`, `invalidateWorkspacePanels(context)`,
   `resolveGlobalPanelRouteId` / `resolveWorkspacePanelRouteId`, and `watchReachability(wanted)`.
   Every one of those returns Lit templates for the parts a plugin owns, so each is rendered through
   `PluginSurface`, and each read is filtered by `isContributionActive(pluginId, machineId,
   selectedMachineId, sourcePluginId)` - the machine scope is the registry's, not the panel's.
3. Wire the React settings dialog's Pi Web Plugins page to `getSettingsSections` through
   `PluginSurface`, with `applyPluginSettings`/`pluginSettings` as the settings reads and writes, and a
   plugin's own section isolated from the other plugins' failures.
4. Then the workspace panels, conversation renderers (`findMessageRenderer`/`findToolRenderer`) and
   composer actions, each with a bundled plugin driven for real, desktop and 393x850.
5. Only then start removing Lit (entry `src/client/src/main.ts`, custom elements, decorators,
   templates, Lit-only styles, Lit harness tests once React equivalents exist, the `lit` dependency,
   the lockfile). `lit/html` is expected to remain in `package.json` for the plugin host; the plugin API
   contract itself is Lit-typed, so a documented compatibility adapter is required before the UI
   dependency can be dropped.

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
