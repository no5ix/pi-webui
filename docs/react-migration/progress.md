# React migration progress

This is the single authoritative record of the React migration: overall status, completed work,
remaining work, known issues, test results, browser verification, architectural decisions, and the next
action. It replaces the separate parity ledger, which was merged into the
[Parity ledger](#parity-ledger) section here. The two other files in this directory are specifications,
not progress records: [plugin-api-react.md](plugin-api-react.md) (the React plugin contribution contract)
and [plugin-bootstrap-spec.md](plugin-bootstrap-spec.md) (how the registry boots in React).

Branch: `feat/react-workspace-ui-from-main`. The React app is the entry point:
`src/client/index.html` loads `/src/react-main.tsx`, which renders `ReactWorkspaceApp`. The Lit
application (`src/client/src/main.ts`) is no longer an entry point.

### Checkpoint 2026-11-22 05:40

Phase 1 of the current mission is complete: the five open findings are triaged with mechanisms, not
guesses. Three real defects are fixed - the React palette now projects from the theme the applier paints
(`f1f219ed`), a package removal that found nothing says so (`dd987bb9`), and a single-list refresh drains
its own read instead of holding the page at "Loading settings…" forever (`8a423d92`); the close control
got a browser handle (`f0892930`). Phase 5 is largely evidenced, desktop and 393x850, with three named
open items in **Phase 5 status** - the hung MCP test-connection locking its panel (product decision on
the timeout), the pi-managed package removal, and a harness read-back that queries the wrong scope.
Phase 4 (plugin React integration) is **not started**. The verify gate passes at this HEAD:
**`pnpm run verify` exit 0 - 696 files, 6140 passed, 5 skipped, 0 failed** (typecheck, ESLint, Knip and
the suite in one gate).

### Checkpoint 2026-11-21 04:40

Workbench merged, suite green at `4aeb71d4` (**6154 passed / 5 skipped / 0 failed**; typecheck, lint,
Knip exit 0; production build 0). Two commits land after that number — `ee66cc6c` (a scoped Settings
write must answer with the scope the page shows) and `b923ea48` (the add-project test fake was one api
method short) — each with its own targeted suite green (54 and 2). **`pnpm run verify` at `4f3bac11`
exits 0: 694 files, 6130 passed, 5 skipped, 0 failed** (typecheck, lint, Knip and the suite in one
gate).
Browser: 8/8 Settings sections pass at 1440x900; five findings are open and listed in
**Browser pass of 2026-11-21**. Phase 5 is not verified; the plugin phases (3A/3B) are not started; the
project/session, conversation/composer and Settings parity audits (Phase 2/4) have not been performed.

Lit import counts, measured with
`grep -rl 'from "lit"' <dir> --include='*.ts' --include='*.tsx' | grep -v '\.test\.'`:
**87** non-test files under `src/client/src`, **26** under `pi-web-plugins`, **0** under `src/server`.
`lit@^3.3.3` is a client dependency. `lit/html` is expected to stay for the plugin host.

A row is **Verified** only with live browser evidence at desktop 1440px and mobile 393x850 against a
real session daemon. **Unit tested** means the React unit suite covers it and no browser has seen it.
**Partial** names the gap in the row.

## Status of the Settings surface

Settings is `src/client/src/react/ReactSettingsDialog.tsx`: a native `<dialog>` opened with
`showModal()`, a searchable page rail, one panel per section, body scroll lock, Escape, and a reload
when the machine or the project changes. The reads answer through the scope ledger in
`react/settings/settingsScope.ts`: one read answers one machine, and for Skills and MCP Servers one
project on that machine, and an answer only counts when its scope key and request id match the newest
read, so a reply about a scope that has left the screen is dropped instead of drawn under the heading of
the scope now on screen, and a resource whose request could not start is answered so the page cannot sit
at "Loading settings…" forever. Sections: General, Appearance, Notifications, Pi Packages,
MCP Servers, Pi Web Plugins, Machines, Skills. Keyboard settings are absent by decision.

| Section | State | Notes |
| --- | --- | --- |
| General, Appearance, Notifications | Unit tested | `AppearanceSettings.tsx` writes no preference yet |
| Pi Packages | Implemented; desktop browser pass recorded | see [Pi Packages](#pi-packages) |
| MCP Servers | Implemented; desktop browser pass recorded | see [MCP Servers](#mcp-servers) |
| Skills | Implemented; desktop browser pass recorded | see [Skills](#skills) |
| Pi Web Plugins, Machines | Unit tested | not part of this mission |
| Keyboard | Excluded by decision | not in the React nav |

### Pi Packages

`src/client/src/react/settings/PiPackagesSettingsPanel.tsx` with the rules in
`settings/piPackagesSettingsState.ts`. One request per machine: the Pi Packages tab reads the active
machine's packages, so a package row is read from that machine and written back to it, and the header
names the machine the list belongs to.

- Source input, install, update, update all, enable, disable, remove, reload.
- Install source validation, and an install-source note that names the machine the package lands on.
- A trusted-code warning that is shown until it is dismissed and recorded in browser storage, so the
  notice is not re-shown for a machine the operator has already read it for.
- Per-row busy labels, one operation at a time, row actions disabled while the page has a write in
  flight.
- Empty, loading, error, disabled-while-busy, and failure states are all rendered from data.
- The package list, `disabled`, and `autoUpdate` all go through the existing `piPackagesApi` and the
  server's `piPackageService`; no package state is kept in the browser.
- The copy keeps the requirement that existing sessions need `/reload` to pick up package changes.
- Tests: `settings/PiPackagesSettingsPanel.test.ts` (render, install, update, update-all, remove,
  enable/disable, validation, failure, busy).

### MCP Servers

`src/client/src/react/settings/McpSettingsPanel.tsx` with the rules in
`settings/mcpSettingsState.ts` and the form model in the shared `react/mcpForm.ts` (also used by the
legacy page, so there is one form contract).

- Global servers from the active machine's global Pi MCP configuration, project servers from the
  selected project's MCP configuration, in separate sections that name where each definition is stored.
- The project scope selector carries the machine plus the project so a project label from one machine
  cannot select another machine's project.
- Add, edit, enable, disable, test connection, remove, reload — for global and for project scope.
- Enable and disable write one field: the panel sends the server identity (path, definition name,
  transport, scope, machine) and the server flips `enabled` and re-reads the file, so a browser round
  trip never rewrites a definition.
- Remove is scope-aware: an override that hides a global server is removed by clearing the override,
  which brings the global server back; a project definition removes the definition.
- The editor is one form per scope. A global edit writes global, a project edit writes project, and a
  project override can be created over a global server of the same name. Secrets are round-tripped
  through the masked `***` marker: the panel submits the model it was shown, and the server keeps the
  stored value for a field that comes back masked, so no secret value ever reaches the browser.
- The server validates every definition, rejects an empty definition, and refuses an ambiguous
  definition target. Configuration and connection failures render as panel notices with the server's
  message.
- Tests: `settings/McpSettingsPanel.test.ts` (scope separation, scope selector, add/edit/override,
  enable, test, remove-override, failure copy) and `settings/mcpSettingsState.test.ts` (the pure rules,
  including the per-machine project scope and the remove targets).

### Skills

`src/client/src/react/settings/SkillsSettingsPanel.tsx` with the rules in
`settings/piSkillsSettingsState.ts`.

- Global skills and the selected project's skills in separate sections, each naming its scope.
- Enable, disable, reload, and validation diagnostics per skill; the list is Pi's own discovery
  (`piSkillsApi` + `piSkillSettingsService`), and the browser never writes a skill file.
- Global preferences stay global, project preferences stay project-scoped; the request carries the
  scope and the project, so a project switch loads the right list and a project toggle cannot write a
  global preference.
- Skills supplied by a disabled Pi package are reported as such with the reason and the place to fix it
  (the package settings), because toggling the skill there is the only way to make it load.
- Missing project skills directory, no configured skills, disabled, validation, busy, and failure
  states are all rendered.
- Tests: `settings/SkillsSettingsPanel.test.ts` (scope separation, per-scope toggles, package-supplied
  skills, validation notes, failure copy) and `settings/piSkillsSettingsState.test.ts` (the pure rules).

### Shared settings primitives

`src/client/src/react/settings/SettingsSurface.tsx` is the shared shell the legacy panels use:
`SettingsPageHeader` (title, note, busy line, actions), `NoticeList` (success, error, busy, dismissal),
`SettingsCard`, `SettingsTextInput`, `SettingsCheckbox`, `SettingsSelect`, `SettingsButton`,
`SettingsBusyLine`, `SettingsSection`, `formatSettingsScopeLabel`. The three panels above and the
existing General/Appearance/Notifications/Machines/Plugins panels all use it, so loading, error, and
busy handling is one implementation.

`src/client/src/react/settings/SettingsKit.tsx` is the React-native kit the three modules use:
`SettingsSection` (title, note, count, actions), `SettingsCard` (title, meta, diagnostics, actions, and
the row's `data-test-id`), `SettingsEmpty`, `SettingsNoticeList` (the success / busy / error line, keyed
by a sequence number so the same sentence re-announces), `SettingsMachineLine`, and the two input
helpers the panels repeat. Nothing in it fetches.

The panels' CSS is in `src/client/src/react/workspace.css`: `.rw-settings-*` for the shell, sections,
cards, notices, forms and the switch, and `.rw-mcp-*` for the MCP panel. Class-per-rule, no inline
styles, colours and spacing from `src/client/src/styles/tokens.css`. A phone-width block
(`max-width: 640px`) stacks card actions and inline forms, turns the section rail into a scrolling row,
and raises the switch to a 44px target; the coarse-pointer floor for a control lives in the rule that
styles the control, not in the media query. Transitions are inside
`@media (prefers-reduced-motion: no-preference)`, and the switch's knob ring is a
`:focus-visible` outline. `settings/settingsStyles.test.ts` parses the stylesheet into rules and asserts
that every class a panel renders is styled and that each control meets its floor, so a class that loses
its CSS fails a test.

### Data layer

`src/client/src/react/useReactWorkspaceData.ts` owns the settings state as three groups — `packages`,
`skills`, `mcp` — each `{ loading, data, error }`, and exposes operations that carry their scope in the
request, so a caller cannot write to a scope it did not read:

- Packages: `onPackageMutation(request)` built from `piPackageInstallRequest` /
  `piPackageRemoveRequest` / `piPackageSetEnabledRequest`, and `onPackagesReload`.
- MCP: `onMcpMutation(target, request)`, `onMcpAdd`, `onMcpSave`, `onMcpProjectAdd`, `onMcpRemove`,
  `onMcpTest(target)`, and `onMcpReload`.
- Skills: `onSkillsMutation(target)` (scope, skill id, and the project the row belongs to), and
  `onSkillsReload`.
- `onSettingsReload` reloads all three groups at once; each group is merged into the previous state per
  key, so a machine that answers for skills and refuses for MCP keeps the skills it had.

Each mutation applies the server's returned state, renders the server's success sentence, and reports a
failure through the group's error state. A second mutation of the same kind is refused while one is in
flight. The panels own no fetch logic and keep only their own editor and per-row busy state.

React 19 pins one rule here: a value read during render must not be written during render. The hook's
`loadSettings` and every panel submit path follow it — a `ref` is assigned in an effect, and the value a
render needs is mirrored in state (the MCP panel's "keeps the submit-time mirror in step" test pins that
behaviour). The callbacks depend on `api`, a module import that never changes, so their identity is
stable and `exhaustive-deps` stops being fought.

## Parity ledger

The 2026-08-22 audit rows are kept as history under [Audit checkpoint](#audit-checkpoint-2026-08-22);
the table below is the current row set the definition of done is measured against.

| Area | Row | State | Evidence |
| --- | --- | --- | --- |
| Runtime | React is the running app (`index.html` → `react-main.tsx`, `#root`) | Verified | live stack: `GET /` 200, the React module 200 |
| Runtime | Lit runtime for first-party UI | Partial — required | 87 files under `src/client/src`, 26 under `pi-web-plugins/` import `lit` |
| Runtime | Two React roots, no interop | Partial — defect | the workspace root and the Lit overlay root both mount on `document` |
| Plugins | Registry, core + external load, dispose, failure in Settings | Unit tested | `react/usePluginRegistry.ts`, `usePluginRegistry.test.ts`, `PluginSurface.test.ts` |
| Plugins | Contribution families render in React | Not migrated | all families are Lit (`TemplateResult`); the React contract is the spec in `plugin-api-react.md` |
| Plugins | Bundled plugin UI | Not migrated | `files`, `git`, `goal`, `info`, `machines`, `mermaid`, `terminal`, `workspaces` are Lit |
| Settings | Modal shell, sidebar nav, Esc, body scroll lock, search, touch sizing | Unit tested | `ReactSettingsDialog.test.ts` |
| Settings | General, Appearance, Notifications | Unit tested | `AppearanceSettings.tsx` writes no preference |
| Settings | **Pi Packages** | Implemented, desktop browser pass | panel + rules + tests; live install/update/remove/enable pass recorded |
| Settings | **MCP Servers** | Implemented, desktop browser pass | panel + rules + form + tests; live global/project add, edit, enable, test, remove recorded |
| Settings | **Skills** | Implemented, desktop browser pass | panel + rules + tests; live global/project enable, disable, validation, reload recorded |
| Settings | Pi Web Plugins, Machines | Unit tested | per-machine registry; no live pass |
| Settings | Keyboard section | Excluded by decision | not in the React nav |
| Projects | Create, switch, close, rename, trust, folder navigation | Partial | unit tests pass; no live pass |
| Sessions | Create, switch, rename, delete, history, restore | Partial | unit tests pass; no live pass |
| Conversation | Messages, streaming, tools, thinking, timestamps, attachments | Partial | unit level only; no real provider prompt |
| Composer | Submit, stop, model and thinking-level pickers, status | Partial | unit level only |
| Machines | Switching rebuilds the registry, settings, status | Unit tested | per-machine registry; no live pass |
| Updates | Built-in update notification and UI | Removed | see [the Updates module](#the-updates-module-removed-2026-08-22) |
| Lit removal | Dependencies, bridge, legacy components | Not migrated | `lit`/`lit-html` in `package.json`, the plugin API package, 8 plugin manifests |
| Verification | React tree lint coverage | Resolved | `eslint.config.mjs` includes `src/**/*.tsx`; the tree is clean |
| Verification | Full `pnpm run verify` | see [verification record](#verification-record) | recorded per run below |

## Architectural decisions

1. **React owns the Settings UI; the backend stays.** The three modules reuse the existing routes
   (`src/server/web/piPackageRoutes.ts`, `piMcpRoutes.ts`, `piSkillsRoutes.ts`), services
   (`piPackageService.ts`, `piMcpService.ts`, `piSkillSettingsService.ts`), API clients and shared
   types. No second package, MCP, or skill store exists, and no configuration semantics changed.
2. **Backend additions are narrow and additive.** Server-side work was limited to what the operations
   needed (an override-aware MCP remove, a single-field MCP enable, install-source validation and the
   machine-scoped package reads). Working backend behavior was not rewritten to suit React.
3. **Scope travels with the request.** Every settings read and write carries the machine, and where
   applicable the project. The UI names the scope it is editing. A panel cannot write a scope it did
   not read because the scope is an argument, not a captured value.
4. **Secrets never reach the browser.** MCP env and header values are masked (`***`); a masked value
   round-trips and the server keeps the stored one. Configuration, connection, and save errors are
   reported without echoing secret values.
5. **Pure rules in plain modules.** Classification and formatting for each module live in
   `settings/*State.ts` files with tests, so the panel stays a renderer and the rules are testable
   without a DOM.
6. **No new Lit, no Lit compatibility growth.** The three modules are React-only; the Lit panels
   remain as the legacy implementation until the app removes them.
7. **A plugin's `TemplateResult` cannot be rendered by React directly.** `lit/html` stays in
   `package.json` for the plugin host; the honest reading of "React-only" is that the application's own
   UI is React-only while third-party contributions keep Lit rendering behind an adapter.

## Known issues

- **`Appearance` writes no preference** (`react/AppearanceSettings.tsx`).
- **Plugin contributions are not rendered by React.** `usePluginRegistry` boots and disposes the
  registry and `PluginSurface` renders one `TemplateResult`; no workspace panel, nav section, list
  label, tool/message renderer, code fence renderer, theme, settings section, or composer contribution
  is wired. This blocks the Lit removal.
- **Two React roots** (the workspace app and the Lit overlay) mount on `document` with no interop.
- **The main React chunk is ~940 kB** and warns at build. It must be split, not silenced.
- **Knip unused exports**: a set of schemas in `src/shared/types.ts` whose only consumer is an HTTP
  route. Recorded, not hidden with an ignore.
- **React tree lint**: `eslint.config.mjs` now includes `src/**/*.tsx`; the 145-error baseline measured
  on 2026-11-20 is cleared. Any new React work lands inside the gate.

## Verification record

- 2026-11-21 (merge of `feat/workspace-activity-workbench`): the merge is `22789815` on
  `feat/react-workspace-ui-from-main`, with the follow-ups `59f4d49c` (test debt), `6747c436` (the
  incoming branch's own typecheck break) and `4aeb71d4` (the incoming branch's own lint errors). The
  incoming branch is 39 commits ahead of the merge base and its head `77045c03` **does not typecheck and
  does not lint**: `3ca62096` cut 71 lines of retired inline-activity code and deleted the definitions of
  `gitMutationSuccess` and `renderGitChangeSection` while leaving their call sites, it passed
  `AddProjectDialog` optional props as explicit `undefined` under `exactOptionalPropertyTypes`,
  `chatGroups.ts` interpolated four counts into template literals, and `ProjectTree.test.ts` built a
  session fixture with `as never`. All four are repaired on this branch. The one textual conflict was
  `src/client/src/react/workspace.css`, where both branches appended a block at end of file: this
  branch's phone settings-target floor and the workbench's activity and workbench-tab rules. Both are
  kept, and the settings media query is closed before the workbench rules begin; a selector-by-selector
  comparison against both sides shows the merge introduced no duplicate that neither branch already had
  (the incoming sheet carries 53 of its own repeated selectors, which is not this merge's debt and was
  not touched).
- 2026-11-21 (the eight red tests): the suite has been red since the Updates-module removal, in
  `src/buildContents.test.ts`, `src/server/shared/piWebStatus.test.ts` (2),
  `src/server/web/piWebPluginService.test.ts` (2),
  `src/server/shared/plugins/packageInstalledPlugin.test.ts`,
  `src/server/web/service/fleetRoutes.test.ts` and
  `src/client/src/components/settings/SettingsGeneralPanel.test.ts`. All eight pass now. One change is a
  real test-isolation defect, not Updates debt: two `piWebPluginService.test.ts` fixtures registered a
  plugin with the id `updates` and built the service with the default config provider, which loads the
  developer's own `~/.config/pi-web/config.json` — on a machine that had disabled the old updates plugin
  the fixture was filtered out and the test answered `plugins: []`, so those two tests were green only on
  a machine with no such preference. The fixtures now use their own ids and pass an empty config provider.
- 2026-11-21 (checks over the merged tree): `tsc --noEmit` exit 0; `pnpm run lint` exit 0; `pnpm run
  knip` exit 0; `pnpm run verify`, `pnpm run build` and the browser pass are recorded as they complete.

- 2026-11-20: `pnpm run verify` exit 0 over the MCP and notifications milestone — typecheck, lint,
  Knip, Vitest; 689 test files, 6056 tests passed, 5 skipped.
- 2026-11-20: `pnpm run build` exit 0 (a first attempt failed in `pnpm run clean` with `ENOTEMPTY` on
  `dist` because a dev stack was writing into it; the retry was clean).
- 2026-11-20: over the Updates-module removal, focused Vitest runs over the touched client surfaces
  (10 files, 169 tests) and server surfaces (9 files, 36 tests) pass; the full suite on `fd5b553b`
  left 6 files / 8 tests red, which are the removal's own test debt:
  `src/buildContents.test.ts` (generated plugin API declaration baseline),
  `src/server/shared/piWebStatus.test.ts` × 2, `src/server/web/piWebPluginService.test.ts` × 2,
  `src/server/web/service/fleetRoutes.test.ts`,
  `src/client/src/components/settings/SettingsGeneralPanel.test.ts`,
  `src/server/shared/plugins/packageInstalledPlugin.test.ts` (cause not triaged). The rule is that a
  test pinning removed behavior is updated or deleted with the change that removes it; `ab309e84` did
  not do it, and `verify` has not been green since.
- 2026-11-20: `npx eslint src/client/src/react --no-warn-ignored` measured 145 errors / 176 warnings
  over 78 files (119 `react-hooks/refs`, 35 `react-x/no-array-index-key`,
  11 `react-hooks/preserve-memo-validation`; 216 clear with `--fix`). `pnpm run lint` was exit 1 for
  that reason.
- 2026-11-20 (Pi Packages, MCP Servers, Skills): focused Vitest runs over the three panels, the two
  rule modules, the MCP form, the settings dialog, and the data hook; results in
  [Browser and automated verification](#browser-and-automated-verification-2026-11-21).
- 2026-11-21: `npx vitest run` over the branch with these modules implemented — **6 files / 8 tests red,
  684 files passed, 6096 tests** — the *same* eight as `fd5b553b`. Proven pre-existing: those six suites,
  run in a disposable worktree at clean `HEAD` (`3f74b4ca`, carrying none of my changes), fail with the
  identical set (`/tmp/baseline-run.log`). This run's messages: `src/buildContents.test.ts`
  (`plugin-api.d.ts changed; update the baseline only for an intentional public API change`),
  `piWebStatus.test.ts` × 2 (the Docker command-suggestion objects), `piWebPluginService.test.ts` × 2
  (`{ lifecycleVersion: 1, plugins: [] }` against an expected manifest, and
  `/pi-web-plugins/manifest.json` against `/pi-web-plugins/updates/pi-web-plugin…`),
  `packageInstalledPlugin.test.ts` (`Build failed with 1 error`), `fleetRoutes.test.ts`
  (`expected undefined to deeply equal [ { machineId: 'remote-a', … } ]`),
  `SettingsGeneralPanel.test.ts` (`expected [ 'Lab Mac (remote machine)', …(4) ] to have a length of 6
  but got 5`). None of them loads a module these three modules touched. They stay red here: the repair
  belongs to the change that removed the Updates module, and rewriting a public API baseline is outside
  this mission.
- 2026-11-24: the React lint gate is cleared, from 145 errors at the 2026-11-20 baseline to **0 errors,
  119 warnings** over `src/client/src/react`, `src/server/sessiond.ts` and `src/shared/types.ts`
  (`.eslintignore` does not exist, so `--no-warn-ignored` is the flag to use; `--fix` fixes about half).
  Two rules carried the debt: writing a `ref` during render (98), and a key derived from an array index
  (35). The fixes are structural, not suppressions — a `ref` assigned in an effect with the value a
  render needs mirrored in state; keys that name the data (`row.node?.path ?? row.index`, the plugin
  index plus its name, the first argument of a command, the skill's file, the MCP file path), and one
  list (the skills grid, `src/client/src/components/SkillsGrid.tsx:46`) now filters out the unnamed entry
  in the caller through the shared `usableSkills` filter in
  `src/client/src/components/skills/skillDisplayModel.ts` — which is also the point where an unnamed
  skill stops rendering as a card, and the React Skills page counts it in a diagnostic line instead.
  `react-hooks/exhaustive-deps` is not suppressed: the handlers are memoized with exactly the
  dependencies they read, and a stable state updater (`setForm(current => …)`) removed the need for the
  form's identity. `src/client/src/react/workspace-data-types.ts` also gained its `react-refresh` mark:
  a module of types and pure helpers is not a component module. The remaining 119 warnings are two
  families — 84 `react-x/jsx-no-leaked-render`, which the plugin itself reports as unsafe to `--fix`
  (`{cond && <El/>}` renders a `0` when `cond` is a number), and 30 `react-x/blueprint-react-components`,
  which asks for a `"use no eval"` directive on every component module; both are a sweep outside this
  mission, and neither is an error.
- 2026-11-24: the checks over the finished three modules — `tsc --noEmit -p tsconfig.json` exit 0;
  `pnpm run lint` exit 0 (0 errors / 119 warnings); `pnpm run knip` exit 0; `pnpm run build` exit 0, the
  client and server builds and the plugin typecheck included (the main React chunk is 931.30 kB /
  267.06 kB gzipped, and the ~940 kB chunk warning above stands); `npx vitest run` reports **6091 tests
  passed / 8 failed / 5 skipped**, the 8 failures being exactly the pre-existing set proven at clean
  `HEAD` above — none of them loads a module this mission touched.

## Browser and automated verification (2026-11-21)

Recorded per run below. A check must fail loudly on a missing session daemon rather than pass empty,
and daemon-side claims are checked against the daemon's logs.

The harness is a raw Chrome DevTools Protocol driver (no committed Playwright suite exists in this
repository): it drives a real headless Chromium against the isolated 8505 stack
(`scripts/stack-8505.sh up`, with `PI_WEB_8505_AGENT_DIR` isolating pi's own state), seeds fixtures
through PI WEB's own APIs, and fails loudly when a precondition is missing.

Two fixture lessons are recorded because they are product behavior, not test trivia: a package source is
resolved by pi against the **server's working directory**, so a fixture installs through
`POST /api/machines/local/pi-packages/install` with an absolute path rather than writing
`settings.json` by hand; and project scope is gated by PI WEB's **workspace trust** decision, so a
fixture trusts the project with `PUT /api/machines/local/projects/<id>/workspaces/<id>/trust`. A page
whose project is untrusted says so — "This project is not trusted, so its MCP servers are not read,
changed, or connected" — and that is the honest answer, not a defect.

Two automation contracts are recorded for the same reason, because each one made a page look broken
when the driver was the thing at fault. `Runtime.evaluate` rejects a top-level `return`: a driver
expression has to arrive as one expression, so a `return …` string is wrapped as
`(function(){ … })()` before it is sent. And a helper object installed on the page is *per page*: a
page installed on `about:blank` is gone after the first navigation, and a same-origin `fetch` from
`about:blank` answers `Failed to fetch`, which reads as "the app's API is down". A driver that
navigates should therefore be stateless — one `Runtime.callFunctionOn` remote function per action,
with named arguments — and everything that asserts about a **config file** belongs in the Node
process, not in the page.

### Automated verification, as measured

| Check | Result |
| --- | --- |
| `tsc` over the app and over the test sources | exit 0 |
| `eslint` over the project | exit 1 — 0 errors, 267 warnings (clean `HEAD` reports 145); the gate is the warning budget, not this code |
| `knip` | exit 2 — the one export it names, `SettingsField` in `SettingsKit.tsx`, is imported by `McpSettingsPanel.tsx`; recorded as a Knip false positive, not acted on |
| `vitest run` | 6093 passed, 8 failed, 5 skipped (6107) |
| production build | exit 0 |

The 8 failures are in 6 files — `src/buildContents.test.ts`, `src/server/shared/piWebStatus.test.ts`,
`src/server/web/piWebPluginService.test.ts`, `src/server/shared/plugins/packageInstalledPlugin.test.ts`,
`src/server/web/service/fleetRoutes.test.ts` and `src/client/src/components/settings/SettingsGeneralPanel.test.ts`
— and they are the unit debt the Updates-module removal left behind, recorded in
"The Updates module removed". They were reproduced at clean `HEAD` in a disposable worktree, so they
are pre-existing, not from this work; `SettingsGeneralPanel` is the Lit panel this mission does not touch.
A seventh file appears in some full-suite runs and passes in isolation, which is a parallel-run flake.


Merged from the parity ledger. "Legacy" names the implementation the behavior comes from; it is the map
for the work that remains, not a rename checklist.

| Area | Legacy implementation | React implementation | State | Verification note |
| --- | --- | --- | --- | --- |
| Browser entry and startup | `src/client/src/main.ts`, `components/PiWebApp.ts` | `react-main.tsx` → `react/ReactWorkspaceApp.tsx` | Implemented — needs verification | `bootImportGraph.test.ts`; the React production build passes |
| Application state and scoped data | `appState.ts`, controllers, realtime, outbox | `react/useReactWorkspaceData.ts` over the existing controllers, APIs, sockets, outbox | Implemented — needs verification | controller/API suites; live behavior unverified |
| Shared UI primitives | Lit `ModalSurface`, `ConfirmCard`, banners, notices, pickers | `react/ConfirmDialog.tsx`, `react/settings/SettingsSurface.tsx`, image and disclosure dialogs | Partially implemented | `SessionActionsMenu.test.ts` (confirmation, cancel/Escape, focus restore, pending); broad primitive coverage incomplete |
| Theme and responsive shell | `index.html`, Lit shell, theme modules | `react/tokens.css`, `react/workspace.css` | Partially implemented | design-token tests cover the legacy surface; `docs/ui-design/Dark Mode Developer Workspace UI.png` is the reference |
| Project and session navigation | `PiWebApp.ts`, `AppNavigatePage.ts`, `SessionTreeNavigator.ts`, workspaces plugin UI | `react/ProjectTree.tsx`, `ReactWorkspaceApp.tsx` | Implemented — needs verification | legacy navigator tests; React interactions unverified |
| Project lifecycle | `ProjectDialog.ts`, `ProjectRenameDialog.ts`, `ProjectController`, `InstantActionController` | create + undoable close in React; Add project uses the controller with machine-bound directory suggestions and trust read/write; folder browsing, rename, trust menu absent | Implemented — needs verification | `ProjectTree.test.ts`, `AddProjectDialog.test.ts`, `projectController.test.ts`, `reactInstantActions.test.ts`; a live 393x850 pass created a project through the React dialog and showed it selected; folder browsing and rename unverified |
| Session lifecycle | `SessionController`, session tree, `InstantActionController` | list/select/create; menu actions through the controller; archive, restore, confirmed archived deletion with scoped optimistic projection, Undo, read reconciliation | Implemented — needs verification | `SessionActionsMenu.test.ts`, `reactInstantActions.test.ts`, `sessionController.rename.test.ts`; a live pass confirmed archive closes the menu, returns focus, and Undo works; the daemon kept the session listed and unarchived |
| Machine selection and management | machine plugin `MachineDialog.ts`, `SettingsDialog.ts`, machine/auth controllers | selection scopes the API calls; display and health in the sidebar | Partially implemented | machine controller/access/dialog tests; React parity unverified |
| Removed navigation | `ActionPalette.ts`, `CommandPicker.ts`, `QuickSwitcher.ts` | none | Intentionally removed | global palette, standalone command picker and quick switchers are out; composer commands and normal navigation stay |
| Transcript messages and grouping | `ChatView.ts`, `ToolExecutionView.ts` | `react/ConversationMessage.tsx` (parts, timestamps, copy, image viewer, provider failure detail) | Implemented — needs verification | `ConversationMessage.test.ts`; grouping and retry remain |
| Streaming, waiting, reconnect, stop | `SessionController`, realtime, outbox | the data hook plus React stop/streaming props | Implemented — needs verification | stream/recovery/controller tests; no authenticated provider run |
| Images, cards, notices, extensions | `ChatView.ts`, `InteractiveCard.ts`, `ConfirmCard.ts` | transcript parts render; not all dialog/action flows are wired | Partially implemented | legacy tests only |
| Transcript navigation and activity | `ChatView.ts` scroll/activity helpers | disclosures, controller-backed earlier-page loading, scope-keyed scroll anchoring, auto-follow, jump-to-latest | Partially implemented | React paging and scrolling unverified in a browser |
| Prompt composition and delivery | `PromptEditor.ts`, `outboxDriver.ts` | delivery delegates to the existing controller/outbox | Implemented — needs verification | delivery/outbox tests; no live authenticated prompt |
| Composer completions and history | `PromptEditor.ts`, `AutocompleteMenu.ts` | prompt history, file/model/extension completion, keyboard selection | Partially implemented | completion/history tests; React interaction unverified |
| Attachments and mobile input | `PromptEditor.ts` capture/draft/attachment helpers | file selection, paste/drop, capture, removal | Partially implemented | no mobile browser verification |
| Model, provider, thinking selection | `ModelPicker.ts`, composer controls | selects over `sessionsApi` | Implemented — needs verification | model picker/controller tests; React UI unverified |
| Settings shell and General | `SettingsDialog.ts`, `SettingsGeneralPanel.ts` | `ReactSettingsDialog.tsx`; partial-field saves merge against the latest persisted config through a serialized write queue shared with plugin toggles | Implemented — needs verification | `ReactSettingsDialog.test.ts`, `configWriteQueue.test.ts`; a desktop and 393x850 pass showed all eight pages, Escape close, focus return; settings writes not exercised |
| Appearance | `SettingsAppearancePanel.ts`, theme services | native theme choice, stored preference, follow-system, pairing through the same theme module | Partially implemented | page render checked; contributed-theme list and live reload not exercised |
| Notifications | `SettingsNotificationsPanel.ts`, `notifications/ntfy.ts`, `notifications/ntfyForm.ts` | the React page edits the whole ntfy block and a test delivery; the rules live in `notifications/ntfyForm.ts`, shared with the Lit page, so the secret-handling rules cannot drift. A test press is offered only when the browser granted permission; a denied one is named as blocked; while the stored block is unknown the form is not rendered | Implemented — needs verification | `NotificationsSettingsPanel.test.ts` (14), `notifications/ntfyForm.test.ts` (21); no live ntfy delivery |
| Workspace: Git | Git plugin browser UI and the Git backend contract | scoped status, staged/unstaged diffs, per-file and bulk stage/unstage, confirmed discard, commit, local branch switch, fetch/pull/push, remote counts | Partially implemented | backend fixture tests and React presentation tests pass; live and cross-scope mutations unverified. **Backend gaps: no branch-create, remote-list, or upstream-configuration operation; Git diff paths are not passed with literal-pathspec mode, so a filename containing pathspec magic can resolve differently — a coordinated backend fix is required.** |
| Workspace: files and editor | files plugin, file services, CodeMirror viewer | file tree, search, create/upload/read/edit/save/delete, multi-file editor | Partially implemented | CodeMirror and file backend tests; browser workflows unverified |
| Workspace: terminal | terminal plugin and services | `ReactTerminalPanel.tsx` | Implemented — needs verification | plugin-UI tests target the legacy surface; the React terminal is unverified |
| Status, notifications, errors | `StatusBar.ts`, notification dispatcher | React status footer (machine label, session metrics, tokens/context/cost/branch, activity) | Partially implemented | only API-backed facts are shown; announcements unverified |
| Lit UI and custom elements | `src/client/src/main.ts`, `components/PiWebApp.ts`, component trees | `react-main.tsx` mounts React from `index.html` | Not implemented | remove the inactive Lit UI only after behavior and plugin replacement |
| Bundled plugin browser UI | `pi-web-plugins/*/browser` | React covers selected surfaces (git, files, editor, terminal) | Not implemented | plugin tests stay Lit-oriented and are not React parity evidence |
| Dependencies, tests, assets | `package.json`, Lit harness tests, templates | React build proves neither removal nor parity | Not implemented | keep the shared contract tests |

## Area rows: legacy implementation, React state

Merged from the parity ledger. "Legacy" names the implementation the behavior comes from; it is the map
for the work that remains, not a rename checklist.

| Area | Legacy implementation | React implementation | State | Verification note |
| --- | --- | --- | --- | --- |
| Browser entry and startup | `src/client/src/main.ts`, `components/PiWebApp.ts` | `react-main.tsx` → `react/ReactWorkspaceApp.tsx` | Implemented — needs verification | `bootImportGraph.test.ts`; the React production build passes |
| Application state and scoped data | `appState.ts`, controllers, realtime, outbox | `react/useReactWorkspaceData.ts` over the existing controllers, APIs, sockets, outbox | Implemented — needs verification | controller/API suites; live behavior unverified |
| Shared UI primitives | Lit `ModalSurface`, `ConfirmCard`, banners, notices, pickers | `react/ConfirmDialog.tsx`, `react/settings/SettingsSurface.tsx`, image and disclosure dialogs | Partially implemented | `SessionActionsMenu.test.ts` (confirmation, cancel/Escape, focus restore, pending); broad primitive coverage incomplete |
| Theme and responsive shell | `index.html`, Lit shell, theme modules | `react/tokens.css`, `react/workspace.css` | Partially implemented | design-token tests cover the legacy surface; `docs/ui-design/Dark Mode Developer Workspace UI.png` is the reference |
| Project and session navigation | `PiWebApp.ts`, `AppNavigatePage.ts`, `SessionTreeNavigator.ts`, workspaces plugin UI | `react/ProjectTree.tsx`, `ReactWorkspaceApp.tsx` | Implemented — needs verification | legacy navigator tests; React interactions unverified |
| Project lifecycle | `ProjectDialog.ts`, `ProjectRenameDialog.ts`, `ProjectController`, `InstantActionController` | create + undoable close in React; Add project uses the controller with machine-bound directory suggestions and trust read/write; folder browsing, rename, trust menu absent | Implemented — needs verification | `ProjectTree.test.ts`, `AddProjectDialog.test.ts`, `projectController.test.ts`, `reactInstantActions.test.ts`; a live 393x850 pass created a project through the React dialog and showed it selected; folder browsing and rename unverified |
| Session lifecycle | `SessionController`, session tree, `InstantActionController` | list/select/create; menu actions through the controller; archive, restore, confirmed archived deletion with scoped optimistic projection, Undo, read reconciliation | Implemented — needs verification | `SessionActionsMenu.test.ts`, `reactInstantActions.test.ts`, `sessionController.rename.test.ts`; a live pass confirmed archive closes the menu, returns focus, and Undo works; the daemon kept the session listed and unarchived |
| Machine selection and management | machine plugin `MachineDialog.ts`, `SettingsDialog.ts`, machine/auth controllers | selection scopes the API calls; display and health in the sidebar | Partially implemented | machine controller/access/dialog tests; React parity unverified |
| Removed navigation | `ActionPalette.ts`, `CommandPicker.ts`, `QuickSwitcher.ts` | none | Intentionally removed | global palette, standalone command picker and quick switchers are out; composer commands and normal navigation stay |
| Transcript messages and grouping | `ChatView.ts`, `ToolExecutionView.ts` | `react/ConversationMessage.tsx` (parts, timestamps, copy, image viewer, provider failure detail) | Implemented — needs verification | `ConversationMessage.test.ts`; grouping and retry remain |
| Streaming, waiting, reconnect, stop | `SessionController`, realtime, outbox | the data hook plus React stop/streaming props | Implemented — needs verification | stream/recovery/controller tests; no authenticated provider run |
| Images, cards, notices, extensions | `ChatView.ts`, `InteractiveCard.ts`, `ConfirmCard.ts` | transcript parts render; not all dialog/action flows are wired | Partially implemented | legacy tests only |
| Transcript navigation and activity | `ChatView.ts` scroll/activity helpers | disclosures, controller-backed earlier-page loading, scope-keyed scroll anchoring, auto-follow, jump-to-latest | Partially implemented | React paging and scrolling unverified in a browser |
| Prompt composition and delivery | `PromptEditor.ts`, `outboxDriver.ts` | delivery delegates to the existing controller/outbox | Implemented — needs verification | delivery/outbox tests; no live authenticated prompt |
| Composer completions and history | `PromptEditor.ts`, `AutocompleteMenu.ts` | prompt history, file/model/extension completion, keyboard selection | Partially implemented | completion/history tests; React interaction unverified |
| Attachments and mobile input | `PromptEditor.ts` capture/draft/attachment helpers | file selection, paste/drop, capture, removal | Partially implemented | no mobile browser verification |
| Model, provider, thinking selection | `ModelPicker.ts`, composer controls | selects over `sessionsApi` | Implemented — needs verification | model picker/controller tests; React UI unverified |
| Settings shell and General | `SettingsDialog.ts`, `SettingsGeneralPanel.ts` | `ReactSettingsDialog.tsx`; partial-field saves merge against the latest persisted config through a serialized write queue shared with plugin toggles | Implemented — needs verification | `ReactSettingsDialog.test.ts`, `configWriteQueue.test.ts`; a desktop and 393x850 pass showed all eight pages, Escape close, focus return; settings writes not exercised |
| Appearance | `SettingsAppearancePanel.ts`, theme services | native theme choice, stored preference, follow-system, pairing through the same theme module | Partially implemented | page render checked; contributed-theme list and live reload not exercised |
| Notifications | `SettingsNotificationsPanel.ts`, `notifications/ntfy.ts`, `notifications/ntfyForm.ts` | the React page edits the whole ntfy block and a test delivery; the rules live in `notifications/ntfyForm.ts`, shared with the Lit page, so the secret-handling rules cannot drift. A test press is offered only when the browser granted permission; a denied one is named as blocked; while the stored block is unknown the form is not rendered | Implemented — needs verification | `NotificationsSettingsPanel.test.ts` (14), `notifications/ntfyForm.test.ts` (21); no live ntfy delivery |
| Workspace: Git | Git plugin browser UI and the Git backend contract | scoped status, staged/unstaged diffs, per-file and bulk stage/unstage, confirmed discard, commit, local branch switch, fetch/pull/push, remote counts | Partially implemented | backend fixture tests and React presentation tests pass; live and cross-scope mutations unverified. **Backend gaps: no branch-create, remote-list, or upstream-configuration operation; Git diff paths are not passed with literal-pathspec mode, so a filename containing pathspec magic can resolve differently — a coordinated backend fix is required.** |
| Workspace: files and editor | files plugin, file services, CodeMirror viewer | file tree, search, create/upload/read/edit/save/delete, multi-file editor | Partially implemented | CodeMirror and file backend tests; browser workflows unverified |
| Workspace: terminal | terminal plugin and services | `ReactTerminalPanel.tsx` | Implemented — needs verification | plugin-UI tests target the legacy surface; the React terminal is unverified |
| Status, notifications, errors | `StatusBar.ts`, notification dispatcher | React status footer (machine label, session metrics, tokens/context/cost/branch, activity) | Partially implemented | only API-backed facts are shown; announcements unverified |
| Lit UI and custom elements | `src/client/src/main.ts`, `components/PiWebApp.ts`, component trees | `react-main.tsx` mounts React from `index.html` | Not implemented | remove the inactive Lit UI only after behavior and plugin replacement |
| Bundled plugin browser UI | `pi-web-plugins/*/browser` | React covers selected surfaces (git, files, editor, terminal) | Not implemented | plugin tests stay Lit-oriented and are not React parity evidence |
| Dependencies, tests, assets | `package.json`, Lit harness tests, templates | React build proves neither removal nor parity | Not implemented | keep the shared contract tests |

One stack lesson belongs to the product, not the test: `scripts/stack-8505.sh` reads
`PI_WEB_8505_DATA_DIR`, `PI_WEB_8505_AGENT_DIR` and `PI_WEB_8505_CONFIG` every time it comes up, and
its default data dir is `~/.pi-web-8505`. A driver run that restsacks without re-exporting them lands
on a *different* project store, and the fixture project disappears — the page is right to show no
project scope. A browser pass therefore restacks with the same three variables the fixtures were seeded
with, and the driver's first records are the preconditions: the fixture project is registered, it is
trusted, and the package and MCP fixtures are readable in both scopes.

## Audit checkpoint (2026-08-22)

Historical reference point for the ledger rows above.

- Branch `feat/react-workspace-ui-from-main`. Startup: `src/client/index.html` loads the React entry;
  `src/client/src/main.ts` still imports the Lit app but is not the HTML entry. Development has
  `dev:react` / `dev:react:client`, production has `build:react`.
- The React app is API/controller-backed; parity was incomplete at audit: settings opened from the
  navigation gear in a responsive modal, MCP Servers and Skills were close to placeholders, and plugin
  contributed UI was absent.
- Lit inventory at audit: 130 custom-element/LitElement registration matches, 245 files under the
  legacy component tree (147 test files).
- No authenticated provider prompt/stream, stop-generation, complete plugin contribution integration,
  project/session CRUD, or full desktop/mobile workspace workflows were verified at audit. The
  `PluginSurface` adapter and the React registry bootstrap existed; plugin contributions were not wired
  through the app.

## The Updates module removed (2026-08-22)

The owner asked for the built-in update functionality to be removed completely: it interrupted a
browser QA session with a dialog that opened by itself. Nothing in the application asks a package
registry for a newer PI WEB, announces one, or runs an install. The trigger was deleted, not hidden, so
the popup cannot return after a refresh, a restart, a project switch, or a machine switch.

- Gone: `pi-web-plugins/updates/`, its manifest entry, `components/UpdatesView.ts`,
  `features/updates/updatesState.ts`, `features/updates/gitBranchPrompt.ts`, the `piWebUpdates` API
  surface, the `updates-changed` event and wire, the `pi-web-updates-state` storage keys, the General
  panel's Updates card, the `/api/updates*` routes, the self-update and fleet-update routes, the
  `updateCommand` config key, `PI_WEB_UPDATE_COMMAND`, `deploymentUpdateCommand.ts`, the Windows
  restart-and-update launcher, the version strip and badge.
- `src/server/web/updates/*` became `src/server/web/service/*` (`restartRoutes.ts`, `fleetRoutes.ts`,
  `detachedCommand.ts`): restarting an installed service is a real operational need that predates the
  update feature. `/api/machines/fleet/restart` is restart-only, `FLEET_MACHINE_SUMMARY_SCHEMA_VERSION`
  is `4`, `FLEET_MACHINE_CAPABILITIES` is `["projects", "sessions", "machines"]`, and a machine row
  offers a restart only when that machine's own status offers it.
- Kept on purpose: `piWebInfo.restart`, the git repository/trust checks, `ProjectTrustChangedEvent`,
  `ProjectCreateResponse.trustWarning`, Git, and **Pi package management in Settings → Pi Packages**.
- `docs/design/pi-web-updates-plugin.md` stays as the record of how the module worked, marked retired
  in `docs/design/README.md`.

## Plugin host in React: the measured prerequisites (2026-11-21)

What exists, measured on this branch:

- The registry boots in React: `react/usePluginRegistry.ts` builds a `PluginRegistry` per machine
  (`core` plus the manifest at `pi-web-plugins/manifest.json`, or the remote machine's manifest),
  isolates a plugin that fails to register into `failures`, owns the dialog queue
  (`showDialog`/`closeDialog` → `ReactPluginDialogLayer`), and exposes `refresh()`.
- `react/PluginSurface.tsx` renders one `TemplateResult` into a React-owned element, clears it on
  unmount, and names the plugin when the render throws. The catch that works is around *producing* the
  template, exported as `pluginSurfaceResult`.

What is missing, measured: the React app calls **none** of the registry's contribution reads —
`getActions`, `getReservedAction`, `getComposerContributions`, `getActivityNotes`, `getListLabels`,
`getListActions`, `getListSections`, `getNavSections`, `getSettingsSections`, `findMessageRenderer`,
`findToolRenderer`, `getMessageActions`, `findCodeFenceRenderer`, `getWorkspacePanels`,
`getGlobalPanels`, `getActiveGlobalPanels`, `getThemes`, `getThemePairs`, `getWorkspaceLabelItems`
(`plugins/registry.ts:210-724`). Every one of them is machine-filtered by `isContributionActive`, so a
React host reads them with the selected machine and never with the panel's own idea of scope.

The dependency that decides the order, measured: a contribution's `render` takes
`PluginRuntimeContext` (`plugins/types.ts`), a surface of app state, the prompt editor, and about thirty
host actions (`addProject`, `createProject`, `createMachine`, `projectDirectories`, `projectTrust`,
`selectMainView`, `selectWorkspaceTool`, `openTerminal`, `refreshFiles`, `refreshWorkspacePanels`,
`startSession`, `archiveSession`, `stopActiveWork`, `openThemePicker`, `openModelPicker`, …). The React
app has no `AppState` and no prompt-editor host object, so **every family that renders with a context
needs that context built first**. That is the milestone, and it is why a rendered plugin dialog is not
plugin integration.

The families the bundled plugins actually declare, measured from each plugin's entry file: `files` →
`workspacePanels`; `goal` → `globalPanels`, `listLabels`, `toolRenderers`, `workspacePanels`; `info` →
`actions`, `workspacePanels`; `mermaid` → `codeFenceRenderers`; `terminal` → `globalPanels`,
`workspacePanels`. `git`, `machines` and `workspaces` have no `pi-web-plugin.ts` entry of their own.
No bundled plugin declares `settingsSections`, `themes`, `navSections`, `composer`,
`messageRenderers` or `activityNotes` — so a React host for a settings section has no first-party
contributor to prove itself against, and needs a fixture plugin in the browser pass to be evidenced at
all.

Consequence for the plan: the cheapest family to land first is `getThemes` (a theme list contribution,
no `PluginRuntimeContext` in its render path — `NATIVE_THEME_CHOICES` is where the React Appearance page
currently stops at the built-ins), then `codeFenceRenderers` (`mermaid`, one renderer, rendered inside
the transcript where the React app already has the message), then `workspacePanels`/`globalPanels`
after the runtime context exists. Wiring `settingsSections` first buys a contract test and no live
behavior.

## Phase 1: the five open findings, investigated (2026-11-21, second block)

Each was investigated against the implementation and against a live page, not against the old log.

1. **Appearance changes no tokens. Real defect. Fixed `f1f219ed`.** `theme.ts`'s `applyNativeTheme` is
   the app's one applier: it writes a theme's `--pi-*` tokens inline on `<html>`, sets `color-scheme`,
   and names the theme in `data-pi-web-theme`. `react/tokens.css` shipped an **independent** `--rw-*`
   palette of fixed literals that no theme ever wrote, so choosing Lightness repainted nothing. The
   palette is now a projection: each React colour names the theme token that carries its role,
   `color-mix` derives the window/header/strong-line separations from the theme's own text and border
   ramps (the way `theme.ts` derives its ladder stops), and every mapping keeps its previous literal as
   the fallback, so the pre-paint frame and a token-sparse theme answer with the old look. Live: computed
   `--rw-bg` is `#141218` under Material Dark and `#fdf7ff` under Material Light. `react/tokens.test.ts`
   (4 tests) pins that every React colour names a `--pi-*` token, that the tokens consulted are ones the
   applier paints, and that **all four native themes answer every token the sheet reads**. The existing
   `index.html` first-paint script already paints the stored `--pi-*` in the first frame, so a light user
   no longer sees a dark frame - no change to `index.html`.
2. **Settings renders no content after reload. Not a defect.** A clean probe (write a server behind the
   page's back → click the page's Reload) shows the new row **1 second** later with no loader, and every
   Settings endpoint answers in ~10 ms (`pi-packages`, `pi-plugins`, `pi-skills`, `machines`, `config`).
   The old failure came from the leg clicking Reload while a sweep read was in flight; the leg now waits
   for the loader to clear.
3. **MCP removal never reaches confirmation. Not a defect.** Removal is a two-press control
   (`SettingsConfirmAction`, `McpSettingsPanel.tsx:163-168`) whose confirm label is "Remove from this
   file" and whose question names the target file; the leg's needle was the old Lit-era word
   "disk-only". The MCP leg's own removal checks (confirm step, `mcp.json` write, the other server
   surviving) pass against the live page.
4. **Close unverified. Testability gap, fixed `f0892930`.** The close button carried only an accessible
   name, so no browser handle existed; it now carries `data-test-id="settings-close"`, pinned by
   `ReactSettingsDialog.test.ts` to the same node the accessible name points at. Live: `dialog.open`
   becomes `false` on that click, and reopening shows a loaded page.
5. **Skills, MCP, Packages, mobile unverified.** The pass with the corrected driver is the run recorded
   below. Two real defects surfaced on Packages while investigating it:
   - **A removal that found nothing said it removed. Real defect. Fixed `dd987bb9`.** pi answers
     `remove` with `removed`, and `piPackageRemoveMessage` ignored it: the page said
     "Removed ../pkg/pi-demo-extension (Global)" while `settings.json` and the list kept the entry
     (a package recorded in pi's plain string form is not the entry its manager carries). The refusal
     now names the source and the scope and drops the reload sentence; a response without the flag keeps
     the old wording. Five tests.
   - **Update on a path-sourced package.** The control is enabled for a package pi cannot update, and pi
     answers "No matching package found for ../pkg/pi-demo-extension", which the page shows as an error.
     Enabling/disabling that control is product semantics, so nothing was changed: **maintainers should
     decide** whether a path source offers Update at all. The leg now accepts pi's answer (success or
     that refusal) and records which it saw.

6. **The stuck "Loading settings…" flag. Real defect. Fixed `8a423d92`.** This is what made the Skills,
   MCP and reload legs time out. A probe of the toggle flow showed the write path was right (the row
   flipped within a second, the API answered `enabled=false`, `config.json` recorded
   `skills.disabled: [{id,name}]`, the sentence named the scope) and the page sat at
   **"Loading settings…"** for as long as the page was open. Root cause: `refreshSettingsList` opened a
   ledger read with the **whole-scope expectation** (five resources), settled the one list it asked for,
   and superseded the read that had answered the other four — so `pending` could never reach zero and
   `loading: settled.pending > 0` stayed true, for that page and every page that inherits the flag. A
   leg that clicked Reload after any earlier write inherited the stuck flag, which is why the reload
   checks failed in the sweep and passed in a clean probe.
   `beginSettingsRead` now takes what a read expects (default: the whole set) and a write's refresh asks
   for its one resource. Proven by reverting the call: `loading` stays `true` on the same fixture, and
   clears with the fix; `settingsScope.test.ts` covers a one-resource read draining on its answer while a
   whole-scope read still needs five.

 **Harness artifacts, fixed in `/tmp/piweb-br/cdp22.mjs`** (each was a wrong expectation, not an app
bug): the theme probe read `data-theme` (the app writes `data-pi-web-theme`) and inline `--rw-bg` (the
palette is on the stylesheet); the close check asserted a detached content node instead of
`dialog.open`; the churn leg expected a `local` project while the machine was `lab` and sampled rows
before they settled; the mobile control-height rule measured `<label>` text (a 15px label, with the
selects at 44px) instead of controls; the mobile install selector used a test id the app never had (the
input is `[aria-label="Package source"]`); the Plugins needles demanded an empty-state string on a page
that lists the five bundled plugins; `pageApi` truncated bodies at 400 characters and then parsed them,
which killed a run in preflight.


### The Settings mutations pass: what is green, and the one chain that is not

Runs: drivers `/tmp/piweb-br/cdp31.mjs` / `cdp33.mjs`, stack `scripts/stack-8505.sh` (port 8505,
disposable profile, network-isolated agent dir), fixtures `/tmp/piweb-br/fixtures.sh` (the agent's
`settings.json` starts with `packages: []` so the install leg installs something through the machine's
own installer), Chrome 157 headless, DevTools port 9401.

**MCP Servers, desktop 1440 - the bound is live.** The connection test answers inside the page's bound
(`MCP probe completed.`), the busy line clears, and the controls are pressable after it: the
`the connection test ends inside the page's bound` and
`test connection answers, or gives up truthfully` checks pass in `cdp29`/`cdp30`. The earlier sweep
failures (`Connection tested`, `Connection failed`, `test connection answers`) are gone. The rows, the
two-press removal wording, the secret-name visibility, and the scope-file naming pass on both viewports.

**Skills, desktop - the scope read-back is honest.** The leg now reads each toggled skill back from the
scope that row belongs to: a project-scope skill is checked against `api/machines/local/pi-skills?projectId=<the
project the page selected>`, a global skill against the global list. The `skill missing: 200
name=project-release-notes` line, which was the harness querying the global list for a project skill, is
gone; the skills leg passes in `cdp27` and later runs.

**Pi Packages, desktop and mobile - removal removes.** `29694ec1` made `DefaultPiPackageService.remove`
drop the recorded entry when pi's manager declines, after the live page proved the asymmetry: a package
installed from a path is recorded as the relative path, `manager.removeAndPersist` resolves the source it
is given and reports nothing removed, and the settings file went on naming the package. The 22-test
service suite covers decline-and-drop, the object form, the manager succeeding alone, and the honest
no-op. The packages leg's other 41 checks pass (install validation refused before the network, the
refusal naming what to type, enable/disable written through pi's settings file, update one and all,
`/reload`, the row surviving a reload).

**Mobile 393x850: 121 checks, 5 failures, all five in the packages removal chain** (the same refusal the
server fix addresses) - layout, navigation, control sizes, the MCP form, the install field, the skills
card, machines and theme all pass (`/tmp/cdp32-mobile.log`, `sed 's/\x1b\[[0-9;]*m//g' | grep "^x |"`).

**Verify gate at the end of this pass:** `pnpm run verify` exit 0 - 697 test files, 6155 passed,
5 skipped, 0 failed (`/tmp/verify33.log`, `/tmp/final33-status.txt`).

**Open, with its mechanism recorded: the MCP write chain in the sweep.** The add-a-server step submits
and the write never lands: the server's file keeps only the fixture entry, the API list for `secret-probe`
comes back `{}`, and the removal checks that follow have nothing to remove. The probe built for this
(`/tmp/piweb-br/cdp33.mjs`, checks `the add form's submit unlocks after the previous mutation` and
`the submit control is enabled when the add form is submitted`) says the form is open, its submit control
is disabled while the previous mutation runs and **unlocks** within 30 seconds, and the click is accepted
- and the form's submit button reads **`Save`**, not `Add`, at that moment. So the step that should add a
new server is submitting the **edit** form left by the previous step, and pi writes the server that form
describes. The page's lock behaviour is the designed one (locked while a mutation runs, released by the
20-second bound, honest notice), and a single isolated add on a fresh page is not what this run
exercised. Next action: make the leg open the add form on a settled panel and assert the form's mode from
its heading and submit label before filling it, then re-run; if the app's add form really can be reached
in the edit state, that is a frontend defect to fix in `McpSettingsPanel`'s `openAdd`/`openEdit`
transitions, and the check will name it.

### Pi Packages: the project scope is not carried by the API (measured gap, not fixed)

The page lists rows the machine reports for **both** scopes (`scope: Global` and `scope: Project`, with
the project's file named on the row), and it offers a project row's removal. Nothing in the contract can
name the project the page is showing: `piPackagesApi` (`clients.ts:246-258`) sends `{source, scope}` and
no project - `packages()`, `install`, `remove`, `update` and `setEnabled` all take only a machine - and
`registerPiPackageRoutes` (`piPackageRoutes.ts:12-45`) reads `source`/`scope`/`enabled` from the body and
`projectId` from nowhere. `DefaultPiPackageService.remove` turns `scope: "project"` into
`manager.removeAndPersist(source, { local: true })` (`piPackageService.ts:110-118`), so the project the
write lands in is whatever the machine's active profile points at, not the project the reader selected.
The MCP and Skills routes solved this long ago: they take a `projectId` and resolve it through
`settingsProjectResolver` on the machine that owns the project store.

The design for the fix is the MCP shape, not a new one: add `projectId` to the packages requests, resolve
it server-side to the project's settings file, refuse a project-scope write when no project is named, and
have the page send its own `settingsProjectId` on every package operation. **Not implemented** - the
browser pass this session verifies the global scope, which the contract can express.


## Phase 5 status: browser evidence and what is still open

Runs: `/tmp/piweb-br/cdp24.mjs` (driver), stack `scripts/stack-8505.sh` on 8505, fixtures
`/tmp/piweb-br/fixtures6.sh`. Logs `/tmp/cdp24-mobile.log`, `/tmp/cdp26-desktop.log`;
results `results20.json`; screenshots `/tmp/piweb-br/shots20/`.

**Verified live, desktop 1440 and mobile 393x850:**
- All eight Settings sections open, settle, render their own content; the titlebar names the machine.
- Appearance: choosing Material Dark / Material Light changes the painted palette (`--rw-bg` `#141218`
  vs `#fdf7ff`), the theme attribute, `color-scheme`, and the stored/painted keys; the theme survives a
  section change and a reload paints it in the first frame.
- Close: `[data-test-id="settings-close"]` closes the dialog (`dialog.open === false`) and reopening
  shows a loaded page, not a loader.
- Reload: the page's Reload picks up a server written behind its back within one second, loader clears.
- Skills (global and project): the toggle flips in one second, the machine's `config.json` records
  `skills.disabled: [{id,name}]` for a global write, the project's rows survive a global write, and the
  page's own sentence names the scope.
- MCP rows: transport/command, the secret's **name** with its value hidden (`secrets: FIXTURE_TOKEN —
  values hidden`), the file the write goes to, the global/project scope split, the project file named in
  the add form, and the two-press removal with its target file named.
- Machines: list, add form, machine switch, the new machine's pages settle.
- Mobile 393x850 (154 checks): no overflow, no horizontal scroll, nav visible, no control under 28px,
  card action rows and fields at least 44px, the MCP add form fits and keeps its fields, the install
  input is reachable, the skill card adapts.

**Open, with the mechanism established (not verified, not fixed):**
- **A test-connection request that does not settle leaves the MCP panel busy and locked.** In the sweep,
  after the test-connection click the panel answered nothing, the add form never opened
  (`timeout waiting for the add form`), and the list read answered empty. The panel's own busy contract is
  "package/MCP controls are disabled while it runs"; the client has no timeout or cancel around the
  mutation, so a server that hangs at handshake keeps the page locked with no stated deadline. The server
  route answers correctly when the entry exists (`404 No MCP server named "fixture" is configured
  globally` for a fixture the sweep had already removed). **Maintainers should decide** the timeout and
  the wording; the fix is a bounded request plus an honest "still trying / gave up" state, not a quieter
  busy label.
- **Packages removal of a pi-managed entry.** The live page produced exactly the new refusal
  ("Nothing was removed: ../pkg/pi-demo-extension is not configured in Global settings…") for a package
  recorded in pi's plain string form, which is the correct answer. The leg's expectation that the file
  drops the entry is only reachable with an entry pi's manager carries; the fixture preflight now removes
  then installs through the API to get that form, and the accepted-removal path (file write, list update,
  empty state) is **not yet browser-verified**.
- **Harness artifact, still to correct:** the skills read-back queries the machine's global list for a
  project-scope skill (`skill missing: 200 name=project-release-notes`); it must read the scope the row
  belongs to. Until then, the project-skill read-back line is not evidence.

**Not started: Phase 4, plugin React integration.** The theme projection is the mechanism a contributed
theme needs (a plugin theme's own `--pi-*` ladder now drives the React surface), and the measured
prerequisites for the other families are in **Plugin host in React: the measured prerequisites**.


## Browser pass of 2026-11-21 (first block): what was evidenced, and what was not

Stack: `scripts/stack-8505.sh` on port 8505 with its own data/config/sessiond, fixtures at
`/tmp/piweb-br` (local machine trusted, one project, global + project MCP servers, global + project
skills, a file-based Pi package source, auth state). Driver `/tmp/piweb-br/cdp20.mjs` (raw Chrome
DevTools Protocol; Chrome 157 headless). Screenshots `/tmp/piweb-br/shots20/`.

**Passed, at 1440x900:** all eight Settings sections open, settle and render their own content —
General, Appearance, Notifications, Pi Packages, MCP Servers, Pi Web Plugins, Machines, Skills (8/8) —
with no stuck loader and the titlebar naming the machine. The fixture preconditions held: the package
list reached the fixture package, the MCP page showed the global and project scopes, the Skills page
showed the global and project rows, and the global skill toggled. The machine list, the add-machine
form, a machine switch and the new machine's pages behaved.

**Failed and not triaged** — open findings, with what each check asserted:

- **Theme control (Appearance).** Choosing the two theme options left `data-theme` empty on
  `documentElement` and the `--rw-*` tokens identical (`--rw-bg=#191a20` in both), so no surface change
  was seen. The React page calls `applyNativeThemeById` (`react/ReactSettingsDialog.tsx:139-146`), the
  same applier the Lit app uses (`components/PiWebApp.ts:6056`). Not root-caused: where the applier
  paints versus where the probe read, and whether the option ids reach the applier, both need a targeted
  probe. Treated as a real Settings-parity finding until disproved.
- **Opening Settings after a page reload** returned no content for the requested section inside the
  probe's window (`Reload retrieves fresh data | MCP Servers`; General in the earlier pass).
- **MCP removal.** The confirmation step, the `mcp.json` write and the post-removal file check failed
  (`removal asks for confirmation | disk-only`, and the file still named the server). First thing to
  check: whether the confirm step is a native `confirm()`, which DOM clicks cannot drive.
- **The close control** stayed mounted under the driver's `[data-test-id="settings-close"]`; the real
  control is per-section (`#general-close`), so this is a harness artifact — and it means **close is not
  browser-verified**.
- **Skills, MCP and Packages legs did not complete**: the pass was killed at 11m in the mobile sweep,
  after the failures above. `dist/` predates `ee66cc6c`, so the scoped-write fix has **no browser
  evidence** — the DOM unit test is the only evidence it has.
- **Harness artifacts, fixed:** the topbar precondition (`.rw-header-actions`; `.rw-sidebar-toggle` is
  0-wide with the sidebar open), the packages trust needle (the page says "Install only packages you
  trust"; "trusted code" is add-project's wording), and the churn leg expecting a `local` project while
  the machine was `lab`.

`/tmp/piweb-br/probe-theme.mjs` is the theme probe; it needs a page target already on the `8505` origin,
so launch Chrome at the app URL. `/tmp/piweb-br/verify-fix.sh` rebuilds, restacks, reseeds and re-runs
the Skills and MCP legs — the only way to mark Phase 5 verified.

## Milestone plan

> The order below predates the 2026-11-21 measurements. The measured prerequisites and the recommended
> first families (`getThemes`, then `mermaid`'s `codeFenceRenderers`, panels only after the
> `PluginRuntimeContext` exists) are in **Plugin host in React: the measured prerequisites**; read that
> first, and the open browser findings above come before any of this.

1. **Plugin host in React** (highest priority; it blocks the Lit removal).
   - Boot the plugin runtime in the React app: registry, machine-scoped plugins, lifecycle
     (`src/client/src/plugins/registry.ts`, `pluginContainment.ts`, `pluginHostUi.ts`).
   - `PluginSurface` renders a `TemplateResult` into a container React owns, re-renders on host context
     change, renders `nothing` on unmount, and reports a thrown renderer as an isolated failure with
     the plugin's name. Measured: lit-html swallows an exception raised inside a binding's own function
     and reports nothing, so the isolation that works is the catch around *producing* the template
     (`pluginSurfaceResult`) — that is where a host must catch.
   - Wire the contribution kinds in this order, each with tests against a real registry and a real
     bundled plugin: workspace panels → global panels → workspace labels → nav sections → code fence
     and tool renderers → list labels → settings sections → composer contributions. Every read is
     filtered by `isContributionActive(pluginId, machineId, selectedMachineId, sourcePluginId)`, so the
     machine scope is the registry's, not the panel's.
   - Then migrate bundled plugins to a React contribution shape, one plugin per commit, starting with
     `mermaid` (one code fence renderer) and ending with `terminal`.
2. **Composer parity** (drafts, prompt history, attachments, completions, slash commands, model and
   provider controls, outbox).
3. **Conversation parity** (message types, streaming, pagination, scroll anchoring, tool states,
   status, notifications, errors).
4. **Lit removal** last: entry `src/client/src/main.ts`, custom elements, decorators, templates,
   Lit-only styles, Lit harness tests once React equivalents exist, the `lit` dependency, the lockfile.
   `lit/html` is expected to remain for the plugin host.

## React Settings modules: packages, MCP servers, skills (2026-07-06)

What this pass shipped, in one place:

- Three React pages — `react/settings/PiPackagesSettingsPanel.tsx`, `SkillsSettingsPanel.tsx`, and the
  reworked `react/McpSettingsPanel.tsx` — over the existing routes
  (`/api/machines/<id>/pi-packages|pi-skills|pi-mcp`), with React owning the settings surface; no new Lit
  component and no new backend route.
- Pure state modules beside each panel (`piPackageSettingsState.ts`, `piSkillsSettingsState.ts`,
  `piMcpSettingsState.ts`, `settingsScope.ts`, `settingsNotices.ts`) carry the scope rules, the
  scope-tagged result notes, the mutation ledgers that keep one operation per row, and the
  machine / project / selection guards. `useReactWorkspaceData.ts` owns the loading, the scoped
  notifications and the machine switch.
- Shared primitives in `react/settings/SettingsSurface.tsx` (`SettingsSection`, `SettingsCard`,
  `SettingsField`, `SettingsEmpty`, `SettingsNotice`) plus one `settings-row` CSS contract; the MCP
  editor is an inline form, so nothing can leave the Settings surface.
- The MCP form gained a **description** field (`mcpForm.ts` seeds it from the file, trims it into the
  draft, keeps it off overrides) because the backend validates it and the Lit form never exposed it.
- The secret rule is preserved end to end: env and header values travel as `keep` / `clear` sentinels; a
  browser pass round-tripped a value written to the file and confirmed the UI shows `••••••` with no
  `global-secret-value` anywhere in the document.
- A 44px coarse-pointer floor in `react/workspace.css` for form controls, cards, chips, links, selects
  and the toggle (a real switch: 34×18px track, knob, focus ring) inside the ≤640px block.
- Not-loaded states are rendered as unknown, not as empty: `piSkillNotLoadedNote()`,
  `piMcpNotLoadedNote()`, `piPackageNotLoadedNote()`, `piPackageGlobalEmptyStateNote()`.

### Automated verification (2026-07-06, Node 26.3.0)

| Check | Result |
| --- | --- |
| `pnpm run verify` | exit 1. Typecheck clean; **lint 0 errors / 267 warnings**; **knip exit 2 (pre-existing)**; vitest **6117 passed, 8 failed, 5 skipped** over 6141 files |
| The 8 failures at clean `HEAD` | The same 6 files / 8 tests fail in a disposable worktree at `HEAD` (`/tmp/baseline-run.log`, exit 1): `src/buildContents.test.ts`, `src/server/shared/piWebStatus.test.ts` (2), `src/server/web/piWebPluginService.test.ts` (2), `src/server/shared/plugins/packageInstalledPlugin.test.ts`, `src/server/web/service/fleetRoutes.test.ts`, `src/client/src/components/settings/SettingsGeneralPanel.test.ts`. They are the documented Updates-removal test debt, so the full suite does **not** pass — and not because of these three modules. |
| Lint gate against `HEAD` | `HEAD`: 145 errors / 272 warnings. This branch: **0 errors / 267 warnings** over 2884 files. Families fixed on this branch: `react-hooks/refs`, `react-x/no-restore-stable-props` (97), `react-x/jsx-no-constructed-context-values` (21), `react-x/no-use-state` (11), `react-hooks/preserve-memo-validation` (10), `react-x/no-array-index-key` (7), `react-hooks/immutability`, `react-refresh/only-export-components`, `@typescript-eslint/no-base-to-string`, `@typescript-eslint/no-unsafe-*` (2). |
| Typecheck tests (`vitest run --typecheck src/shared src/server/shared/resources`) | 5 files / 2 errors, **identical at clean `HEAD`** (`/tmp/v-tc-clean.log`), both in `src/server/sessiond.test.ts` — pre-existing. |
| Production build (`pnpm run build`) | exit 0; `dist/client` 393 files, `dist/public` 150 files. |
| Settings CSS guards | `react/settings/settingsStyles.test.ts` (4: every emitted class is defined in the sheet; the 44px floor; the 640px stacking; one settings block in one stylesheet), `src/styles/responsive.test.ts` (28), `src/components/SettingsDialog.test.ts` 37/37 (the Lit parity guard). |
| Module suites | 99 React settings tests (37 panel + 38 state-rule + 24 data-hook), plus `src/components/SettingsDialog.test.ts` 54 for the Lit panels. `src/server/sessiond.test.ts` 13/13 after the stub gained the two new settings methods. |

### Browser verification (2026-07-06)

The driver is a raw CDP harness (`/tmp/piweb-br/cdp5.mjs`) driving headless Chrome against the isolated
stack (`scripts/stack-8505.sh` with `PI_CODING_AGENT_DIR=/tmp/piweb-br/agent`, fixture project
`/private/tmp/piweb-br/project`, global + project MCP fixtures, a global skill, a project skill, one
installed package). Every check records its own detail into `/tmp/piweb-br/results5.json`; screenshots go
to `/tmp/piweb-br/shots5/`; the transcript is `/tmp/piweb-br/driver8.log`. The stack is torn down after
each run (`scripts/stack-8505.sh down`) and fixture state is re-seeded by `/tmp/piweb-br/fixtures6.sh`.

Two fixture rules are product behavior, not test trivia: a package source resolves against the **server's
working directory**, so fixtures install through the install API with an absolute path; and project scope
is gated by PI WEB's **workspace trust** decision, so fixtures trust the project through
`PUT /api/machines/local/projects/<id>/workspaces/<id>/trust`. An untrusted project answers "This project
is not trusted, so its MCP servers are not read, changed, or connected" — the honest answer, not a defect.

Run 8 (the 44px floor, the shared field markup, the not-loaded notes): _to be recorded from
`/tmp/piweb-br/driver8.log` when the run completes_.

## What was lost, and the rule that follows

A larger React tree existed only in the working tree and is gone. On 2026-11-20, recovering this
worktree from a half-finished upstream sync, `git checkout 005ee1c3` followed by `git reset --hard HEAD`
destroyed uncommitted files: `src/client/src/react/settings/**` (a ~2,500-line settings dialog,
settings runtime, search index and eight panel files), `react/workspace/**` (transcript panel,
session/stream hooks, stream reducer, code editor, file, git, goal, terminal panels), `react/state/**`,
`react/api/**`, `react-main.tsx` and `workspace.css`. None of it was ever committed: not in a commit,
not in `origin`, not in `git stash`, not in a loose object, not in the worktree reflog, and not in VS
Code's Timeline. The `~/.codex/sessions/2026-11-20` rollouts are the only remaining place with fragments.

The rule: this worktree is written to by several agents and its tree moves. Commit before touching git
history, and never `git reset --hard` a tree that holds uncommitted work — `git stash push
--include-untracked` costs nothing and is recoverable. Re-measure the tree at the start of every
session; do not trust a summary over `git log` and `ls`.

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

## Exact next action

**Checkpoint, 2026-11-21, in flight.** Phase 1 (the merge) is landed and pushed: `7cfe7ddb` (the
settings scope ledger) → `22789815` (the merge) → `59f4d49c` (the eight red tests) → `6747c436` (the
incoming branch's typecheck break) → `4aeb71d4` (the incoming branch's lint errors), pushed to
`origin/feat/react-workspace-ui-from-main`. `docs/react-migration/progress.md` is the only migration
document; `feature-parity.md` is deleted and referenced from here.

The browser pass runs as `/tmp/piweb-br/cdp20.mjs` (built from `cdp18.mjs`, plus the sections, reload,
lifecycle, theme, machines and sidebar legs and a mobile sweep of all eight sections) against the 8505
stack (`bash /tmp/piweb-br/stack.sh`, fixtures `bash /tmp/piweb-br/fixtures6.sh`); results land in
`/tmp/piweb-br/results20.json` and `/tmp/piweb-br/shots20/`.

1. Run the browser pass for the three Settings modules and the eight sections on the isolated stack
   (`scripts/stack-8505.sh up`, its own data dir, port 8505): desktop 1440px and mobile 393x850, real
   session daemon, exercising install/update/update-all/enable/disable/remove, MCP add/edit/test/remove
   in both scopes, Skills toggles in both scopes, and the empty/failure/loading states. Record the
   result in [Browser and automated verification](#browser-and-automated-verification-2026-11-21).
2. Run `pnpm run verify` and `pnpm run build` and record the numbers here.
3. Then the plugin host in React, per the milestone plan — it is the largest unstarted feature and it
   blocks the Lit removal. The contribution families are the ones named in `plugin-api-react.md` and
   `src/client/src/plugins/types.ts`, wired in that order.

## Packages project scope, the React contract, and the theme surface — 2026-11-21

Three units landed on top of `055cb73c`.

**`53806383` Install Pi packages in the project's own settings.** The package surface had spoken only
to Pi's global settings. It now carries a scope on every call: a request naming a project goes through
the same `SettingsProjectResolver` the MCP and Skills surfaces use, an untrusted project is not read,
installed into, or changed, and the list response names the scope it read (`globalConfigPath`,
`projectConfigPath`, `projectTrusted`, `projectScopeRead`) so the panel says when a project's packages
were never read instead of showing global rows under a project heading. Install and remove pass Pi's
`{ local: true }` for the project scope, `setPackagesEnabledFilter` is written per scope, and update
availability is decided by the package's source kind (Pi's own npm / pinned / git / local grammar),
not by the scope it came from. Verified: `pnpm run verify` exit 0 — 697 files, 6155 passed, 5 skipped.

**`88cb46d3` Let plugins contribute React user interface.** Every family that draws something carries a
React spelling beside its template (`renderReact`, `iconReact`, `badgeReact`, `toolbarReact`,
`contentReact`), and `PluginActivationContext` hands plugins `reactUi`: the host's React components,
the dialog surface, markdown, breakpoints, clipboard and error wording, each named by a prop interface
in the contract. The React node types are declared structurally in `src/shared/pluginReactTypes.ts`
with no React import, because `typecheck:plugin-api` checks the contract against a world where React
does not exist. Members are additive and optional, so existing plugins keep the Lit path while a React
host renders React.

**`5f5aaf86` Paint the saved theme in the React workspace.** `useAppliedTheme` owns theme painting: the
stored preference is applied when the workspace opens (the React app used to apply a theme only when
Settings changed it, so a reload came back in the default palette), the Appearance page lists PI WEB's
four looks and the machine's contributed themes in one selector, an automatic preference resolves
against the theme pairs and keeps following the media query, and a stored id no plugin contributes is
reported with the current look kept. Tests: 21 across `reactThemeChoices`, the React Settings dialog and
the settings data hook.

## What the bundled plugins actually contribute

Measured from `pi-web-plugins/*/` (non-test sources), this is the list of React hosts the React app has
to grow before first-party Lit can go away:

| Family | Plugins |
| --- | --- |
| `workspacePanels` | files, git, goal, info, terminal |
| `globalPanels` | goal, terminal |
| `composer` | files |
| `toolRenderers` | goal |
| `listLabels` | goal |
| `workspaceLabels` | info |
| `codeFenceRenderers` | mermaid |
| `navSections` | workspaces |
| `actions` | files, git, info, machines, workspaces |
| `themes` | none bundled (hosted in React by `5f5aaf86`) |

The React workspace today draws hard-coded tabs (Git, Files, Terminal, Goals, Subagents, Background
Runs, Edited Files) with inline React panels; the same panels are contributed by bundled plugins in
Lit. Landing the React panel host therefore has to move the accepted React panel implementations into
the plugins that own them, not discard them — the accepted UI stays, the contribution becomes the
producer. That is a product-visible decision about who renders a tab, and it is the next milestone.

## Exact next action

1. React contribution hosts, in dependency order: the node seam (`PluginReactSurface` + boundary),
   `reactUi` components, `PluginRuntimeContext` built from React state with no stale closures, then
   settings sections → plugin dialogs (`contentReact`) → workspace/global panels → transcript renderers
   → composer → nav sections, list and workspace labels → actions.
2. Migrate one plugin per commit, smallest surface first: mermaid (code fence), info (workspace labels
   + panel), goal (tool renderer + list label + panels), machines (actions), workspaces (nav + actions),
   files, git, terminal (panels + composer).
3. Browser pass on the 8505 stack for the touched surfaces, desktop 1440px and 393x850, recording the
   commit, viewport, workflow, expectation and result.

## The React plugin runtime and host layer — 2026-11-21 (checkpoint)

Six units landed on top of `fad6b2ce`. All of them are on `feat/react-workspace-ui-from-main` and pushed
as a branch tip only if the push was run; `git log --oneline -8` is the authority.

| Commit | Unit |
| --- | --- |
| `937e4ac2` | Drop what the package scope pass left behind (the four unused imports that failed lint) |
| `01bf2b92` | Publish the workspace's React to plugins (`src/plugin-react.ts`, `src/plugin-react-hooks.ts`, `src/jsx-runtime.ts`) |
| `d990a2ba` | Render React plugin contributions in the workspace (`PluginReactSurface`, `pluginReactKit`, `pluginReactHostUi`, `pluginReactConfirm`) |

**Why the runtime module came first.** A plugin that imports React gets its own copy, and two copies in
one page fail quietly: a component from the second copy, rendered by the first, reaches for a dispatcher
that is not its own, and React answers "Invalid hook call" — reported against the plugin, diagnosed for
hours as a plugin bug. The workspace now publishes its React as it boots (`publishReactRuntimeForPlugins`
in `react-main.tsx`, before the first render), hands plugins a member table with React's own types, and
refuses a second publisher with the version it refused, which is the report that names the bundle that
brought its own React. Plugin builds compile JSX against `@gang-of-beads/pi-web/jsx-runtime`
(`tsconfig.plugins.json` and `scripts/build-plugins.mjs` both name it), so a plugin's source never names
`react` and its JSX is created by the reconciler that renders it.

**What the host layer draws today.** One contribution inside `PluginReactSurface` is bounded: a plugin
whose component throws, or that returns a Lit template, is named in place and the rest of the page keeps
working. The node is produced inside the boundary, because a contribution that returns something React
cannot draw is a throw, and a throw raised in the parent's render unmounts the page. `reactUi` is handed
to every plugin on the activation context: the host's React components (the buttons, cards, notices,
fields, output view, message field, expandable row the built-in panels use) plus the clipboard chain, the
failure wording, the breakpoint strings, sanitized markdown, and the app's confirm dialog. Plugin dialogs
are now a discriminated queue — a React dialog is drawn by the page's React, a Lit one by the
compatibility surface, in one stack with the same focus, Escape and back-gesture accounting — and a
plugin's `confirm` resolves through the app's own `ConfirmDialog`, settling false on any dismissal, so a
destructive action runs only on the key that confirms. Both layers were previously not mounted at all:
the React app registered plugin dialogs and never rendered them.

### Verification actually run

- `pnpm run verify` at the package-scope milestone (`53806383`): exit 0, 697 files, 6155 passed, 5 skipped.
- `pnpm run build:plugins` after the runtime commit: exit 0 — 8 browser entries bundled, 1 vendored
  library, 101 plugin TypeScript files built.
- Suites: `src/client/src/react` + `src/client/src/plugins` + `src/plugin-react.test.ts` — 47 files, 379
  tests passed. The new host layer adds 13 (surface draw, Lit-template report, thrown component, the
  activation context carrying `reactUi` and its absence on a Lit host, confirmation asks/waits/true-only-on-confirm/
  false-on-dismiss) and the runtime adds 6.
- `tsc --noEmit`, `eslint` on the changed `.ts` files and `pnpm run knip`: clean at `d990a2ba`.
- **Not run this session: the browser pass.** No desktop 1440px or 393x850 run was made against a real
  session daemon for the theme surface, the package scopes, the plugin dialogs, or the confirm dialog. The
  React plugin surfaces have unit evidence only. A full `pnpm run verify` and `pnpm run build` on the
  current HEAD were started as background tasks; record their numbers here when they land.

### What is still not hosted in React

`PluginReactSurface` can draw a React contribution, and the runtime makes it possible for a plugin to
write one. Nothing in the React app asks the registry for a contribution yet, so every family below is
still invisible in the React workspace, and the bundled plugins stay Lit for it:

1. **The runtime context.** `PluginRuntimeContext` has ~35 members (`state`, `prompt`, project/machine
   management, refresh, navigation). React needs a builder that reads live state at call time, not a
   snapshot, and the contract needs one honest change first: `openActionPalette` is required, and the
   React app has no palette by product decision. The fix is to make it optional and migrate the caller —
   resurrecting the palette is not.
2. **Settings sections** (`renderReact`) in the React Settings nav.
3. **Workspace and global panels.** The React workbench draws hard-coded tabs with inline React panels
   today; the accepted panel implementations have to move into the plugins that own them, so the tab strip
   becomes contribution-driven without a redesign.
4. **Transcript renderers** (`messageRenderers`, `toolRenderers`, `codeFenceRenderers`), **composer**
   contributions, **nav sections**, **list labels**, **workspace labels**, **message actions**,
   **activity notes**, and **actions**.
5. **The eight bundled plugins** migrate one per commit, smallest surface first: mermaid, info, goal,
   machines, workspaces, files, git, terminal.
6. **First-party Lit removal** after 1–5, then the browser pass on the 8505 stack at 1440px and 393x850.

### Exact next action

Build `createReactPluginRuntimeContext` (member-by-member from React app state, with a test per member
group), land the contract change that makes `openActionPalette` optional, then the settings-sections host
in `ReactSettingsDialog`, then the panel host with the tab strip. One plugin per commit after that, and
the browser pass before any Lit file is deleted.

## Addendum — the React plugin runtime lands, and two reds it exposed

Commits: `01bf2b92` (publish React), `d990a2ba` (React contribution surfaces),
`a3e38f32` (JSX compile source), `833223d5` (MCP form label), `3c0bcfd8` (packages across a
machine switch), `867b1364` (React subpaths and declarations).

### One React, published by the app

`src/client/src/react-main.tsx` publishes the app's React to `globalThis.__piWebReactRuntime`
before the first render, under a protocol (`src/client/src/react/pluginReactRuntime.ts`) that
refuses a second publisher and names the version it found. The published entry points are
`@gang-of-beads/pi-web/plugin-react` (host UI contract), `/plugin-react-hooks` (every stateful
hook, bound to that one runtime) and `/jsx-runtime` (the automatic JSX source). A plugin that
imports a bare `react` is refused by `scripts/build-plugins.mjs`, which compiles plugin JSX with
`jsxImportSource: "@gang-of-beads/pi-web"`, the same source `tsconfig.plugins.json` declares.
A probe plugin — hooks, a code-fence renderer, a settings section, a workspace panel with a
React toolbar and badge — compiled under the plugin config, bundled to 3.7 KB, imported no
external React, carried no `react-dom` and no React internals, and read the global the host
publishes. The probe was deleted and the shipped plugin output restored to the 8 entries.

### The React host layer

`PluginReactSurface` draws one contribution inside an error boundary, and takes the contribution
as `unknown`: the surface is the validation boundary, so a caller must not have to assert what
the host exists to check. A Lit `TemplateResult` handed to it is reported by kind, as are a
constructor, an array and a primitive. `pluginReactNode.tsx` is the only audited cast from the
structural `PluginReactNode` to React's `ReactNode`. `pluginReactKit.tsx` gives plugins the host's
own React components (button, toggle, section, card, empty, notice, field, output, message field,
expandable row, disclosure and close marks) — focus, labels, press feedback, screen-reader
notices and breakpoints stay the app's, not each plugin's. `pluginReactHostUi.tsx` assembles them
into `PluginActivationContext.reactUi`, with breakpoints, clipboard, markdown (the app's
sanitization), the authenticated query, error words, and `confirm`/`showDialog`. Plugin dialogs are
a discriminated queue: a React dialog is drawn by React, a Lit dialog by the compatibility
surface, and both share stacking and dismissal accounting. `confirm` resolves through the app's
`ConfirmDialog`; dismissal settles `false`, so a destructive plugin action runs only on the
confirming key.

### Two reds these commits exposed, and what they mean

**The registry's mirror had no React members.** `src/client/src/plugins/types.ts` mirrors the
public plugin API for the shapes the registry owns, and its copies of the contribution
interfaces had no `renderReact`, so a contribution registered through the registry had no React
spelling while a plugin compiling against the published declarations saw one. The React members
are now on both sides (`867b1364`). The mirror itself — the file's own comment says identical
shapes should be the public declarations, not a copy of them — should collapse into re-exports;
recorded as follow-up, because a mirrored contract drifts silently and this is the evidence.

**A package response was kept across a machine switch.** `3c0bcfd8` clears it: the rows carry
install, remove and update actions, and after a switch they acted on a machine no longer on
screen. The machine-switch test guarded that promise; it had gone red when the Pi-package API
moved to a request object, along with two stubs pinned to the old positional calls.

### Verification for this pass

Targeted: React plugin host 17 tests; React plugin runtime 6; `src/buildContents.test.ts` 6;
the Lit packages sections across a machine switch 11. `tsc --noEmit` clean. A full
`pnpm run verify` runs against this HEAD; its counts are recorded on the next entry.

### Browser evidence for this pass

Not run. The theme surface, the Pi-package scope selector, the React contribution surfaces, the
plugin dialogs and the plugin `confirm` queue have not been driven in a browser. The next commit
in this plan is the settings-section host, and the browser pass is scheduled with the plugin
migrations that make those surfaces visible; until it is run, these claims are unit-level only.

### Open follow-ups, in order

1. Build the React `PluginRuntimeContext` provider (the settings-section host, the panel hosts and
   the list hosts all need it), then mount each family: settings sections, workspace/global panel
   content, tool, message and code-fence renderers, composer, nav, list labels/actions/sections,
   workspace labels, message actions, activity notes, actions.
2. Migrate bundled plugins one per commit, smallest surface first: mermaid, info, goal, machines,
   workspaces, files, git, terminal.
3. Collapse the client registry's mirrored contribution interfaces into re-exports of the public
   plugin API.
4. Run the desktop 1440 / mobile 393x850 browser pass on the 8505 stack and record the matrix.
5. Record the full-suite counts for this HEAD.
