import { setWorkbenchTab, togglePanel, type WorkbenchTab } from "./panels";
import { createStore, useStoreSelect, type ReadableStore } from "./store";

/**
 * The shell's command ledger.
 *
 * The command palette, the keyboard and the panels' own buttons all run the same
 * commands, so a command exists once. A panel contributes its commands while it
 * is mounted — the git panel contributes "Stage all", the files panel
 * "Refresh tree" — and the palette reads the registry. A command that is not
 * available states why (`disabled`), and an empty palette is never presented as
 * "no commands exist".
 */
export interface ShellCommand {
  readonly id: string;
  readonly title: string;
  readonly group: string;
  readonly hint?: string;
  readonly keywords?: readonly string[];
  readonly disabled?: string;
  run(): void;
}

const registry = createStore<readonly ShellCommand[]>([]);

export const commandRegistry: ReadableStore<readonly ShellCommand[]> = registry;

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

const workbenchCommandIds: Record<WorkbenchTab, string> = {
  git: "workbench.git",
  files: "workbench.files",
  terminal: "workbench.terminal",
  goals: "workbench.goals",
  plugin: "workbench.plugin",
};

export function selectWorkbenchTab(tab: WorkbenchTab, pluginId?: string): void {
  setWorkbenchTab(tab, pluginId);
}

export const builtInShellCommands: readonly ShellCommand[] = [
  { id: "workbench.git", title: "Show Git", group: "Workbench", run: () => setWorkbenchTab("git") },
  { id: "workbench.files", title: "Show Files", group: "Workbench", run: () => setWorkbenchTab("files") },
  { id: "workbench.terminal", title: "Show Terminal", group: "Workbench", run: () => setWorkbenchTab("terminal") },
  { id: "workbench.goals", title: "Show Goals", group: "Workbench", run: () => setWorkbenchTab("goals") },
  { id: "layout.toggleNavigation", title: "Toggle navigation", group: "Window", hint: "⌘B", run: () => togglePanel("navigation") },
  { id: "layout.toggleWorkbench", title: "Toggle workbench", group: "Window", hint: "⌘J", run: () => togglePanel("workspace") },
];
