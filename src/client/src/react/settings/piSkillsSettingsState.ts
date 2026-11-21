import type { PiSkillInfo, PiSkillScope, PiSkillSetEnabledRequest, PiSkillSetEnabledResponse, PiSkillsDiagnostic, PiSkillsScopeInfo } from "../../api";

/**
 * The rules behind the Skills page, away from the page.
 *
 * A skill's scope is where pi read it, and that is what a switch writes: a row in the project scope
 * writes the project's settings, a row in the global scope writes the machine's. pi answers a switch
 * with the whole list it read for one scope, so the page has no way to mark one row as changed — it
 * replaces the list and says which scope answered. A name pi read in both scopes is two rows with two
 * identities and two saved answers, and pi's discovery decides which one is used, so the page says so
 * beside the row rather than hiding the other row. These helpers state that once, apart from the
 * component, so each rule is one test.
 */

/** The skills of one scope, in the order pi answered them. */
export function piSkillScopeRows(skills: PiSkillInfo[], scope: PiSkillScope): PiSkillInfo[] {
  return skills.filter(skill => skill.scope === scope);
}

/** The rows the page lists under Global skills. */
export function piSkillGlobalRows(skills: PiSkillInfo[]): PiSkillInfo[] {
  return piSkillScopeRows(skills, "global");
}

/** The rows the page lists under Project skills. */
export function piSkillProjectRows(skills: PiSkillInfo[]): PiSkillInfo[] {
  return piSkillScopeRows(skills, "project");
}

/**
 * The switch request for one row.
 *
 * The request carries the row's identity and its scope, and no project: the scope is what says which
 * file pi writes, and the server resolves the project the request is answered for.
 */
export function piSkillSetEnabledRequest(skill: PiSkillInfo, enabled: boolean): PiSkillSetEnabledRequest {
  return { id: skill.id, name: skill.name, scope: skill.scope, enabled };
}

/** The key one row's pending state is tracked by: pi's identity, which is unique per row. */
export function piSkillRowKey(skill: PiSkillInfo): string {
  return JSON.stringify([skill.scope, skill.id]);
}

/** True while a row's switch is in flight, so the page blocks it. */
export function isPiSkillTogglePending(busy: Record<string, string>, skill: PiSkillInfo): boolean {
  return busy[piSkillRowKey(skill)] !== undefined;
}

/** True while any skills write is in flight. */
export function piSkillAnyPending(busy: Record<string, string>): boolean {
  return Object.keys(busy).length > 0;
}

/** The message shown while a write runs, naming the row that is working. */
export function piSkillBusyMessage(busy: Record<string, string>): string | undefined {
  const [first] = Object.values(busy);
  if (first === undefined) return undefined;
  return `${first} — skill controls are disabled while it runs.`;
}

/** The test id one row carries. */
export function piSkillRowTestId(skill: PiSkillInfo): string {
  return `react-skills-row-${skill.scope}-${skill.id}`;
}

/** Where pi read the skill from, as pi's own word. */
export function piSkillOriginLabel(origin: PiSkillInfo["origin"]): string {
  if (origin === "agent") return "user (global)";
  if (origin === "project") return "project";
  if (origin === "path") return "path";
  return "package (installed)";
}

/**
 * The preference a row reports, with the file that answered.
 *
 * `enabled` alone cannot say which of two files to go change, and those are two scopes, so the row
 * states which saved entry answered: the project's, the machine's, or pi's default.
 */
export function piSkillPreferenceLabel(skill: PiSkillInfo): string {
  const saved = skill.answeredBy === "project"
    ? "saved in project settings"
    : skill.answeredBy === "global"
      ? "saved in global settings"
      : "no saved entry — pi's default";
  return `${skill.preference} · ${saved}`;
}

/** A row's status. */
export function piSkillStatus(skill: PiSkillInfo): { label: "On" | "Off"; off: boolean } {
  return skill.enabled ? { label: "On", off: false } : { label: "Off", off: true };
}

/** Why a row is shown as not used, when a stronger source wins. */
export function piSkillShadowedNote(skill: PiSkillInfo): string | undefined {
  return skill.shadowed === true
    ? `Not used: a skill named "${skill.name}" from a stronger source is the one pi keeps.`
    : undefined;
}

/** The note a row carries when it is in the list in place of a skill the reader turned off. */
export function piSkillPromotedNote(skill: PiSkillInfo): string | undefined {
  return skill.promoted === true
    ? `Loaded in place of a skill named "${skill.name}" that was turned off.`
    : undefined;
}

/**
 * The note a row carries when the package that supplies it is filtered off.
 *
 * A filtered package supplies nothing, so switching the skill alone does not bring it back: the note
 * says so, because the reader would otherwise press a switch that changes nothing they can see.
 */
export function piSkillOwnerPackageNote(skill: PiSkillInfo): string | undefined {
  return skill.ownerPackageDisabled === true
    ? `Supplied by ${skill.packageSource ?? "a package"} that is turned off, so it does not load. Enable that package in Pi Packages.`
    : undefined;
}

/**
 * A row's validation, and what to do about it.
 *
 * pi reports a skill whose definition it could not accept, and the page shows which file to open: such a
 * skill is a row the reader has to fix on disk, not a switch that is not working.
 */
export function piSkillValidationNote(skill: PiSkillInfo): string | undefined {
  if (skill.validation === "valid") return undefined;
  return `Validation ${skill.validation}${skill.validationMessage === undefined ? "" : `: ${skill.validationMessage}`} — edit ${skill.filePath}`;
}

/** The response's diagnostics, as lines, each naming the file pi read. */
export function piSkillDiagnosticsLines(diagnostics: PiSkillsDiagnostic[]): string[] {
  return diagnostics.map(diagnostic => `${diagnostic.path ?? "skills"} — ${diagnostic.message}`);
}

/** The skill paths pi could not read, as lines, so a short list is not silently short. */
export function piSkillUnreadableLines(unreadable: PiSkillsDiagnostic[]): string[] {
  return unreadable.map(diagnostic => `${diagnostic.path ?? "a skill path"} — ${diagnostic.message}`);
}

/** The directories pi searched, per scope, as one line each. */
export function piSkillDirectoryLines(scopes: PiSkillsScopeInfo[]): string[] {
  return scopes.map(scope => `${scope.scope === "project" ? "Project" : "Global"} skills: ${scope.skillsDir} · settings: ${scope.configPath}`);
}

/** The scope note shown above each list, naming the file a switch writes. */
export function piSkillScopeNote(scope: PiSkillScope, count: number, projectName: string, machineLabel: string): string {
  return scope === "global"
    ? `Global skills on ${machineLabel}: ${String(count)} ${count === 1 ? "skill" : "skills"}, read from the user's skill directories. A switch writes the machine's settings.`
    : `Project skills for ${projectName}: ${String(count)} ${count === 1 ? "skill" : "skills"}, read from this project's skill directories. A switch writes the project's settings.`;
}

/** The note shown when the page has no project, so project skills cannot be read. */
export function piSkillNoProjectNote(): string {
  return "No project is selected, so project skills are not read. Global skills are listed below.";
}

/** The note shown when a selected project answers with no skills. */
export function piSkillProjectEmptyNote(): string {
  return "This project has no skills. Add one under the project's .pi/skills/, or point pi at a skill directory in its settings.";
}

/** The note shown while the machine has not answered for the skills page yet. */
export function piSkillNotLoadedNote(): string {
  return "Skills have not been read yet. Reload asks the machine to read them again.";
}

/** The note shown when the machine answers with no global skills. */
export function piSkillGlobalEmptyNote(projectName?: string): string {
  return projectName === undefined
    ? "No skills were returned for this machine."
    : `No skills were returned for this machine, and ${projectName} has none in its skill directories.`;
}

/**
 * The message a switch leaves.
 *
 * pi answers with the whole list it read for one scope, and `requiresReload` is pi's own note that a
 * running session keeps the skills it loaded. The message names the scope that answered, because that is
 * the file that changed.
 */
export function piSkillMutationMessage(response: PiSkillSetEnabledResponse, enabled: boolean): string {
  const scope = response.skills[0]?.scope === "project" ? "Project skills" : "Global skills";
  const reload = response.requiresReload ? " Reload running sessions to apply it." : "";
  return `${scope} saved — ${enabled ? "enabled" : "disabled"}.${reload}`;
}

/**
 * The names answered more than once in one response, across both scopes.
 *
 * A name answered for the project and for the machine is two rows with two identities and two saved
 * answers, and pi's discovery decides which one is used. The page notes it beside the row rather than
 * hiding the other row.
 */
export function piSkillDuplicateNames(skills: PiSkillInfo[]): string[] {
  const counts = new Map<string, number>();
  for (const skill of skills) counts.set(skill.name, (counts.get(skill.name) ?? 0) + 1);
  return [...counts.entries()].filter(([, count]) => count > 1).map(([name]) => name);
}

/** The note beside a row whose name is answered in more than one scope. */
export function piSkillDuplicateNameNote(skill: PiSkillInfo, duplicates: string[]): string | undefined {
  if (!duplicates.includes(skill.name)) return undefined;
  const other = skill.scope === "project" ? "global" : "project";
  return `The name "${skill.name}" is also answered for the ${other} scope. Switch the row whose scope you mean.`;
}

/** True when a row's switch is blocked because its supplying package is filtered off. */
export function piSkillRowBlockedByPackage(skill: PiSkillInfo): boolean {
  return skill.ownerPackageDisabled === true;
}
