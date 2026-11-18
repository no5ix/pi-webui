# The React frontend

PI WEB's presentation layer is React. Everything under `src/client/src/react` is the
workspace a person uses; the framework-agnostic data layer under `src/client/src`
(the API clients, the session socket, the session board, the transcript store, the
panel-resize controller, the theme engine, the access gate) is unchanged and remains
the only source of truth.

## Choosing a shell

`src/client/src/bootstrap.ts` decides what mounts into `#pi-web-root`:

- the React shell is the default;
- `?ui=legacy` mounts the previous Lit shell, and the choice is remembered in
  local storage under `pi-web-frontend` (`"react"` | `"legacy"`).

The legacy shell is kept as the parity reference a reviewer opens beside the React
one, and because plugin UI is written as Custom Elements that the legacy shell also
hosts. A page carries one rendering tree at a time.

## What React owns

`app/AppShell.tsx` owns three things: the columns (widths, collapse, which column a
phone shows), the subject (the machine, project, workspace and session the URL
names), and the layers (palette, quick switcher, settings, dialogs, toasts). Every
panel is handed its subject and reads its own data; the shell never reaches into a
panel's state.

- `components/navigation` — running sessions, projects and their sessions, search,
  pins, archived visibility, per-project session caps, context menus.
- `components/conversation` — the transcript (markdown, thinking, images, tool
  groups, skill rows, extension rows and notices, delivery marks), the conversation
  header (rename, abort, reload, archive, fork), and the scroll anchoring that keeps
  the reader's position when older pages load.
- `components/composer` — the prompt editor, slash commands, shell `!` commands,
  file suggestions, attachments, drafts, queue/steer behaviour, the model and
  thinking chips, the context meter, and the footer's queued-prompt list.
- `components/workbench` — Git, Files, Terminal and Goals over the chosen workspace.
- `components/common` — the command palette, quick switcher, settings overlay,
  new-project dialog, access gate, toasts, context menus, dialogs.
- `state/*` — small stores built on one `createStore` primitive. Each store wraps an
  existing engine (for example `state/board.ts` drives `sync/sessionBoard`,
  `state/sessionStream.ts` drives the session socket and the transcript store,
  `state/panels.ts` reuses `appShell/panelResizeController` and its stored
  `pi-web:panel-sizes:v1` envelope, `state/theme.ts` drives `theme.ts`). A store
  never keeps a second copy of server state.
- `plugins/pluginBridge.tsx` — one `PluginRegistry` built the way the Lit shell built
  its own, loaded from `pi-web-plugins/manifest.json` and, for a remote machine, from
  `api/machines/<id>/pi-web-plugins/manifest.json`. It exposes the contributions
  React consumes: composer contributions, themes (fed to the theme engine), settings
  and nav sections, transcript/tool/code-fence renderers, workspace panels, and the
  `showDialog` layer.

## Plugin compatibility

Plugin UI is Custom Elements, so the React shell hosts Custom Elements.
`components/common/LitBoundary.tsx` creates the element, applies the contribution's
properties (exact property names, `Reflect.set`), forwards its events, and removes it
on unmount. That is how the composer editor, the model picker, the extension dialog
cards, the session-rename dialog, the auth dialog, the quick switcher and the
settings surface appear inside React. Those element modules register themselves when
they load, and nothing else in the React tree would load them, so
`react/plugins/coreElements.ts` names the hosted set and `bootstrap.ts` loads it before
the shell renders. `packages/pi-web-plugin-api` and the plugin API in
`docs/plugin-api.md` are untouched: a plugin registered against the registry receives
the same contributions and the same host objects.

In the React shell a plugin's **composer contribution**, **theme**, and **`showDialog`**
surface are hosted: the manifests are loaded per machine (`loadPlugins`), plugin themes
are handed to the theme engine, composer contributions render under the prompt, and a
plugin's dialog appears in the shell's modal layer. The other contribution kinds are
not hosted — see the gaps.

## Known gaps in the React shell

These are real, said plainly:

- **Plugin workspace panels, global panels, settings sections, nav sections,
  custom message renderers, tool renderers and code-fence renderers are not hosted
  in the React shell.** The React workbench implements Git, Files, Terminal and
  Goals directly, reading the same plugin backends (`git`, `goal`) and workspace
  routes the panels read. A plugin that contributes one of those surfaces has no
  route in the React shell; `?ui=legacy` hosts them. The bridge forwards a plugin's
  `openPage` as a `pi-web-plugin-open-page` event and gives the registry no fleet
  source, so a plugin that reads the fleet sees no machines in the React shell.
- **Git write operations are absent because PI WEB has no endpoint for them.** The
  Git tab reads the branch, the changed files and a file's diff, and states that
  staging, committing, pushing and discarding are not offered; the panel says so
  rather than drawing controls that cannot be honoured.
- **The Goals tab reads.** Goals and their TODOs are pi's, stored per workspace and
  read through the Goal plugin's backend; planning and marking are the agent's goal
  tools, not this panel.
- **The Files tab is a plain editor, not the CodeMirror viewer.** Text is opened,
  edited, saved (`⌘S`), renamed, deleted, uploaded (one file per request) and
  refreshed. A file the machine does not send as text is said to be unread here.
  The Files plugin's own preview modes, upload batching and watcher live in the
  legacy shell.
- **Terminal soft keys, pinch zoom and expanded-terminal gestures are not ported.**
  The React tab is one xterm with one socket per visible terminal, tabs, rename,
  close and status.
- **The quick switcher's unread marks are coarse** (a session is marked when the
  board records an unread completion for it); the per-tool counts the legacy shell
  shows are not carried.
- **Mobile column sheets (`Go to`) are not ported.** The phone layout shows one
  column at a time and the corner bar switches it; the sheet with destinations is a
  legacy-shell surface.
