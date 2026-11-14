import type { PiPackageInfo, PiPackageMutationAction, PiPackageScope } from "../../api";
import { settingsMachineTarget, type SettingsMachineTarget } from "./settingsMachineTarget";

export type PiPackageOperationKind = "install" | "update" | "update-all" | "set-enabled";

/**
 * The package operation the reader is waiting for.
 *
 * A scope travels with the source because the same source can be configured at user and project
 * scope at once, and only the row that was pressed may show that it is working.
 */
export interface PiPackageOperationState {
  kind: PiPackageOperationKind;
  source?: string;
  scope?: PiPackageScope;
}

export function shouldRefreshGatewayPluginsAfterPiPackageMutation(target: SettingsMachineTarget): boolean {
  return target.kind === "local";
}

export function normalizePiPackageSource(source: string): string {
  return source.trim();
}

export function piPackageSourceValidationMessage(source: string): string | undefined {
  if (normalizePiPackageSource(source) !== "") return undefined;
  return "Enter a Pi package source accepted by Pi, such as npm:@scope/package, a git/URL source, or a local path.";
}

export function piPackageScopeLabel(packageInfo: Pick<PiPackageInfo, "scope">): string {
  return packageInfo.scope === "project" ? "Project scope" : "User scope";
}

export function piPackageFilteredLabel(packageInfo: Pick<PiPackageInfo, "filtered">): string {
  return packageInfo.filtered ? "Filtered by current Pi package settings" : "Available in this PI WEB process";
}

export function piPackageInstalledPathLabel(packageInfo: Pick<PiPackageInfo, "installedPath">): string {
  return packageInfo.installedPath ?? "Installed path not reported by Pi";
}

export function canUpdatePiPackage(packageInfo: Pick<PiPackageInfo, "scope">): boolean {
  return packageInfo.scope === "user";
}

export function piPackageUpdateDisabledReason(packageInfo: Pick<PiPackageInfo, "scope">): string | undefined {
  if (canUpdatePiPackage(packageInfo)) return undefined;
  return "Project-scope Pi packages are listed for visibility, but PI WEB only updates user-scope Pi packages safely from this view.";
}

export function canUpdateAllPiPackages(packages: readonly Pick<PiPackageInfo, "scope">[]): boolean {
  return packages.length > 0 && packages.every(canUpdatePiPackage);
}

export function updateAllPiPackagesDisabledReason(packages: readonly Pick<PiPackageInfo, "scope">[]): string | undefined {
  if (packages.length === 0) return "No Pi packages are configured yet.";
  if (canUpdateAllPiPackages(packages)) return undefined;
  return "Update all is disabled while project-scope Pi packages are listed; update user-scope packages individually.";
}

export function isPiPackageOperationPending(operation: PiPackageOperationState | undefined, kind: PiPackageOperationKind, source?: string): boolean {
  if (operation?.kind !== kind) return false;
  return source === undefined || operation.source === source;
}

/**
 * The state the enable/disable switch reports.
 *
 * Pi's package filter is what "off" means: the package stays installed and stays configured, and it
 * contributes no extension, skill, prompt template, theme, or context file. A filtered package that
 * is not switched off is a filter PI WEB did not write, so the two words stay apart.
 */
export function piPackageEnabledLabel(packageInfo: Pick<PiPackageInfo, "enabled" | "disabled" | "filtered">): string {
  if (packageInfo.enabled) return "Enabled";
  if (packageInfo.disabled) return "Turned off in Pi package settings";
  return "Filtered by Pi package settings";
}

/**
 * What turning a package on asks of a running session.
 *
 * A settings file that says "enabled" is not a session that has loaded the package: pi reads its
 * packages when a session starts, and `/reload` is what re-runs that discovery.
 */
export function piPackageToggleReloadNote(target: SettingsMachineTarget = settingsMachineTarget(undefined)): string {
  const sessionScope = target.kind === "local" ? "each idle PI WEB session" : `each idle PI WEB session on ${target.name}`;
  return `Turning a package on or off writes Pi's package settings. A running session keeps what it loaded: type /reload in ${sessionScope} to load or drop its extensions, skills, prompt templates, themes, and context files.`;
}

export function piPackageMutationFollowUpMessage(action: PiPackageMutationAction, target = settingsMachineTarget(undefined)): string {
  const verb = action === "install" ? "installed" : action === "remove" ? "removed" : action === "set-enabled" ? "enabled or disabled" : "updated";
  const targetSuffix = target.kind === "local" ? "" : ` on ${target.name}`;
  const sessionScope = target.kind === "local" ? "each idle PI WEB session" : `each idle PI WEB session on ${target.name}`;
  const pluginScope = target.kind === "local" ? "PI WEB browser plugin changes" : `PI WEB browser plugin changes served by ${target.name}`;
  return `Pi package ${verb}${targetSuffix}. Type /reload in ${sessionScope} to rediscover Pi runtime resources: extensions, skills, prompt templates, themes, and context/system prompt files. Reload the browser page separately for ${pluginScope}.`;
}

export function friendlyPiPackageErrorMessage(message: string, target: SettingsMachineTarget): string {
  const normalized = message.trim();
  if (target.kind !== "remote") return normalized;
  if (normalized === "Remote machine timeout") {
    return `Timed out while contacting ${target.name} for Pi package management. The package operation may still be running remotely; reload the package list before retrying.`;
  }
  if (normalized === "Remote machine unavailable") {
    return `Could not reach ${target.name} for Pi package management. Check the machine connection and try again.`;
  }
  return normalized;
}
