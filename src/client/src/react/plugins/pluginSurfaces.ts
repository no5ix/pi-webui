import { pluginRegistry, usePluginBridge } from "./pluginBridge";
import { pluginRuntimeContext } from "./runtimeContext";
import type {
  QualifiedPluginAction,
} from "../../plugins/types";

/**
 * The contributions a React surface hosts, read from the one registry.
 *
 * Each hook subscribes to the plugin store, so a plugin that registers after the
 * page is open re-renders the surfaces that consume it, and then asks the
 * registry - which owns qualification, ordering and machine scoping - for exactly
 * what that surface renders. No surface walks the registry itself.
 */
/**
 * The answer the shell gives when a plugin asks for a surface it does not host:
 * the plugin's own page, in the shell that does. Saying it is honest; drawing a
 * tab with nothing behind it is the "wrong" that reads as data.
 */
export const unhostedPluginSurfaceMessage = "That page belongs to a plugin, and the React workspace does not host plugin pages yet. Open the same app with ?ui=legacy to use it.";

export function usePluginActions(): readonly QualifiedPluginAction[] {
  usePluginBridge();
  return pluginRegistry().getActions(pluginRuntimeContext());
}


/** The renderer a plugin claims for one message tag, tool name, or fence language. */

