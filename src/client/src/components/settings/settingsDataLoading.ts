import type { PiMcpListResponse, PiPackagesResponse, PiSkillsResponse, PiWebConfigResponse, PiWebPluginsResponse } from "../../api";
import { settingsMachineTargetLabel, settingsReadFailureWords, type SettingsMachineTarget } from "./settingsMachineTarget";
import { describeError } from "../../notice";

export interface GatewaySettingsLoaders {
  loadConfig: () => Promise<PiWebConfigResponse>;
  loadPlugins: () => Promise<PiWebPluginsResponse>;
}

export interface GatewaySettingsLoadResult {
  config?: PiWebConfigResponse;
  plugins?: PiWebPluginsResponse;
  error: string;
}

export async function loadGatewaySettingsData(loaders: GatewaySettingsLoaders): Promise<GatewaySettingsLoadResult> {
  const [config, plugins] = await Promise.allSettled([loaders.loadConfig(), loaders.loadPlugins()]);
  const result: GatewaySettingsLoadResult = { error: "" };
  const errors: string[] = [];

  if (config.status === "fulfilled") result.config = config.value;
  else errors.push(`config: ${describeError(config.reason)}`);

  if (plugins.status === "fulfilled") result.plugins = plugins.value;
  else errors.push(`PI WEB plugins: ${describeError(plugins.reason)}`);

  if (errors.length > 0) result.error = `Failed to load settings: ${errors.join("; ")} · trying again…`;
  return result;
}

export async function loadPiPackagesData(target: SettingsMachineTarget, loadPackages: (targetId: string) => Promise<PiPackagesResponse>) {
  try {
    return { packagesResponse: await loadPackages(target.id), error: "" };
  } catch (error) {
    return { error: `Failed to load Pi packages from ${settingsMachineTargetLabel(target)}: ${settingsReadFailureWords(describeError(error), target)} · trying again…` };
  }
}

/**
 * The skills of one machine, and of the project this read is about.
 *
 * A read that failed carries no list: the panel then says the list is not loaded, and never that the
 * machine has no skills.
 */
export async function loadPiSkillsData(target: SettingsMachineTarget, loadSkills: (targetId: string) => Promise<PiSkillsResponse>) {
  try {
    return { skillsResponse: await loadSkills(target.id), error: "" };
  } catch (error) {
    return { error: `Failed to load skills from ${settingsMachineTargetLabel(target)}: ${settingsReadFailureWords(describeError(error), target)} · trying again…` };
  }
}

/** The MCP servers of one machine, with the same rule: a failed read carries no rows to draw. */
export async function loadPiMcpData(target: SettingsMachineTarget, loadServers: (targetId: string) => Promise<PiMcpListResponse>) {
  try {
    return { mcpResponse: await loadServers(target.id), error: "" };
  } catch (error) {
    return { error: `Failed to load MCP servers from ${settingsMachineTargetLabel(target)}: ${settingsReadFailureWords(describeError(error), target)} · trying again…` };
  }
}
