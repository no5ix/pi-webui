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
  the reader's position when older pages load. A session opened from a link is
  titled by its first prompt, and the invitation to say the first thing appears
  only once the machine has answered: while the transcript is opening,
  reconnecting or failed, the transcript says that instead, because a transcript
  that has not been read is not an empty one.
- `components/composer` — the prompt editor, slash commands, shell `!` commands,
  file suggestions, attachments, drafts, queue/steer behaviour, the model and
  thinking chips, the context meter, and the footer's queued-prompt list.
- `components/workbench` — Git, Files, Terminal and Goals over the chosen workspace.
  The Files surface edits in the CodeMirror PI WEB already ships for the composer
  (`filesCodeView.tsx`), so the machine's own language label selects the grammar.
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

## The subject: one answer for all three columns

The URL names ids; the machine says what they mean, and the two arrive at
different times. `state/subjectResolver.ts` decides the subject in one pure
function over named states — `empty`, `loading`, `resolved`, `open-preferred`,
`workspace-empty`, `asking`, `needs-locate`, `blocked` — and
`state/subjectRuntime.ts` turns a decision into a plan (the next selection, the
status to publish, whether to ask the machine where a session went) that a thin
executor performs. The panels receive one subject, so the navigation row, the
conversation header, the transcript, the composer and the four workbench tabs
cannot disagree.

The rules that follow from that shape:

- **A selection is never discarded because a store is behind.** A session id the
  shell has not been told about while the board is still answering is `loading`;
  the transcript opens at the workspace the route points at and says what is
  unknown. An empty list is never treated as a refusal, and a refusal is never
  treated as an empty list.
- **A workspace opens the session the reader was last in.** PI WEB opens a project
  at its main workspace and that workspace at its preferred session — the one this
  browser last read there, else the newest live one, skipping archived rows and
  sessions whose folder is gone. The memory is per workspace path
  (`state/selectionMemory.ts`), so a reload, a Back gesture, or returning from the
  switcher opens the same session. Opening a project row chooses its main
  workspace, and a fresh page with an empty URL opens the first open project's
  main workspace and its preferred session, then writes the URL.
- **A session no listing shows is asked for, machine-wide.** The route can name a
  session whose project is closed, archived, or on another workspace. The shell
  calls the machine's locate (`cwd: "/"`, the same call the legacy shell makes),
  and a located session is placed at the workspace and project its folder belongs
  to, so the URL, the navigation row and the workbench scopes follow it. A session
  the machine reports gone is titled as gone; a locate that failed is titled as
  failed with the machine's reason. A located session is kept, so the same session
  is never located twice.
- **The state is said in the surface that shows it.** The header titles a session
  that is being looked for as being looked for; the workbench says the machine is
  finding the workspace of this session while it is, and says a workspace is not
  chosen only when that is the fact.
- **The stream says what it is doing.** The transcript's connection is set live
  when the session socket opens, and a socket that closed before it opened — a
  stored session with no running runtime — is `closed`: the transcript on screen is
  the machine's stored history, and the panel says so with the control that tries
  again. A join that has not opened yet is given a moment before it is announced,
  so a transcript that is joining is not labelled as a problem.

`state/subjectResolver.test.ts` and `state/subjectRuntime.test.tsx` cover these
states, including a deep link that only names a session, a workspace id the
machine no longer uses, a board that refused, a session reported gone, and the
URL a resolved subject writes.

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

In the React shell these plugin surfaces are hosted: **composer contributions**,
**themes and theme pairs**, **`showDialog`**, **actions** (every contributed action is
also a command in the palette, with its own group, chord, `enabled` test and
unavailability reason), **message renderers** for custom transcript rows, **tool
renderers** for a claimed tool's rows, and **settings sections** — the last through
the app's own settings element, which the shell hosts and feeds. The manifests are
loaded per machine (`loadPlugins`), plugin themes go to the theme engine, composer
contributions render under the prompt, and a plugin's dialog appears in the shell's
modal layer. A plugin's `prompt` control sends through the hosted prompt editor,
which exposes `submitPrompt()` for exactly this: a card that sends a prompt sends
what the reader can see in the composer.

## Known gaps in the React shell

These are real, said plainly:

- **Plugin workspace panels, global panels, nav sections and code-fence renderers are
  not hosted in the React shell.** Their contexts carry the terminal host, the
  workspace file authority and the nav surface; the React shell draws those columns
  itself and has not built the equivalents. Asking for one of those surfaces gets the
  answer in words — the plugin's page is in `?ui=legacy` — rather than a tab with
  nothing behind it. The React workbench implements Git, Files, Terminal and Goals
  directly, reading the same plugin backends (`git`, `goal`) and workspace routes
  the panels read, and a plugin's panel contribution is not given a tab. The bridge forwards a plugin's
  `openPage` as a `pi-web-plugin-open-page` event and gives the registry no fleet
  source, so a plugin that reads the fleet sees no machines in the React shell.
- **Git staging, committing, fetching, pulling, pushing and branch switching are
  absent because PI WEB has no endpoint for them.** The Git tab reads the branch,
  upstream and counts, the grouped changes, a file's diff, the commit history a page
  at a time, and one commit's patch (a merge commit says so); it offers the one
  repository write the Git plugin backend performs, `worktree-add`, as a real form.
  The operations with no route are named in words rather than drawn as controls that
  cannot be honoured.
- **The Goals tab reads.** Goals and their TODOs are pi's, stored per workspace and
  read through the Goal plugin's backend; planning and marking are the agent's goal
  tools, not this panel.
- **The Files tab has no image preview, upload batching, file watcher, or split
  view.** Text is opened in the CodeMirror editor with the grammar the machine names
  (and plain text when it names none), edited, saved (`⌘S`), discarded, created,
  renamed, deleted, uploaded (one file per request) and refreshed; a markdown file
  can be read as rendered text; the path, size, modification time, language and a
  partial-read badge are stated beside the file. A file the machine does not send as
  text is said to be unread here. A read the machine sent only in part refuses to
  save, because writing the fragment back would delete the rest of the file. The
  Files plugin's own preview modes, upload batching and watcher live in the legacy
  shell.
- **Pinch zoom, split terminals and the plugin terminal panel's text-selection copy
  surface are not ported.** The React tab is one xterm with one socket per visible
  terminal, and the socket speaks the daemon's framed protocol: keystrokes leave as
  `input` frames, the fitted size leaves as `resize` frames, and the machine's
  `output`, `exit` and `error` frames are decoded rather than printed. Tabs, create,
  rename, close, close-all, reconnect, a full-height mode, and a coarse-pointer key
  row (Escape, `^C`, `^D`, Tab, arrows, Page Up/Down, Return) are wired.
- **The quick switcher's unread marks are coarse** (a session is marked when the
  board records an unread completion for it); the per-tool counts the legacy shell
  shows are not carried.
- **Mobile column sheets (`Go to`) are not ported.** The phone layout shows one
  column at a time and the corner bar switches it; the sheet with destinations is a
  legacy-shell surface.
