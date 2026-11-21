import type { PiPackageInfo, PiPackageInstallRequest, PiPackageMutationResponse, PiPackageRemoveRequest, PiPackageScope, PiPackagesResponse, PiPackageSetEnabledRequest, PiPackageUpdateRequest } from "../../api";

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
 * pi's update walks the configured entries of **both** scopes and advances the ones it knows how to
 * advance: an npm source with a range, and a git source (a `git:` source, a hosted `github:` source,
 * or an explicit `http(s)://`, `ssh://`, `git://`, `git@` URL). It skips a source pinned to one exact
 * version, and a source that names a folder on disk is not something pi advances — that folder is
 * the reader's own checkout. The scope never decides this, so the control is enabled by what the
 * source is, not by where it is registered: a project's npm package updates, and a global path
 * source does not.
 */
export function piPackageCanUpdate(source: string): boolean {
  return piPackageSourceKind(source) !== "local" && piPackageSourceKind(source) !== "pinned";
}

/** Why a row has no Update button, as the card states it. */
export function piPackageUpdateDisabledReason(source: string): string {
  const kind = piPackageSourceKind(source);
  if (kind === "pinned") return `This entry is pinned to one version (${source}), so pi's update leaves it alone.`;
  return "This package is a folder on disk, so pi's update does not touch it. Update it where you keep that folder.";
}

/**
 * What kind of source pi sees, by pi's own grammar.
 *
 * `npm:` is npm, and an entry whose version is one exact version is pinned (pi checks it with semver's
 * `valid`, so `npm:foo@1.2.3` is pinned and `npm:foo@^1.2.3` is not). `git:`, `github:` and an explicit
 * protocol URL are git. pi treats everything else — a bare name, a relative path, an absolute path, a
 * `file:` URL — as a local path, and this follows it rather than guessing.
 */
export function piPackageSourceKind(source: string): "npm" | "pinned" | "git" | "local" {
  const trimmed = source.trim();
  if (trimmed.startsWith("npm:")) return isExactNpmVersionSpec(trimmed.slice("npm:".length)) ? "pinned" : "npm";
  if (trimmed.startsWith("git:") || trimmed.startsWith("github:")) return "git";
  if (/^(https?:\/\/|ssh:\/\/|git:\/\/|git@)/i.test(trimmed)) return "git";
  return "local";
}

/**
 * True for a spec whose version is one exact version: `foo`, `@scope/foo` and `foo@^1.2.3` are not,
 * `foo@1.2.3` and `@scope/foo@1.2.3-beta.1+build` are.
 */
function isExactNpmVersionSpec(spec: string): boolean {
  const at = spec.lastIndexOf("@");
  if (at <= 0) return false;
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(spec.slice(at + 1));
}

/** The request that updates one row, naming the scope the row was read for. */
export function piPackageUpdateRequest(pkg: PiPackageInfo): PiPackageUpdateRequest {
  return { source: pkg.source, scope: pkg.scope };
}

/** The request that installs one source, in the scope the page chose. */
export function piPackageInstallRequest(source: string, scope: PiPackageScope): PiPackageInstallRequest {
  return { source, scope };
}

/**
 * The project a package write belongs to, added when the request speaks about the project scope.
 *
 * The server resolves an id to a directory, and a request that named a project it was not writing
 * would describe a write to a file the page is not showing. A machine-wide request carries none.
 */
export function piPackageScopedRequest<T extends { scope?: PiPackageScope; projectId?: string }>(request: T, projectId: string | undefined): T {
  if (request.scope !== "project" || projectId === undefined) return request;
  return { ...request, projectId };
}

/**
 * Whether the project half of the list is a fact, and why not when it is not.
 *
 * A project scope can be absent for three different reasons — the page selected no project, the
 * machine does not know the project, the project is not trusted — and an empty project section means
 * something different in each. The page states which, and never calls an unread scope an empty one.
 */
export type PiPackageProjectScopeState = "not-loaded" | "no-project" | "untrusted" | "read";

export function piPackageProjectScopeState(packages: PiPackagesResponse | undefined): PiPackageProjectScopeState {
  if (packages === undefined) return "not-loaded";
  if (packages.projectPath === undefined) return "no-project";
  return packages.projectTrusted === true ? "read" : "untrusted";
}

/** The state a project scope selector should show, in the page's words. */
export function piPackageProjectScopeNote(state: PiPackageProjectScopeState, projectName: string, machineLabel: string): string {
  if (state === "not-loaded") return piPackageNotLoadedNote();
  if (state === "no-project") return `No project is selected, so no project's packages are read. A machine-wide read reports the global scope only. Choose the project in the scope bar above.`;
  if (state === "untrusted") return `${projectName} is not trusted on ${machineLabel}, so its .pi/settings.json is not read and its packages are not installed, changed, or removed. Trust the project in pi first.`;
  return `The project scope was read from ${projectName}.`;
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

/** The scope the install field writes to, chosen by the page. */
export type PiPackageInstallScope = PiPackageScope;

/** The note shown above the install field, naming where an install is written. */
export function piPackageInstallTargetLabel(scope: PiPackageInstallScope, machineLabel: string, projectName: string): string {
  return scope === "project"
    ? `An install from this field is pi's local install for ${projectName}: it writes ${projectName}/.pi/settings.json on ${machineLabel} and is loaded by that project alone.`
    : `An install from this field is written to the global settings on ${machineLabel}, and applies to every project on it.`;
}

/**
 * Why the project scope cannot be chosen for an install.
 *
 * Installing into a project writes that project's settings and, on reload, runs that project's code,
 * so it is gated by pi's trust decision — and it needs a project at all. The selector says which.
 */
export function piPackageInstallProjectDisabledReason(state: PiPackageProjectScopeState, projectName: string): string | undefined {
  if (state === "no-project") return "Choose a project first: a project install writes that project's .pi/settings.json.";
  if (state === "untrusted") return `${projectName} is not trusted on this machine, so its package settings are not written.`;
  return undefined;
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
 * pi's bulk update walks both settings files of the machine it is pointed at, so the sentence names
 * the scopes the answer covers: the global list alone for a machine-wide read, and the project's
 * entries beside it when the page's project scope was read.
 */
export function piPackageUpdateAllMessage(response: PiPackagesResponse & { requiresReload?: boolean }): string {
  const global = response.packages.filter(pkg => pkg.scope === "user").length;
  const project = response.packages.filter(pkg => pkg.scope === "project").length;
  const counts = project === 0
    ? `${String(global)} ${global === 1 ? "package" : "packages"} in the global list`
    : `${String(global)} global and ${String(project)} project ${project === 1 ? "package" : "packages"}`;
  return `All packages pi can update were updated — ${counts}.${piPackageReloadNote(response)}`;
}

function piPackageMutationLead(response: PiPackageMutationResponse, verb: string): string {
  const source = response.source ?? "package";
  const scope = response.scope === undefined ? "" : ` (${piPackageScopeLabel(response.scope)})`;
  return `${verb} ${source}${scope}`;
}

function piPackageReloadNote(response: { requiresReload?: boolean }): string {
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

/** True when an "Update All" is worth offering: the bulk update walks the entries of both scopes. */
export function piPackageCanUpdateAll(packages: PiPackagesResponse | undefined): boolean {
  return (packages?.packages ?? []).some(pkg => piPackageCanUpdate(pkg.source));
}
