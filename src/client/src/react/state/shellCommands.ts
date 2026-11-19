import { setWorkbenchTab, togglePanel } from "./panels";
import { createStore, useStoreSelect } from "./store";

/**
 * The shell's command ledger.
 *
 * The command palette, the keyboard and the panels' own buttons all run the same
 * commands, so a command exists once. A panel contributes its commands while it is
 * mounted — the files panel contributes "Refresh tree" and "Save the open file",
 * the terminal panel "New terminal" and "Close every terminal here" — and the
 * palette reads the registry. A command that is not available states why
 * (`disabled`), and an empty palette is never presented as "no commands exist".
 */
export interface ShellCommand {
  readonly id: string;
  readonly title: string;
  readonly group: string;
  readonly hint?: string | undefined;
  readonly keywords?: readonly string[] | undefined;
  readonly disabled?: string | undefined;
  readonly chord?: string | undefined;
  run: () => void;
}

const registry = createStore<readonly ShellCommand[]>([]);

export function useShellCommands(): readonly ShellCommand[] {
  return useStoreSelect(registry, (value) => value);
}

export function registerShellCommands(commands: readonly ShellCommand[]): () => void {
  registry.update((current) => {
    const byId = new Map(current.map((command) => [command.id, command]));
    for (const command of commands) byId.set(command.id, command);
    return [...byId.values()];
  });
  const ids = new Set(commands.map((command) => command.id));
  return () => {
    registry.update((current) => current.filter((command) => !ids.has(command.id)));
  };
}

export function findShellCommand(id: string): ShellCommand | undefined {
  return registry.get().find((command) => command.id === id);
}

export function runShellCommand(id: string): boolean {
  const command = findShellCommand(id);
  if (command === undefined || command.disabled !== undefined) return false;
  command.run();
  return true;
}



export const builtInShellCommands: readonly ShellCommand[] = [
  { id: "workbench.git", title: "Show Git", group: "Workbench", run: () => { setWorkbenchTab("git"); }},
  { id: "workbench.files", title: "Show Files", group: "Workbench", run: () => { setWorkbenchTab("files"); }},
  { id: "workbench.terminal", title: "Show Terminal", group: "Workbench", run: () => { setWorkbenchTab("terminal"); }},
  { id: "workbench.goals", title: "Show Goals", group: "Workbench", run: () => { setWorkbenchTab("goals"); }},
  { id: "layout.toggleNavigation", title: "Toggle navigation", group: "Window", hint: "⌘B", run: () => { togglePanel("navigation"); }},
  { id: "layout.toggleWorkbench", title: "Toggle workbench", group: "Window", hint: "⌘J", run: () => { togglePanel("workspace"); }},
];

/**
 * A command matches when every term the reader typed appears in its title, id,
 * owner, chord, or the keywords its owner supplied. Typing "kill" finds Stop;
 * "archive tree" finds the descendant archive.
 */
export function matchedCommands(commands: readonly ShellCommand[], filter: string): readonly ShellCommand[] {
  const terms = filter.trim().toLowerCase().split(/\s+/u).filter((term) => term !== "");
  if (terms.length === 0) return commands;
  return commands.filter((command) => {
    const haystack = [command.title, command.id, command.group, command.chord ?? "", ...(command.keywords ?? [])].join(" ").toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

/**
 * Commands grouped by their owner, for the palette.
 *
 * A command says who it belongs to ("Navigation", "Files", "Session"); the
 * palette lists them under those names, in the order the owners registered.
 */
export function shellCommandGroups(commands: readonly ShellCommand[]): readonly { group: string; items: ShellCommand[] }[] {
  const groups = new Map<string, ShellCommand[]>();
  for (const command of commands) {
    const existing = groups.get(command.group);
    if (existing === undefined) groups.set(command.group, [command]);
    else existing.push(command);
  }
  return [...groups.entries()].map(([group, items]) => ({ group, items }));
}
