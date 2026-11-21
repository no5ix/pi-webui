# Plugin registry bootstrap for the React entry

Status: specification only, measured from source at `bed5f2f3`. No code here is written yet.
This is the dependency of Lit removal: plugin-contributed UI is the only product surface the
React app cannot host, and `lit` cannot leave `package.json` while that is true.

## What exists today (measured)

- The plugin contract is Lit-typed. `src/plugin-api.ts` (1342 lines) types contribution render
  functions as returning `TemplateResult` (13 occurrences), plus a `HtmlTemplateTag` type (:123).
  `packages/pi-web-plugin-api/` ships only LICENSE, NOTICE, README, package.json: the declarations
  are generated from `src/plugin-api.ts`, so the published plugin API is Lit-typed too.
- `PluginRegistry` (`src/client/src/plugins/registry.ts`) owns loading, enable/disable, settings
  and the per-contribution reads. Its constructor is called in exactly one place:
  `createPluginRegistry(dialogHost, readPiWebStatus, openPage, fleet)` at
  `src/client/src/components/PiWebApp.ts:7008`, which passes
  `ui: createPluginHostUi(dialogHost)`, `readPiWebStatus`, `openPage`, `fleet`,
  `fetchJson: (path, init) => request<unknown>(path, (value) => value, {...})`, then
  `registry.register({ id: "core", plugin: corePlugin })`.
- External plugin loading: `src/client/src/plugins/external.ts` - `loadExternalPlugins` (:47),
  `resolvePluginModuleUrl` (:94), `readPluginManifest` (:121), dynamic `import(moduleUrl)` (:108).
- Reads a React surface must call (registry method list, measured):
  `getSettingsSections(selectedMachineId)`, `getWorkspacePanels()`, `getGlobalPanels()`,
  `getActiveGlobalPanels(selectedMachineId)`, `getNavSections(selectedMachineId)`,
  `getListSections/getListLabels/getListActions(list)`, `getComposerContributions(selectedMachineId)`,
  `findMessageRenderer(tag, selectedMachineId)`, `findToolRenderer(toolName, selectedMachineId)`,
  `findCodeFenceRenderer(language, ...)`, `getMessageActions(selectedMachineId)`,
  `getActivityNotes(selectedMachineId)`, `getThemes()`, `getThemePairs()`,
  `getWorkspaceLabelItems(context)`, `getActions(context)`, `getReservedAction(context)`,
  `applyPluginSettings(runtimePluginId, settings)` (:407), `pluginSettings(runtimePluginId)` (:447),
  `showPage`, `isPageShown`, `open`, `emit(event)`, `disposePlugin(runtimePluginId)`,
  `invalidateWorkspacePanels(context)`, `resolveGlobalPanelRouteId`, `resolveWorkspacePanelRouteId`,
  `watchReachability(wanted)`. Each read is already machine-scoped by
  `isContributionActive(pluginId, machineId, selectedMachineId, sourcePluginId)`.
- The host side is built: `src/client/src/react/PluginSurface.tsx` (commit `fc97e7a5`) renders a
  `TemplateResult` through lit-html, replaces it on change, renders `nothing` on unmount, and names a
  plugin whose template production throws (`pluginSurfaceResult`). Measured reason for that shape:
  lit-html swallows an exception raised inside a binding's own function and reports nothing, so a
  host cannot catch it around `render`.

## The bootstrap to write

One module, `src/client/src/react/usePluginRegistry.ts`, that:

1. Constructs the registry with React-side seams, not Lit ones. A React `PluginDialogHost` is
   needed for `createPluginHostUi`; it must render plugin dialogs through `PluginSurface` and reuse
   the existing React dialog CSS classes, not open a `<dialog>` element.
2. Registers `core` (`registry.register({ id: "core", plugin: corePlugin })`) so built-in
   contributions are present, and loads externals through `loadExternalPlugins`.
3. Keeps one registry per React root, rebuilt only when the machine scope changes, and calls
   `disposePlugin` on the way out.
4. Exposes typed reads to React components; each returns contributions, and each contribution's
   `render` output goes through `PluginSurface`.
5. Keeps `applyPluginSettings`/`pluginSettings` in the registry: plugin settings are the registry's
   state, and the React settings panel renders the section plus a settings surface.

## Verification that closes the row

- Unit: registry construction seams, machine-scope rebuild, dispose, a disabled plugin contributes
  nothing, a throwing plugin is named and isolated.
- Live (this is the part that makes the row `Verified`): run the app, enable
  `pi-web-plugins/github-insights`, `session-graph`, `pi-web-todo`, `pi-web-voice`, `terminal`
  from the React Plugins settings page, and confirm on desktop 1440px and mobile 393x850 that its
  settings section, workspace panel and composer contribution appear and act, that the browser
  console stays clean, and that disabling removes it.

## The contract that replaces this shape

The React contribution vocabulary (one render field per family, with the registry read each answers
through), the host rules — one registry per machine, registration replaces, a slot renders once,
disposal is total, failure is visible — the React `ui.render*` helpers, and the order the Lit path is
removed in, are specified in [plugin-api-react.md](plugin-api-react.md).
