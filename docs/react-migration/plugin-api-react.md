# The React plugin contract

Owner decision (2026-08-22): the application has one UI framework — React. Plugin UI is React. The Lit
render path, the Lit contribution vocabulary, and the React shell that hosts Lit content are removal
targets, not the destination.

This page is the design those changes are written against. It names the plugin-facing contract, the
rules the host enforces, and the order the removal happens in. It does not describe what is already
true: `progress.md` and `feature-parity.md` record that.

## Why the contract is being replaced rather than bridged

The plugin API is 0.x: the repository's default branch is the distribution, bundled plugins are loaded
from source, and no third-party plugin is known to be published. `plugin-bootstrap-spec.md` §7 states
the rule: no public API compatibility promises; a breaking change ships with a migration note.

A bridge that renders Lit inside React keeps two rendering systems in the application and in every
bundled plugin, and `plugin-bootstrap-spec.md` §11 already says of the current shape that it "keeps two
rendering systems in the plugin system at once". Building the React vocabulary on top of that shape,
then deleting the Lit half, is the shortest path to one framework. The bundled plugins are the only
known consumers, and all eight move in the same change series.

## What a plugin contributes, in React

Every family below is one the current registry already stores
(`src/client/src/plugins/registry.ts`), with the host read it answers to:

| Family | Host read (registry.ts) | React contribution |
| --- | --- | --- |
| Actions | `getActions(context)` :210, `getReservedAction` :235 | `renderAction(context): ReactNode` next to the existing `onAction` |
| Composer | `getComposerContributions(machineId)` :239 | `renderComposerItem(context, slot): ReactNode` |
| Activity notes | `getActivityNotes(machineId)` :245 | `renderActivityNote(context): ReactNode` |
| List labels / actions / sections | `getListLabels` :252, `getListActions` :259, `getListSections` :266 | `renderLabel`, `renderActionItem`, `renderSection` |
| Navigation sections | `getNavSections(machineId)` :313 | `renderNavSection(context): ReactNode` |
| Settings sections | `getSettingsSections(machineId)` :336 | `renderSection(context): ReactNode` |
| Message renderers | `findMessageRenderer(tag, machineId)` :346 | `renderMessage(view): ReactNode` |
| Tool renderers | `findToolRenderer(name, machineId)` :353 | `renderTool(view): ReactNode` |
| Message actions | `getMessageActions(machineId)` :369 | `renderMessageAction(row): ReactNode` |
| Code fence renderers | `findCodeFenceRenderer(language, machineId)` :376 | `renderCodeFence(code, language): ReactNode` |
| Pages | `showPage` :420, `isPageShown` :430 | `renderPage(context): ReactNode` |
| Workspace panels | `getWorkspacePanels()` :671 | `renderPanel(context): ReactNode` |
| Global panels | `getGlobalPanels()` :676, `getActiveGlobalPanels` :681 | `renderPanel(context): ReactNode` |
| Themes | `getThemes()` :716, `getThemePairs()` :720 | data only, no render |
| Workspace labels | `getWorkspaceLabelItems(context)` :724 | `renderLabel(context): ReactNode` |
| Dialogs | `ui.showDialog(dialog)` | `content: ReactNode`, presented by the React modal layer |

A render field is a function of a plain, serialisable payload, so a plugin may write it as a JSX
component. `ReactNode` in the public declarations (`src/plugin-api.ts`,
`packages/pi-web-plugin-api/src/plugin-api.ts`) is the structural shape `{ type, props }` plus text and
arrays, not an import of React: the plugin API package stays free of a React runtime dependency, and
`typecheck:plugin-api` stays honest.

The render context is one object, built by the host, and carries the scope it belongs to:

```ts
interface PluginRenderContext {
  readonly machineId: string;
  readonly projectId?: string;
  readonly sessionId?: string;
  readonly appearance: { readonly theme: string; readonly dark: boolean };
  readonly t: (key: string, params?: Record<string, string>) => string;
}
```

## Rules the host enforces

- **One registry per machine.** `usePluginRegistry(machineId)` builds a `PluginRegistry`, registers the
  core plugin, loads the external manifest for that machine, and on unmount closes every plugin dialog
  and disposes every registered plugin. A registry is never shared across machines, and a contribution
  read always names the machine it was asked for.
- **Registration replaces.** Registering an id that exists disposes that plugin's contributions first,
  so a reload cannot double-register. `revision` increments when contributions change; every React host
  reads it, so a plugin that registers, unregisters, or reloads redraws the surface it changed.
- **A slot renders once.** Where a contribution carries both a Lit and a React renderer, the React one
  wins and the Lit one is ignored. No surface ever renders the same contribution twice.
- **Failure is visible.** A plugin that fails to load is reported in **Settings → Pi Web Plugins** with
  its id and message, and the plugin's own surface shows the failure. An empty plugin list means
  unloaded, not empty.
- **Disposal is total.** A contribution's `dispose` runs on plugin disposal, machine switch, and app
  unmount; a contribution left behind after its machine is gone is a defect.

## Host-owned UI, in React

`ui.renderButton`, `ui.renderToggle`, `ui.renderList`, `ui.renderOutput`, `ui.renderExpandableRow`,
`ui.renderMessageField` (declared at `src/plugin-api.ts:221` `PluginHostUi`, implemented in
`src/client/src/plugins/pluginHostUi.ts`) return React nodes. They exist because each one is a decision
this project already paid for — focus, labels, press feedback, the styles that keep a tapped surface
from flashing, the phone sizes — and a plugin that redraws them drifts from the built-in surfaces. The
React implementations use plain element descriptors and the CSS classes the current templates use, so
the look is preserved.

## Removal order

1. React contribution fields, React `ui.render*`, and React hosts for dialogs, settings sections,
   panels, pages, actions, status chrome (the Lit chrome in `src/client/src/plugins/hostChrome.ts` is
   5,476 lines; it is replaced family by family, not in one edit).
2. The bundled plugins move to React, one plugin per change: `files`, `git`, `goal`, `info`, `machines`,
   `mermaid`, `terminal`, `workspaces`. Each keeps its settings sections, dialogs, panels, actions,
   persistence, and machine/project scoping. The first plugin migrated defines the shape the other seven
   copy.
3. The Lit path goes: the `html`/`css`/`svg` template tags in the plugin API, `PluginSurface`'s
   `lit-html` render, the Lit chrome, `lit`/`lit-html` from the client and plugin manifests, and the
   tests that pinned Lit output.

Nothing in the server, the plugin catalogue, the manifest format, the settings storage, or the plugin
lifecycle events is part of this removal.

## What breaks, and the migration note

Third-party plugins written against the Lit API stop rendering. The migration is mechanical: replace
`html\`...\`` with JSX (or `createElement`), rename the render field to its React name, and import
`createElement` from the host through the plugin API instead of `lit`. Bundled plugins move in the same
series, so the repository is never in a state where its own plugins need the removed API.
