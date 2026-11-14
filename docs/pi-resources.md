# Skills, MCP servers, and Pi packages

Pi loads three kinds of resource that change what a session can do: **skills** (the instructions a
model is offered), **MCP servers** (tools a server supplies), and **Pi packages** (the bundles that
often carry both). PI WEB Settings has a panel for each, on the machine that is selected. All three
read what Pi already has and write what Pi already reads: PI WEB does not keep its own copy of a
skill, a server, or a package.

| Panel | Reads | Writes | Needs |
| --- | --- | --- | --- |
| **Settings → Skills** | the skills Pi discovers for the selected scope | the PI WEB preference that keeps a skill out of a session | type `/reload` in each idle PI WEB session |
| **Settings → MCP Servers** | Pi's `mcp.json` files | the same files, in the scope the change names | type `/reload` in each idle PI WEB session |
| **Settings → Pi Packages** | Pi's package settings | the same settings | type `/reload` in each idle PI WEB session |

A running session keeps what it loaded: a skill that was switched off is still in the prompt of a
session that is running, and a server that was switched on is not connected there. Each panel says
this, and the answer to a change says it too.

## Skills

**Settings → Skills** lists the skills Pi discovers: the ones in the agent directory
(`<agentDir>/skills`), the ones a project ships (`<project>/.pi/skills`), and the ones Pi packages
supply. Each row says where the skill came from and which scope it belongs to; a project's rows
appear only when a project is selected and Pi trusts that project, and the panel says when the
project scope was not read. A skill Pi could not read is listed as a problem, not left out. A skills
directory that cannot be opened is named as unreadable with the reason, and that scope's list is
called *not known*: a short list from a directory PI WEB could not open is not reported as a directory
with nothing in it. A directory that is simply absent stays the honest emptiness it is, because Pi
looks in places a fresh install never creates.

A skill's switch is a **PI WEB preference**, not a file edit:

- the global scope's list is the `skills` key of [PI WEB's config](config.md), because the switch
  belongs to the machine that runs Pi;
- a project's list is the `skills` key of `<project>/.pi-web/config.json`, so a project can turn a
  skill off for itself and commit that;
- a project's entry answers for that project alone and never rewrites the global entry;
- a preference names a skill, so a project can take a machine-wide skill out for itself, and a
  machine-wide answer can name a skill that project's directory supplies;
- a skill nobody has written anything about keeps Pi's default, which is on.

Nothing is deleted and no skill file is edited: the preference takes the skill out of the list Pi is
given, so a disabled skill reaches neither the system prompt nor a `/skill:<name>` command. Turning
it back on restores both. Skills a Pi package supplies follow the package: when the package is
configured off, its skills are listed as off and say why, and switching an individual skill does not
turn the package back on.

## MCP servers

**Settings → MCP Servers** reads and writes Pi's own MCP configuration: `<agentDir>/mcp.json` for
the machine, and `<project>/.pi/mcp.json` for a trusted project. The shape is Pi's — the
`mcpServers` object other MCP clients use — and PI WEB adds no format of its own. A project entry
that names only `enabled` overrides that setting for a global server of the same name; that is how
one project turns a shared server off without touching the machine's file, and removing the override
restores the global server.

**The project is named, never assumed.** The panel offers the selected machine's projects, and
opens on *No project*: with no project named, PI WEB reads and writes only `<agentDir>/mcp.json`.
Naming a project adds its file to the read — that project's own servers, and its overrides of the
machine's servers — and the panel says which file each answer came from and which project the page
is answering for. The choice belongs to one machine, because a project's `mcp.json` is one machine's
file: switching machines drops the rows, the selection, and the messages of the machine left, and
offers the projects of the machine entered. A project the machine no longer has is dropped from the
page rather than kept as a selection.

**Each control says which entry it writes.** A row's switch writes the entry that the chosen scope
owns, and the row says which file that is: with no project named it writes the definition in
`<agentDir>/mcp.json`, and with a project named it writes that project's override in
`<project>/.pi/mcp.json`. Removal names both entries when a project has both — *Remove project
override* leaves the global definition in place, and *Remove definition* takes the server out of the
file that defines it and leaves a project's override untouched. A server the project itself defines
has only its definition — there is no override to write — and the row says so, and a global
server with no override says that the project follows the global answer and that the next change
writes the project's file. A server a Pi package supplies has no file for Settings to write, and
is listed with the package's answer. Removal is armed by a first press that names which of the two
it removes, and the arm belongs to that entry, that project, and that machine: choosing another of any
of them drops it.

The panel keeps two facts apart:

- **what the config says** — enabled, disabled, or invalid, with the file the answer came from, the
  command (not its arguments) or the URL with any credential taken out, and the exposure Pi will use;
- **what a probe answered** — **Test Connection** starts a server, completes Pi's handshake, and
  stops it, reporting Reachable, Unreachable, or Needs sign-in. It never opens a connection a
  session uses, and a server whose config resolves a value by running a command is reported as not
  probed: PI WEB does not run commands from a settings panel.

Turning a server on writes the file; Pi's own MCP extension connects it when a session starts, so a
reload is what makes the tools appear. Removal takes the entry out of the file that defines it —
never out of the other scope's file.

**Secrets are never shown.** Environment and header values, OAuth client secrets, a credential
embedded in a server URL, and a server's arguments stay in the file: an argument carries a token as
often as an environment variable does — the usual remote-proxy entry is `npx mcp-remote
<url>?token=…` — so the panel shows the command and the names, not the values. A probe's message,
including a server's own name and version, has every value the configuration names cut out of it,
including the ones Pi resolves from the environment. PI WEB reads the file to list and change
servers; it does not copy their secrets to the browser.

**A project's servers need the project's trust.** Connecting a project's server runs what the
project's file names, so an untrusted project's `mcp.json` is not read, not changed, and never
connected; the panel says the project scope was not read and offers no write into it, and a server
that only that project's file names cannot be probed. A file that is not valid JSON is reported
as broken, with its position, and never with the text around the break; PI WEB refuses to write into
such a file, so a typo cannot be answered by overwriting the file that holds the secrets.

## Pi packages

**Settings → Pi Packages** installs, updates, removes, and switches packages. The switch uses Pi's
own package filtering: a package that is off keeps its installation and its entry in Pi's settings,
and supplies no extension, skill, prompt template, theme, or context file. Turning it back on
restores what it supplies. A package whose resources are selected individually is shown as filtered,
and switching it off takes the whole package out; the panel says which of the two a package is.

Switching a package off does not uninstall it: nothing is deleted, and the package updates as usual.
To take a package out of the machine, remove it.

## On a registered machine

Skills, MCP servers, and Pi packages belong to the machine that runs Pi, so each panel acts on the
machine selected in Settings and names it. A remote machine answers for its own agent directory,
project store, trust decisions, and network; the browser never names a path. What a remote machine
does not support, such as a section a gateway cannot read, is reported as unsupported rather than as
empty. See [machines](machines.md).
