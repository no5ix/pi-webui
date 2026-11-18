import { pluginsApi } from "../../api/clients";
import { requestPluginBackend } from "../../api/pluginBackends";
import type { JsonValue } from "../../../../shared/pluginApiTypes";

/**
 * A plugin's server backend, addressed the way the app addresses it.
 *
 * A plugin backend is called by id and by the revision the machine has live. The
 * catalogue answers the revision, and its failures are the reasons a panel
 * states: not installed, disabled, backend not started.
 */
export interface PluginBackendScope {
  readonly machineId: string;
  readonly projectId: string;
  readonly workspaceId: string;
}

export async function pluginBackendRevision(machineId: string, pluginId: string): Promise<string> {
  const catalog = await pluginsApi.plugins(machineId);
  const entry = catalog.plugins.find((plugin) => plugin.id === pluginId);
  if (entry === undefined) throw new Error(`The ${pluginId} plugin is not installed on machine ${machineId}.`);
  if (!entry.enabled) throw new Error(`The ${pluginId} plugin is disabled on this machine.`);
  const revision = entry.server?.activeRevision;
  if (revision === undefined) throw new Error(`The ${pluginId} plugin's server backend has not started on this machine.`);
  return revision;
}

export async function callPluginBackend(
  pluginId: string,
  scope: PluginBackendScope,
  operation: string,
  input: JsonValue,
): Promise<unknown> {
  const backendRevision = await pluginBackendRevision(scope.machineId, pluginId);
  return requestPluginBackend(
    { pluginId, backendRevision, machineId: scope.machineId, projectId: scope.projectId, workspaceId: scope.workspaceId },
    operation,
    input,
  );
}
