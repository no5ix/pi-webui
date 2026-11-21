import type { PiPackageInfo, PiPackageMutationResponse, PiPackageRemoveRequest, PiPackageScope, PiPackagesResponse, PiPackageSetEnabledRequest } from "../../api";

/**
 * The rules behind the Pi Packages page, away from the page.
 *
 * A package row is addressed by its source, and the scope pi read it from is what a control writes and
 * what it destroys: a package registered in a project's settings belongs to that project alone, and a
 * package in the user's settings is loaded by every project on the machine. The same source string in
 * two scopes is two rows, so the page lists one row per scope and a control is enabled by the scope the
 * row carries. Removal is irreversible and depends on that scope, so the question a removal asks names
 * it. These helpers state that once, apart from the component, so each rule is one test.
 */

/** The rows of one scope, in the order pi answered them. */
export function piPackageScopeRows(packages: PiPackagesResponse | undefined, scope: PiPackageScope): PiPackageInfo[] {
  return (packages?.packages ?? []).filter(pkg => pkg.scope === scope);
}

/** The rows the page lists under Global packages: the entries in the user's settings. */
export function piPackageGlobalRows(packages: PiPackagesResponse | undefined): PiPackageInfo[] {
  return piPackageScopeRows(packages, "user");
}

/** The rows the page lists under Project packages: the entries in a project's settings. */
export function piPackageProjectRows(packages: PiPackagesResponse | undefined): PiPackageInfo[] {
  return piPackageScopeRows(packages, "project");
}

/** True when the page has nothing to list in either scope. */
export function piPackageListsEmpty(packages: PiPackagesResponse | undefined): boolean {
  return (packages?.packages ?? []).length === 0;
}

/**
 * True when a row can be updated.
 *
 * pi updates a package from the settings entry it is written in, and a package registered in a
 * project's settings is that project's own checkout: pi has no command that advances it, so the row is
 * shown with an explanation instead of a button.
 */
export function piPackageCanUpdate(scope: PiPackageScope): boolean {
  return scope === "user";
}

/** Why a row has no Update button, as the card states it. */
export function piPackageUpdateDisabledReason(scope: PiPackageScope): string {
  return scope === "project"
    ? "This package is registered in the project's settings. Update it where you keep that folder."
    : "This package scope has no update command.";
}

/** The request that updates one row, naming the scope the row was read for. */
export function piPackageUpdateRequest(pkg: PiPackageInfo): { source: string; scope: PiPackageScope } {
  return { source: pkg.source, scope: pkg.scope };
}

/** The request that removes one row. */
export function piPackageRemoveRequest(source: string, scope: PiPackageScope): PiPackageRemoveRequest {
  return { source, scope };
}

/** The request that switches one row. */
export function piPackageSetEnabledRequest(source: string, scope: PiPackageScope, enabled: boolean): PiPackageSetEnabledRequest {
  return { source, scope, enabled };
}

/** The key one row's pending state is tracked by: its scope and its source. */
export function piPackageRowKey(scope: PiPackageScope, source: string): string {
  return JSON.stringify([scope, source]);
}

/** True while a row has a write in flight. */
export function piPackageRowPending(busy: Record<string, string>, pkg: PiPackageInfo): boolean {
  return busy[piPackageRowKey(pkg.scope, pkg.source)] !== undefined;
}

/** True while any package write is in flight. */
export function piPackageAnyPending(busy: Record<string, string>): boolean {
  return Object.keys(busy).length > 0;
}

/** The message shown while a write runs, naming the row that is working. */
export function piPackageBusyMessage(busy: Record<string, string>): string | undefined {
  const [first] = Object.values(busy);
  if (first === undefined) return undefined;
  return `${first} — package controls are disabled while it runs.`;
}

/** The scope label the page shows. pi calls the machine's scope "user"; the page calls it Global. */
export function piPackageScopeLabel(scope: PiPackageScope): string {
  return scope === "project" ? "Project" : "Global";
}

/** A row's status. */
export function piPackageStatus(pkg: PiPackageInfo): { label: "On" | "Off" | "Filtered off"; off: boolean } {
  if (pkg.filtered) return { label: "Filtered off", off: true };
  return pkg.enabled ? { label: "On", off: false } : { label: "Off", off: true };
}

/**
 * The note a filtered row carries.
 *
 * A filtered package is configured and switched off by pi's own settings filter, which is a different
 * state from "not installed" and from "disabled here": the reader turns it back on in pi's filter, not
 * at this switch.
 */
export function piPackageFilteredNote(pkg: PiPackageInfo): string | undefined {
  return pkg.filtered
    ? "Filtered off by pi's package filter, so none of its resources load. Clear the filter in pi's settings to load it."
    : undefined;
}

/** Where pi loaded the package from, when pi reports a path. */
export function piPackageInstallPath(pkg: PiPackageInfo): string | undefined {
  return pkg.installedPath;
}

/** The test id one row carries, scoped so two scopes that share a source get distinct rows. */
export function piPackageRowTestId(pkg: PiPackageInfo): string {
  return `react-packages-row-${pkg.scope}-${pkg.source}`;
}

/** The counts of the two lists, for the page's summary. */
export function piPackageScopeCounts(packages: PiPackagesResponse | undefined): { global: number; project: number } {
  return { global: piPackageGlobalRows(packages).length, project: piPackageProjectRows(packages).length };
}

/** The scope note, naming where a row's settings live. */
export function piPackageScopeNote(scope: PiPackageScope, count: number, projectName: string, machineLabel: string): string {
  return scope === "user"
    ? `Global packages on ${machineLabel}: ${String(count)} ${count === 1 ? "package" : "packages"}. A global package is loaded by every project on this machine, and its settings are kept in the user's pi settings.`
    : `Project packages for ${projectName}: ${String(count)} ${count === 1 ? "package" : "packages"}. A project package is loaded by this project only, and its settings are kept in the project's .pi/settings.json.`;
}

/** The note shown above the install field, naming where an install is written. */
export function piPackageInstallTargetLabel(machineLabel: string): string {
  return `An install from this field is written to the global settings on ${machineLabel}, and applies to every project on it.`;
}

/** The note shown when a scope answers with no packages. */
export function piPackageEmptyNote(scope: PiPackageScope, projectName: string): string {
  return scope === "project"
    ? `${projectName} has no packages. Add one to the project's .pi/settings.json.`
    : "No packages are installed on this machine.";
}

/**
 * The note for an empty global section once the machine has answered.
 *
 * An empty section can mean two different things: the machine's list is empty, or its list carries
 * entries this page does not manage. Saying "no packages" for the second would be a lie about the file.
 */
export function piPackageGlobalEmptyStateNote(packages: PiPackagesResponse | undefined, projectName: string): string {
  if (packages === undefined) return piPackageNotLoadedNote();
  return piPackageListsEmpty(packages)
    ? piPackageEmptyNote("user", projectName)
    : "The machine reported packages, and none of them is in a scope this page manages.";
}

/** The note shown while the machine has not answered for the packages page yet: an empty section here is an unloaded one. */
export function piPackageNotLoadedNote(): string {
  return "The package list has not been read yet. Reload asks the machine to read it again.";
}

/**
 * The message an install leaves.
 *
 * `requiresReload` is pi's note that a running session keeps the packages it started with. It is a fact
 * about the sessions, not this page's doing, so the message carries it as pi states it.
 */
export function piPackageInstallMessage(response: PiPackageMutationResponse): string {
  return `${piPackageMutationLead(response, "Installed")}.${piPackageReloadNote(response)}`;
}

/** The message an update leaves, naming the source the answer carries. */
export function piPackageUpdateMessage(response: PiPackageMutationResponse): string {
  return `${piPackageMutationLead(response, "Update completed for")}.${piPackageReloadNote(response)}`;
}

/**
 * The message a removal leaves.
 *
 * pi answers a removal with the fact of whether its settings carried the entry, and the page states
 * that fact: a removal that found nothing at the scope it was given is reported as nothing removed,
 * not as a removal. The list below the message is the machine's current answer either way, so a page
 * that claimed a removal the file does not show would be describing a change the reader cannot see.
 */
export function piPackageRemoveMessage(response: PiPackageMutationResponse): string {
  if (response.removed === false) return piPackageRemoveRefusedMessage(response);
  return `${piPackageMutationLead(response, "Removed")}.${piPackageReloadNote(response)}`;
}

function piPackageRemoveRefusedMessage(response: PiPackageMutationResponse): string {
  const source = response.source ?? "package";
  const scope = response.scope === undefined ? "the settings pi read" : `${piPackageScopeLabel(response.scope)} settings`;
  return `Nothing was removed: ${source} is not configured in ${scope}. The list below is what the machine reports now.`;
}

/** The message an enable or disable leaves. */
export function piPackageEnabledMessage(response: PiPackageMutationResponse): string {
  return `${piPackageMutationLead(response, response.enabled === true ? "Enabled" : "Disabled")}.${piPackageReloadNote(response)}`;
}

/**
 * The message an "Update All" leaves.
 *
 * pi runs the bulk update over the global settings and answers with the list it re-read, so the message
 * counts the rows that list covers.
 */
export function piPackageUpdateAllMessage(response: PiPackageMutationResponse): string {
  const count = response.packages.length;
  return `All global packages updated — ${String(count)} ${count === 1 ? "package" : "packages"} in the list.${piPackageReloadNote(response)}`;
}

function piPackageMutationLead(response: PiPackageMutationResponse, verb: string): string {
  const source = response.source ?? "package";
  const scope = response.scope === undefined ? "" : ` (${piPackageScopeLabel(response.scope)})`;
  return `${verb} ${source}${scope}`;
}

function piPackageReloadNote(response: PiPackageMutationResponse): string {
  return response.requiresReload === true ? " Reload running sessions to apply it." : "";
}

/**
 * The question a removal asks.
 *
 * Removal is the one action here the next page view does not undo, and what it touches depends on the
 * scope the row carries: a project row's removal is kept in that project's settings, a global row's
 * removal changes the machine's settings, which every project on it reads.
 */
export function piPackageRemoveQuestion(pkg: PiPackageInfo): string {
  const scope = pkg.scope === "project" ? "the current project's settings" : "the machine's global settings";
  const target = piPackageInstallPath(pkg);
  const where = target === undefined ? "" : ` pi loaded it from ${target}.`;
  return `Remove ${pkg.source} from ${scope}? This forgets the entry and stops loading the package.${where}`;
}

/** True when an "Update All" is worth offering: the bulk update runs over the global entries. */
export function piPackageCanUpdateAll(packages: PiPackagesResponse | undefined): boolean {
  return piPackageGlobalRows(packages).length > 0;
}
