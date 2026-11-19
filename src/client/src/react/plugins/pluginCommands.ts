import { useEffect, useMemo } from "react";
import { registerShellCommands, type ShellCommand } from "../state/shellCommands";
import { usePluginActions } from "./pluginSurfaces";
import type { QualifiedPluginAction } from "../../plugins/types";

/**
 * The actions plugins and the core plugin contribute, as shell commands.
 *
 * A contributed action already has a title, a group, a shortcut, an `enabled`
 * test and a reason for being unavailable; the palette is the surface that lists
 * commands, so the mapping is one-to-one and the shell adds nothing. The context
 * is read at the moment the command is invoked, not when the list is built, so a
 * plugin's action acts on the session that is open then.
 */
export function usePluginCommands(): void {
  const actions = usePluginActions();
  const commands = useMemo(() => actions.map(commandOfAction), [actions]);
  useEffect(() => registerShellCommands(commands), [commands]);
}

function commandOfAction(action: QualifiedPluginAction): ShellCommand {
  const disabled = action.enabled === false
    ? (action.disabledReason ?? `${action.title} is not available right now.`)
    : undefined;
  return {
    id: action.id,
    title: action.title,
    group: action.group ?? "Plugin",
    ...(action.description === undefined ? {} : { hint: action.description }),
    ...(action.shortcut === undefined ? {} : { chord: action.shortcut }),
    ...(disabled === undefined ? {} : { disabled }),
    keywords: [action.group ?? "plugin", ...action.title.toLowerCase().split(/\s+/u)],
    run: () => {
      void action.run();
    },
  };
}
