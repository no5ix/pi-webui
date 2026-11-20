# React migration feature parity

This is the migration ledger for the browser application. Status describes behavior in the React entry (`src/client/src/react-main.tsx`) against the legacy implementation, not whether files have been renamed. `Verified` requires a relevant automated or live interaction check. Verification claims are scoped to the named flows and do not imply full parity.

## Runtime and architecture

| Feature | Legacy implementation | Existing React implementation | Required behavior / dependencies | Status | Relevant tests and verification |
| --- | --- | --- | --- | --- | --- |
| Browser entry and startup | `src/client/src/main.ts`, `components/PiWebApp.ts`; `src/client/index.html` | `src/client/src/react-main.tsx`, `react/ReactWorkspaceApp.tsx` | React mounts as the browser UI and initializes prompt capture, theme, routing, and controllers without starting Lit UI | Partially implemented | `bootImportGraph.test.ts`; `pnpm run build:react` passes |
| Application state and scoped data | `appState.ts`, controllers, realtime and outbox modules | `react/useReactWorkspaceData.ts` wraps existing controllers, APIs, sockets, and outbox | Preserve server authority, retries, session reconciliation, and machine/project/workspace scope | Implemented — needs verification | Controller and API test suites exist; React live behavior not yet verified |
| Shared UI primitives | Lit `ModalSurface`, `ConfirmCard`, banners, notices, pickers | `react/ConfirmDialog.tsx`, Settings/image dialogs, session disclosure, and feature-local markup | React dialogs, confirmation, errors, notices/toasts, menus, popovers, tabs, forms, loading/empty/error states, focus and keyboard behavior | Partially implemented | `SessionActionsMenu.test.ts` covers dialog confirmation, cancel/Escape, focus restoration, and pending controls; broad primitive coverage remains incomplete |
| Theme and responsive shell | `index.html`, Lit shell elements, theme modules | `react/tokens.css`, `react/workspace.css`, `ReactWorkspaceApp.tsx` | Match approved workspace reference; responsive desktop/mobile layout and theme preferences | Partially implemented | Design token tests cover legacy surface; `docs/ui-design/Dark Mode Developer Workspace UI.png` inspected |

## Navigation, projects, sessions, and machines

| Feature | Legacy implementation | Existing React implementation | Required behavior / dependencies | Status | Relevant tests and verification |
| --- | --- | --- | --- | --- | --- |
| Project and session navigation | `PiWebApp.ts`, `AppNavigatePage.ts`, `SessionTreeNavigator.ts`, workspaces plugin browser UI | `ProjectTree.tsx`, `ReactWorkspaceApp.tsx`, `useReactWorkspaceData.ts` | Search, normal project/session selection, session creation, expand/collapse, loading and failure honesty | Implemented — needs verification | Legacy navigator/controller tests; React browser interactions not verified |
| Project lifecycle | `ProjectDialog.ts`, `ProjectRenameDialog.ts`, workspaces plugin browser UI, `ProjectController`, `InstantActionController` | Project selection and undoable close are in React; Add project uses the existing controller, machine-bound directory suggestions and trust read/write; folder tree/new-folder navigation, rename, and project trust menu remain absent | Create and open existing projects, folder browsing, rename, close, trust, errors, scope-safe selection | Implemented — needs verification | `ProjectTree.test.ts`, `AddProjectDialog.test.ts`, `projectController.test.ts`, workspaces `ProjectDialog` tests, `reactInstantActions.test.ts`; tests cover create/trust submission, pending-modal cancellation, and machine-switch trust persistence. Isolated 8505 browser created `/tmp/pi-webui-react-create-qa` through the React dialog at 393×850 and showed the new project selected; folder tree navigation and rename remain unverified |
| Session lifecycle | `PiWebApp.ts`, `SessionController`, session tree, `InstantActionController` and dialogs | Listing/selection/create; menu actions use `SessionController`; archive, restore, and confirmed archived deletion use `InstantActionController`, scoped optimistic projection, Undo/reverse, and read reconciliation | Rename, delete, archive/restore, pin, unread, recovery, cleanup, pending creation and empty-session semantics | Implemented — needs verification | `SessionActionsMenu.test.ts`, `reactInstantActions.test.ts` cover confirmation bound to its opening session/machine, disclosure keyboard/focus behavior, held deletion and Undo cancellation, confirmed board projection, and pending target scope; `sessionController.rename.test.ts` covers an interleaved realtime rename; live 8505 browser confirmed archive closes the menu and returns focus, then used Undo; the real daemon session stayed listed and unarchived afterward |
| Machine selection and management | machine plugin `MachineDialog.ts`, `SettingsDialog.ts`, machine/auth controllers | Selected machine scopes API calls; machine display/health in React sidebar | Settings-based selection, add/auth/access approval, rename/remove, health, reconnect and warnings | Partially implemented | Machine controller, access, and dialog tests; React parity not verified |
| Removed navigation features | `ActionPalette.ts`, `CommandPicker.ts`, `QuickSwitcher.ts`, shortcut handling | No React equivalents found in the current app surface | Intentionally remove global action palette, standalone command picker, quick session/machine switchers; retain composer commands and normal navigation | Intentionally removed | Legacy removal and shortcut contract checks remain |
| Built-in updates and self-update | `pi-web-plugins/updates` (page, offer dialog, background check, Pi package rows), `src/server/web/updates/*` (self-update, fleet update, release-check routes), the `/api/pi-web/updates/check` client, the status payload's `piPackages` block, `updateCommand` and `PI_WEB_UPDATE_COMMAND`, the version strip and its badge | Nothing: the plugin, its routes, its client, its config keys, its status block and every control are deleted, and the machine page keeps only restart | Remove the built-in update notification, dialog, banner, badge, background check and update UI; updating PI WEB is a package-manager step the operator runs on the machine, and Git, package management for pi resources and service restart stay | Intentionally removed | Repo-wide grep finds no `updates/check`, `checkForPiWebUpdates`, `PiWebUpdateCheckResponse`, `updateCommand`, `deploymentUpdateCommand`, `piPackageUpdateCheck` or version strip in first-party code; `pi-web-plugins/updates` is absent; `pnpm run verify` passes; the browser starts, switches project and machine and reloads with no update dialog, banner or badge |

## Conversation and composer

| Feature | Legacy implementation | Existing React implementation | Required behavior / dependencies | Status | Relevant tests and verification |
| --- | --- | --- | --- | --- | --- |
| Transcript messages and grouping | `ChatView.ts`, `ToolExecutionView.ts`, formatting helpers | `ConversationMessage.tsx` renders transcript parts, timestamps, copy actions, image viewer and expandable provider failure detail | User/assistant/system messages, metadata, grouping, markdown, tool calls/results/status/errors, retry and copy | Implemented — needs verification | `ConversationMessage.test.ts` covers copy and image viewer; legacy ChatView/tool display tests cover other contracts; grouping and retry remain |
| Streaming, waiting, reconnect, and stop | `SessionController`, `ChatView.ts`, realtime and outbox modules | `useReactWorkspaceData.ts` uses session controller/realtime; React has stop and streaming props | Incremental provider output, stop state, no duplicate replay, no stale cross-session display, transparent errors | Implemented — needs verification | Stream/recovery/controller tests; authenticated-provider and browser verification not run |
| Images, interactive cards, notices, and extensions | `ChatView.ts`, `InteractiveCard.ts`, `ConfirmCard.ts`, extension notice/dialog modules | `ConversationMessage.tsx` renders supported transcript parts; React shell does not yet wire all dialog/action flows | Image preview/viewer, cards, confirmation, extension notices and plugin renderers/actions | Partially implemented | Legacy image/card/extension tests; React behavior not verified |
| Transcript navigation and activity | `ChatView.ts`, activity and scroll helpers | React transcript, subagent/background/edited-files disclosures and status data; controller-backed earlier-page loading, scope-keyed scroll anchoring, auto-follow and jump-to-latest | Scroll anchoring, auto-follow, jump-to-bottom, older-page loading, honest unknown/error states, aggregate activity only where API supports it | Partially implemented | Legacy paging tests; TypeScript passes; React earlier-page and scrolling interaction not yet verified in browser |
| Prompt composition and delivery | `PromptEditor.ts`, `outboxDriver.ts`, delivery and attachment modules | `ReactWorkspaceApp.tsx` delegates prompt delivery to existing controller/outbox | Draft persistence, send, stop, retry/take-back/resend, pending/failed recovery and delivery states | Implemented — needs verification | Delivery/outbox/controller tests; authenticated live prompt not verified |
| Composer completions and history | `PromptEditor.ts`, `AutocompleteMenu.ts`, completion/history helpers | React supports prompt history, file/model/extension completion and keyboard selection | Preserve slash commands, file/model autocomplete, command execution, editing keyboard behavior | Partially implemented | Prompt completion/history tests; React interaction verification not run |
| Attachments and mobile input | `PromptEditor.ts`, capture/draft/attachment helpers | React supports file selection, paste/drop, capture and removal | Upload and preview, limits/errors, history attachment recovery, mobile keyboard behavior and dictation where supported | Partially implemented | Attachment and input tests; mobile browser verification not run |
| Model, provider, and thinking selection | `ModelPicker.ts`, composer controls, session APIs | React model/provider and thinking selects use `sessionsApi` | Valid catalog choices, persisted selection, failures and correct session/machine scope | Implemented — needs verification | Model picker/controller tests; React UI verification not run |

## Settings and plugin ecosystem

| Feature | Legacy implementation | Existing React implementation | Required behavior / dependencies | Status | Relevant tests and verification |
| --- | --- | --- | --- | --- | --- |
| Settings shell and General | `SettingsDialog.ts`, `SettingsGeneralPanel.ts` | `react/ReactSettingsDialog.tsx`; configuration reads keyed to selected machine/project, partial-field saves merged against latest persisted config through a serialized write queue shared with plugin toggles | Floating native modal opened from navigation gear; left page navigation, independent scrolling, responsive layout, Escape/close/focus behavior; General config loading/edit/save/reload/error handling | Implemented — needs verification | `ReactSettingsDialog.test.ts` (open, page list, page switch, close); `configWriteQueue.test.ts` covers concurrent host, port and plugin edits; desktop and 393×850 browser checks confirmed all eight pages render, Escape closes, and focus returns to gear; settings writes not exercised |
| Appearance settings | `SettingsAppearancePanel.ts`, theme services | React exposes native theme choice, the stored preference, follow-system behaviour, and pairing controls through the same theme module the legacy app uses | Preserve contributed themes, theme pairing/follow-system controls | Partially implemented | Desktop/mobile page render checked; contributed-theme list and live reload not exercised |
| Notifications settings | `SettingsNotificationsPanel.ts`, `notifications/ntfy.ts`, `notifications/ntfyForm.ts`, `react/NotificationsSettingsPanel.tsx` | React page reads the browser permission and preference, the gateway status, and the ntfy block, and edits the whole ntfy configuration (server, topic, tap target, per-event switches, stop) plus a test delivery. The form's rules live in `notifications/ntfyForm.ts`, which the Lit page now uses too, so neither page can drift on the secret-handling rules. A test press is only offered once the browser has granted permission, and a denied one is named as blocked. While the stored block is unknown the form is not rendered and nothing is writable | Full notification preferences, ntfy configuration and honest delivery reporting | Implemented — needs verification | `NotificationsSettingsPanel.test.ts` (14: prefill, hidden topic, save shape, blank-topic keeps the stored one, blank server means the public one, forget the topic, new topic, test with unsaved fields, server refusal, transport failure, unknown stored block + retry, permission states incl. denied, test notice), `notifications/ntfyForm.test.ts` (21 write, read and failure-reporting rules); live delivery against a real ntfy server not run |
| Pi Packages | `SettingsPackagesPanel.ts` and `piPackageRoutes.ts` | React installs, updates, and removes packages from a source field over the same `/api/pi-packages` contract, and the host lists the enabled state pi reads | Full scoped discovery, enable/disable, validation, status, errors, and reload behavior | Partially implemented | `PiPackagesSettingsPanel` render tests; React browser interaction not verified |
| MCP servers | `SettingsMcpPanel.ts`, `piMcpRoutes.ts`, `piMcpService.ts`, `resources/mcpConfig.ts`, `react/McpSettingsPanel.tsx`, `react/mcpForm.ts` | React lists every file's servers, adds and edits them (transport, command/args/cwd, URL/headers, exposure, enabled, timeout), toggles, tests, and removes them, over the same contract. Secrets are never read into the browser: a draft merges over the file's own record, so an untouched `env`/`header` keeps its stored value; a switch between the two transports drops the keys pi ignores and reports the names it dropped. A definition write and a project override write are separate targets, and an override carries only the keys pi lets a project override (`enabled`, `exposure`, `toolExposure`) | Full scoped configuration, discovery, validation, status, errors, enable/disable and reload behavior | Implemented — needs verification | `McpSettingsPanel.test.ts` (list, add through the form, edit prefill, save shape, refused write, remove, test, transport switch), `mcpForm.test.ts` (prefill, draft, line parsing, switch rules), `piMcpRoutes.test.ts` (save route + parser refusals), `piMcpService.test.ts` (add, merge, secret survival, disabled stays disabled, transport switch, override scope and dropped keys, validation, legacy-scope refusal, queue); live browser flow not run. pi's own refusal of the legacy SSE transport is covered where the rule lives (`resources/mcpConfig.test.ts:196`) |
| Skills | `SettingsSkillsPanel.ts`, `piSkillsRoutes.ts`, `piSkillsService.ts` | React lists every scope's skills with diagnostics and enables/disables a skill for user/project scope over `/api/pi-skills` | Package-owned skills, validation errors, refresh, and reload behavior | Partially implemented | `SkillsSettingsPanel` render tests; React browser interaction not verified |
| Pi Web Plugins and contributed settings | `SettingsPluginsPanel.ts`, plugin runtime and host UI | React exposes discovered plugin enable toggles; plugin-contributed UI absent | Configure plugins; buttons, fields, output, toggles, dialogs, widgets, pages, settings, lifecycle and isolation | Partially implemented | Plugin host/registry tests; React plugin compatibility not verified |
| Machine settings | `SettingsDialog.ts`, machine plugin, machine/auth/access APIs | React machine page lists/selects, adds, renames, and removes through the existing machine controller; it offers restart, never an update, and restarts one machine's installed service (**Restart** in its row, **Restart every machine** for the fleet; a machine that refuses names the reason it gave) | Complete auth, access approval/configuration, health and reconnect workflows using existing contracts. No machine offers an update any more: the fleet update keys and `updateCommand` were removed with the Updates module | Partially implemented | Machine and settings tests; React browser verification not run |
| Built-in updates | `pi-web-plugins/updates` (page, offer dialog, version strip), `src/server/web/updates/` (`/api/pi-web/updates/check`, self-update, fleet update), the `updateCommand` config key and its **Settings → General** card, the fleet update keys in `SettingsFleetSection`, `piWebApi.updateCheck`, `piWebStatusCache` | None, by decision | Intentionally removed (owner, 2026-08-22): no update check, notification, banner, badge, menu entry, dialog, background task, listener, API, settings section, event, test, fixture, document, or dependency. Updating PI WEB stays a package-manager step the operator runs (`npm install -g`, brew, nix, image deploy, `git pull`) plus `pi-web restart`; `pi-web restart`, `pi-web status`, `pi-web doctor` and the version reporting stay | Intentionally removed | Repo-wide grep for `updates/check`, `updateCommand`, `updateAvailable`, `pi-web-updates`, `checkForPiWebUpdates` and `SelfUpdate` is empty outside the retired design note; 169 client tests and 36 server status/config/cli tests pass; live browser confirmation recorded in progress.md |
| Plugin API compatibility | `src/plugin-api.ts`, `packages/pi-web-plugin-api`, `src/client/src/plugins/*` | React now creates a machine-scoped `PluginRegistry`, registers `core`, loads external modules, reports registration failures in Settings, disposes plugins on machine changes, and renders plugin dialogs through `PluginSurface`. The registry's panels, actions, settings sections, transcript renderers and composer contributions are not yet consumed by React. The compatibility host still imports Lit for the existing public `TemplateResult` contract | Wire every contribution family into React while preserving third-party compatibility; migrate bundled plugins and remove first-party Lit dependencies when no longer needed | Partially implemented | `usePluginRegistry.test.ts` and `ReactPluginDialogLayer.test.ts` cover bootstrap, isolation, switching, dialogs and focus; `PluginSurface.test.ts` covers the rendering bridge. The browser no longer opens a plugin dialog on startup: the bundled Updates plugin, which contributed that startup dialog, is removed, and the eight remaining bundled plugins open only when the product asks. Plugin-triggered actions, close behavior, contribution hosts and desktop/mobile interaction remain unverified |

## Workspace tools and feedback

| Feature | Legacy implementation | Existing React implementation | Required behavior / dependencies | Status | Relevant tests and verification |
| --- | --- | --- | --- | --- | --- |
| Git | Git plugin browser UI and Git backend contract | Scoped status and staged/unstaged diffs; per-file and bulk stage/unstage; confirmed tracked-file discard; commit; local branch switch; fetch/pull/push; remote tracking counts from status | Correct machine/workspace scope, path safety, progress, errors, serialization, and honest unsupported-capability states | Partially implemented — supported mutations are wired; verification and backend contract gaps remain | Existing Git backend fixture tests cover stage/unstage/discard, commit, branch switch, fetch/pull/push and remote failure behavior; React presentation tests cover staged/unstaged grouping, rename labels, conflicts and commit eligibility. Live UI and cross-scope mutation behavior still need browser verification. Backend exposes no same-worktree branch-create, remote-list, or upstream-configuration operation. Git diff paths are not passed with literal-pathspec mode, so filenames containing Git pathspec magic can resolve differently; requires a coordinated backend fix. |
| Files and editor | Files plugin, file services, CodeMirror viewer/editor | React file tree, search, create/upload/read/edit/save/delete and multi-file editor | Workspace-scoped browsing/search/CRUD, confirm destructive action, dirty drafts, save/reload/conflict protection and syntax highlighting | Partially implemented | React CodeMirror test plus file backend tests; browser workflows not verified |
| Terminal | Terminal plugin and terminal services | `ReactTerminalPanel.tsx` | Connection, input/output, resize, reconnect, cleanup, errors, selected machine/workspace and mobile usability | Implemented — needs verification | Existing terminal tests target plugin UI; React live terminal not verified |
| Status, notifications, and errors | `StatusBar.ts`, notification dispatcher and connection UI | React status footer, machine label, session metrics, token/context/cost/branch, activity | Show only API-backed facts; toast/browser notifications, connection and error announcements | Partially implemented | Notification/status legacy tests; React announcements not verified |

## Lit removal and delivery

| Feature | Legacy implementation | Existing React implementation | Required behavior / dependencies | Status | Relevant tests and verification |
| --- | --- | --- | --- | --- | --- |
| Browser Lit UI and custom elements | `src/client/src/main.ts`, `components/PiWebApp.ts`, component and app-shell trees | `src/client/src/react-main.tsx` mounts React from `index.html` | Remove inactive Lit UI only after complete behavior and plugin replacement; no active Lit runtime/import/custom element remains | Not implemented | React production build passes; Lit source remains throughout client and bundled plugins |
| Bundled plugin browser UI | `pi-web-plugins/*/browser`, plugin registry and host | React Git, files, editor and terminal implementations cover selected surfaces | Migrate workspaces, machines, extension dialogs, file viewer, goals and Mermaid (the Updates plugin is removed) | Not implemented | Plugin-specific tests remain Lit-oriented and are not React parity evidence |
| Dependencies, tests, and assets | `package.json`, Lit harness tests, templates and styles | React build does not prove dependency removal or parity | Remove Lit dependency and obsolete tests/assets after replacement; retain shared contract tests | Not implemented | `pnpm run build:react` passes; full verification and browser suite not run |

## Audit checkpoint

- Branch: `feat/react-workspace-ui-from-main`, on the requested branch. `f28aa3c8` records the settings/transcript milestone, `da53f231` records the session lifecycle milestone, `59a606b6` records undoable project close, `5e38a6ef` records React project creation with machine-bound folder suggestions and trust handling, and `e57fc4c2` records the MCP editor and the ntfy form. The branch is pushed to `origin`.
- Startup: `src/client/index.html` loads `react-main.tsx`; `src/client/src/main.ts` still imports the Lit app but is not the HTML entry. Development has `dev:react` / `dev:react:client`; production has `build:react`. The default `build` also compiles TypeScript and plugins before Vite.
- The existing React app is API/controller-backed, but feature parity remains incomplete. Settings now opens from the navigation gear in a native responsive modal; several integration/configuration workflows and plugin-contributed UI remain incomplete.
- Broad inventory at audit: 130 matches for Lit custom-element/LitElement registration patterns and 245 files under the legacy component tree (147 test files). These include active plugin browser surfaces and tests; removing the dependency requires migrating the plugin UI contract too.
- Reference: `docs/ui-design/Dark Mode Developer Workspace UI.png` inspected. It shows the target three-column workspace and Settings gear in the navigation area.
- Current React checks: earlier project/session checks remain as recorded above. This checkpoint adds focused registry and dialog tests (10 tests across those files and `PluginSurface.test.ts`) plus a passing TypeScript check; live browser verification of the plugin host has not been performed.
- Prior milestone verification: project close passed all static checks and 684 test files (5,980 passed, 5 skipped).
- Current `pnpm run verify` for React project creation and trust-race handling passed static checks and all 685 test files (5,984 passed, 5 skipped). Existing dynamic-import warnings and intentional connection-refused test output did not fail the suite.
- `pnpm run verify` over the MCP editor and ntfy milestone (`e57fc4c2`) passed with exit 0: 689 test files, 6056 tests passed, 5 skipped. `pnpm run build` exit 0, with the open ~940 kB main-chunk warning. The MCP and ntfy flows have not been driven in a live browser, and no ntfy delivery has been made against a real server.
- 2026-08-22: the built-in Updates module is gone (row above). `pi-web-plugins/updates` is deleted, `src/server/web/updates/` is now `src/server/web/service/` (restart only), the release check, the `updateCommand` key, `PI_WEB_UPDATE_COMMAND`, `piWebApi.updateCheck`, `piWebStatusCache`, the General panel's Updates card and the fleet update controls are removed, and 33 files under `pi-web-plugins/` and 125 under `src/client/src` still import `lit`.
- No authenticated provider prompt/stream, stop-generation, complete plugin contribution integration, project/session CRUD, or full desktop/mobile workspace workflows have been verified. This remains an incomplete migration checkpoint. The `PluginSurface` adapter and React registry bootstrap exist, but plugin contributions are not yet wired throughout the app; Lit remains necessary for the compatibility bridge and other first-party UI. See [progress.md](progress.md) for the file-level plan and the test conventions.

---

# Ledger — 2026-11-20 (React migration, Updates removal)

The section above is the older checkpoint and is kept as history. This is the current one, and it is
the row set the mission's Definition of Done is measured against. A row is **Verified** only with live
browser evidence at desktop 1440px and mobile 393x850 against a real session daemon. **Unit tested**
means the React unit suite covers it and no browser has seen it. **Partial** names the gap in the row.

## The built-in Updates module — Removed

- The popup that interrupted the browser session is `pi-web-plugins/updates/updates-plugin.js`: it
  fetched `/api/updates` 2.5 s after boot, then every 15 min, and opened `showUpdatesDialog` on
  `update-available`. The plugin is in the bundled `built-ins` manifest, so it loaded on every machine,
  with no setting that disabled it. Its trigger is deleted, not hidden.
- Deleted: `pi-web-plugins/updates/` (9 files), `pi-web-plugins/index.json` entry, the client's
  `components/UpdatesView.ts`, `features/updates/updatesState.ts`, `features/updates/gitBranchPrompt.ts`,
  the `piWebUpdates` API surface (`requestUpdateCheck`, `getUpdatesState`, `setUpdatesState`,
  `getAutoUpdateState`, `setAutoUpdateState`, `subscribeUpdatesChanged`), the `updates-changed` event and
  the `pi-web:updates-changed` wire, the `pi-web-updates-state` storage keys, and the General panel's
  Updates card.
- Server: the `/api/updates*` routes are unmounted, and `src/server/web/updates/` is now
  `src/server/web/service/` — the service restart survives, the GitHub release check does not.
  `releaseNotesPath()` was deleted with the check.
- Settings: the update keys are stripped from persisted settings on read and are not written back.
- Fleet: a remote machine can no longer report an update. `fleetMachineSummary` drops
  `updateAvailable`/`updateCommand`, `FLEET_MACHINE_SUMMARY_SCHEMA_VERSION` is `4`, `FLEET_MACHINE_CAPABILITIES`
  is `["projects", "sessions", "machines"]`, and the Machines table shows no update badge, button, status
  cell, dialog, timer, subscription, install, or restart.
- Removed dependency surface: the `updateCommand` setting key, `PI_WEB_UPDATE_COMMAND`,
  `piWebApi.updateCheck`, `piWebStatusCache`, `UpdatesState`, `UpdateInfo`, `UpdatesChangedEvent`.
- Kept, on purpose: `piWebInfo.restart` (the service restart, used by **About** and the machines
  surface), `isGitRepository` and the repository/trust checks, `ProjectTrustChangedEvent` and the trust
  event, `ProjectCreateResponse.trustWarning`, Git itself, and package management.
- `pnpm run typecheck` and `pnpm run knip` exit 0 on the removal, and Knip reports no unused exports,
  files, dependencies, or types.

## Parity status — 2026-11-20

| Area | Row | State | Evidence |
| --- | --- | --- | --- |
| Runtime | React is the running app (`index.html` → `src/client/src/main-react.ts`, `#root`) | Verified | live 8505: `GET /` 200, `GET /src/client/src/main-react.ts` 200 |
| Runtime | Lit runtime for first-party UI | Partial — required | 125 files under `src/client/src`, 33 under `pi-web-plugins/` import `lit` |
| Runtime | Two React roots, no interop | Partial — defect | `main-react.ts:37` (workspace) + `main.ts:21` (Lit overlay) on `document` |
| Plugins | Registry, core + external load, dispose, failure in Settings | Unit tested | `usePluginRegistry.ts` (391 lines), `usePluginRegistry.test.ts`, `PluginSurface.test.ts` |
| Plugins | Contribution families render in React | Not migrated | all 18 families are Lit (`TemplateResult` / `PluginSurface`); the React contract is spec (`plugin-api-react.md`) |
| Plugins | Bundled plugin UI | Not migrated | `files`, `git`, `goal`, `info`, `machines`, `mermaid`, `terminal`, `workspaces` all Lit |
| Settings | Modal shell, sidebar nav, Esc, body scroll lock, search, touch sizing | Unit tested | `ReactSettingsDialog.test.ts` 11 files / 43 tests pass |
| Settings | General, Appearance, Notifications | Unit tested | sections render; `AppearanceSettings.tsx:111` writes no preference |
| Settings | Pi Packages, MCP Servers, Pi Web Plugins, Machines, Skills | Partial | MCP server is a table + unauthenticated send test; Skills is `SettingsSkillsPanel.tsx` (42 lines) |
| Settings | Keyboard section | Excluded by decision | not in the React nav |
| Projects | Create, switch, close, rename, trust, folder navigation | Partial | unit tests pass (65 files / 262 tests); no live pass this session |
| Sessions | Create, switch, rename, delete, history, restore | Partial | same suite; no live pass this session |
| Conversation | Messages, streaming, tools, thinking, timestamps, attachments | Partial | unit level only; no real provider prompt this session |
| Composer | Submit, stop, model and thinking-level pickers, status | Partial | unit level only |
| Machines | Switching rebuilds the registry, settings, status | Unit tested | per-machine registry; no live pass this session |
| Updates | Built-in update notification and UI | Removed | the section above + the 404 evidence below |
| Lit removal | Dependencies, bridge, legacy components | Not migrated | `lit`/`lit-html` in `package.json`, `packages/pi-web-plugin-api/package.json`, 8 plugin manifests |
| Verification | `WorkspaceCodeEditor.test.ts`, `useWorkspaceFiles.test.ts` lint | Resolved | `npx eslint <both files>` exit 0 |
| Verification | Full `pnpm run verify` | Red, measured | 145 lint errors / 176 warnings in the React tree, once the gate reads it |

## Verification record — 2026-11-20

- `pnpm run typecheck` exit 0 (after the Updates removal, and after the settings search change).
- `pnpm run knip` exit 0 after the Updates removal; 8 unused-export items in `src/shared/types.ts` after
  the settings change, each a schema whose only consumer is an HTTP route (`ctx_execute` probe), so the
  Knip row stays open and is not hidden with an ignore.
- `pnpm run vitest` over the files touched: 65 files / 262 tests pass; the Settings suite 11 files /
  43 tests pass.
- `pnpm run build:plugins`: 30 manifests, zero `updates` manifest.
- A `pnpm run verify` run captured mid-removal (2026-11-20 15:29, task `b8b9097c8`) exits **1**: typecheck
  passes and lint reports 3 errors — `PI_WEB_STATUS_FRESH_MS` unused, `PiWebInstallationInfo` unused,
  `npmVersionResponse` unused. All three are settled on HEAD: `npx eslint "src/server/**/*.ts"` is clean,
  the first two names no longer exist, and `PiWebInstallationInfo` is used at
  `src/server/shared/piWebStatus.ts:248,272`. The wrapper that launched the run exits 0 after echoing the
  suite's status, so a `verify` task's task-level exit code is not the suite's exit code — read
  `VERIFY_EXIT` in the output.
- `npx eslint "src/server/**/*.ts" --no-warn-ignored` on HEAD: no output, exit 0. The red `verify` is the
  React tree's 145 errors, not the server tree.

- `npx eslint src/client/src/react/WorkspaceCodeEditor.test.ts src/client/src/react/useWorkspaceFiles.test.ts`
  exit 0 — the two files the mission brief names are clean.
- `npx eslint src/client/src/react --no-warn-ignored`: 145 errors, 176 warnings, 78 files; 119 errors are
  `react-hooks/refs`, 35 are `react-x/no-array-index-key`, 11 are `react-hooks/preserve-memo-validation`
  warnings; 216 errors clear with `--fix`. `pnpm run lint` is exit 1 because the React tree is now inside
  the gate (`eslint.config.mjs`).
- Live 8505 stack (`scripts/stack-8505.sh up`, isolated data dir): `GET /` 200, `/index.html` 200,
  `/src/client/src/main-react.ts` 200, `/api/machines/local/projects` 200. **404** for `/api/updates`,
  `/api/updates/state`, `/pi-web-plugins/updates/updates-plugin.js`,
  `/pi-web-plugins/updates/updates-api.js`, `/src/client/src/components/UpdatesView.js`,
  `/src/client/src/features/updates/updatesState.js`, `/src/server/web/routes/updates.js`.
  `/src/app.ts` answers 200 only because Vite serves any module under `/src/**` by URL; the page never
  requests it. `/pi-web-plugins/index.json` answered 404 on this stack (no built plugin manifest in
  reach), so the external-plugin load is **not** covered here.

## What this section does not claim

- No browser driver, no screenshots, no desktop 1440px or mobile 393x850 pass, no real provider prompt,
  stream, or stop-generation run. Live evidence on 2026-11-20 is HTTP-shaped.
- No plugin has a React render path: the React contract is a specification
  (`plugin-api-react.md`), and the registry, the plugin API, and all eight bundled plugins are Lit.
- Settings is not complete: of the eight required sections, one (`Appearance`) writes no preference, and
  `MCP Servers` and `Skills` are close to placeholders.
- `pnpm run verify` does not pass. The lint number above is the recorded reason; the fix is a separate
  milestone and the gate stays red until it is done.
- The Lit runtime stays required; nothing in the Lit removal has been cut.
