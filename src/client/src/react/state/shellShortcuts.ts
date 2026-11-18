import { useEffect } from "react";
import { builtInShellCommands, registerShellCommands, runShellCommand, type ShellCommand } from "./shellCommands";
import type { WorkbenchTab } from "./panels";

/**
 * The shell's keyboard layer.
 *
 * One listener owns the window-wide chords; a panel that owns a key inside its
 * own surface (the composer's send, the file tree's rename) binds it itself. The
 * table is one place, so a chord cannot be claimed twice.
 */
export interface ShellShortcutHandlers {
  onCommandPalette: () => void;
  onQuickSwitcher: () => void;
  onSettings: () => void;
  onToggleNavigation: () => void;
  onToggleWorkbench: () => void;
  onWorkbenchTab: (tab: WorkbenchTab) => void;
}

const tabByKey: Record<string, WorkbenchTab> = {
  "1": "git",
  "2": "files",
  "3": "terminal",
  "4": "goals",
};

export function shellShortcutAction(key: string, meta: boolean, control: boolean, shift: boolean): ShellShortcutAction | undefined {
  if (!(meta || control)) return undefined;
  if (shift && key !== "p") return undefined;
  switch (key) {
    case "k":
      return "commandPalette";
    case "p":
      return shift ? "quickSwitcher" : undefined;
    case ",":
      return "settings";
    case "b":
      return "toggleNavigation";
    case "j":
      return "toggleWorkbench";
    default:
      return tabByKey[key] === undefined ? undefined : { tab: tabByKey[key] };
  }
}

export type ShellShortcutAction = "commandPalette" | "quickSwitcher" | "settings" | "toggleNavigation" | "toggleWorkbench" | { tab: WorkbenchTab };

export function useShellShortcuts(handlers: ShellShortcutHandlers): void {
  useEffect(() => {
    const commands: readonly ShellCommand[] = builtInShellCommands;
    const unregister = registerShellCommands(commands);
    const onKeyDown = (event: KeyboardEvent): void => {
      const action = shellShortcutAction(event.key.toLowerCase(), event.metaKey, event.ctrlKey, event.shiftKey);
      if (action === undefined) return;
      event.preventDefault();
      if (action === "commandPalette") handlers.onCommandPalette();
      else if (action === "quickSwitcher") handlers.onQuickSwitcher();
      else if (action === "settings") handlers.onSettings();
      else if (action === "toggleNavigation") handlers.onToggleNavigation();
      else if (action === "toggleWorkbench") handlers.onToggleWorkbench();
      else handlers.onWorkbenchTab(action.tab);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      unregister();
    };
  }, [handlers]);
}

export { runShellCommand };
