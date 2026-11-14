import type { PiSkillInfo, PiSkillOrigin, PiSkillPreference, PiSkillScope, PiSkillSetEnabledRequest, PiSkillsDiagnostic, PiSkillsScopeInfo } from "../../api";
import type { SettingsMachineTarget } from "./settingsMachineTarget";

/**
 * The skill requests and the words the Skills panel shows.
 *
 * The panel is a dumb executor: it asks for a switch on a row it is showing, and every decision
 * that carries product meaning - which scope a request is written to, what a saved preference means
 * against what Pi loaded, when an absence must be called "not read" - lives here, in one pure file.
 */

/** The skill switch the reader is waiting for: one row, named by the scope the row came from. */
export interface PiSkillOperationState {
  name: string;
  scope: PiSkillScope;
  enabled: boolean;
}

/** One scope's rows: the skills Pi found there, and the scope's own paths from the same response. */
export interface PiSkillScopeGroup {
  scope: PiSkillScope;
  skills: PiSkillInfo[];
  scopeInfo: PiSkillsScopeInfo | undefined;
}

const PI_SKILL_SCOPE_ORDER: readonly PiSkillScope[] = ["global", "project"];

export function piSkillScopeLabel(scope: PiSkillScope): string {
  return scope === "project" ? "Project" : "Global";
}

export function piSkillOriginLabel(origin: PiSkillOrigin): string {
  return PI_SKILL_ORIGIN_WORDS[origin];
}

const PI_SKILL_ORIGIN_WORDS: Readonly<Record<PiSkillOrigin, string>> = {
  agent: "Pi skill folder",
  project: "Project skill folder",
  package: "Pi package",
  path: "Configured skill path",
};

/** What the reader has saved for this skill name; `default` says plainly that nobody has. */
export function piSkillPreferenceLabel(preference: PiSkillPreference): string {
  return PI_SKILL_PREFERENCE_WORDS[preference];
}

const PI_SKILL_PREFERENCE_WORDS: Readonly<Record<PiSkillPreference, string>> = {
  default: "No saved preference: Pi decides",
  enabled: "Turned on in PI WEB settings",
  disabled: "Turned off in PI WEB settings",
};

export function piSkillEffectiveLabel(enabled: boolean): string {
  return enabled ? "In the list Pi is given" : "Not in the list Pi is given";
}

/**
 * Why a skill is not in the list, in the one case PI WEB can name.
 *
 * A Pi package that is filtered off supplies no skills, and a skill of its that reads as "off" is
 * not the reader's doing. Saying so is the difference between a switch that looks broken and a
 * reader who knows to turn the package on in the Pi Packages panel.
 */
export function piSkillOffReasonNote(info: PiSkillInfo): string | undefined {
  if (!info.enabled && info.ownerPackageDisabled === true) {
    return `Off because its Pi package ${info.packageSource ?? "package"} is turned off. Turn the package on in Pi Packages, then reload the session.`;
  }
  return undefined;
}

/**
 * What an empty scope's list means.
 *
 * An empty list is not "empty". When the panel has just said this scope's directory could not be
 * read, the scope must say its list is not known, not that nothing is configured — a reader who is
 * told "none" and then shown the notice that the same directory is unreadable is shown two answers.
 * A scope whose directory the server left unnamed is named by the scope, so the sentence never ends
 * in a blank.
 */
export function piSkillEmptyScopeNote(scope: PiSkillScope, scopeInfo: PiSkillsScopeInfo | undefined, unreadable: readonly PiSkillsDiagnostic[] | undefined): string {
  if (scopeInfo === undefined) return `No ${piSkillScopeLabel(scope).toLowerCase()} skills are listed, and this scope was not read.`;
  const skillsDir = scopeInfo.skillsDir;
  if (skillsDir !== "" && scopeHasUnreadableFile(skillsDir, unreadable)) return `The skills in ${skillsDir} were not read, so this list is not known.`;
  if (skillsDir === "") return `No ${piSkillScopeLabel(scope).toLowerCase()} skills are listed.`;
  return `No skills are configured in ${skillsDir}.`;
}

/** A read failure anywhere inside a scope's directory means that scope's list is not fully known. */
function scopeHasUnreadableFile(skillsDir: string, unreadable: readonly PiSkillsDiagnostic[] | undefined): boolean {
  return (unreadable ?? []).some((entry) => entry.path === skillsDir || entry.path?.startsWith(`${skillsDir}/`) === true);
}

/** A skill Pi kept from a stronger source, so this file is not the one the model sees. */
export function piSkillShadowedNote(info: PiSkillInfo): string | undefined {
  return info.shadowed === true ? `A skill named ${info.name} from a stronger source is the one Pi uses; this file is not loaded.` : undefined;
}

export function piSkillValidationNote(info: PiSkillInfo): string | undefined {
  if (info.validation === "valid") return undefined;
  return info.validationMessage ?? "Pi reported a problem with this skill file.";
}

/**
 * The rows grouped by the scope they were read for, in the order the panel shows them.
 *
 * A scope with no skills keeps its group: the group's own paths say which directory was read, so
 * an empty list under it stays "this directory has no skills", not "no skills anywhere".
 */
export function piSkillScopeGroups(skills: readonly PiSkillInfo[], scopes: readonly PiSkillsScopeInfo[]): PiSkillScopeGroup[] {
  return PI_SKILL_SCOPE_ORDER.map((scope) => ({
    scope,
    skills: skills.filter((skill) => skill.scope === scope),
    scopeInfo: scopes.find((entry) => entry.scope === scope),
  })).filter((group) => group.scope === "global" || group.scopeInfo !== undefined || group.skills.length > 0);
}

/**
 * The project scope in words.
 *
 * The response carries a project row only when the server read a project, so an absent row is
 * "not read" and is said that way; the panel never calls it empty.
 */
export function piSkillProjectScopeNote(scopes: readonly PiSkillsScopeInfo[]): string {
  const project = scopes.find((entry) => entry.scope === "project");
  if (project === undefined) {
    return "Project scope not read: PI WEB Settings has no project selected, so only this machine's global skills are listed.";
  }
  if (project.projectTrusted === false) {
    return `Project scope not read: ${project.projectPath ?? "this project"} is not trusted, so Pi does not load its skills.`;
  }
  return `Project scope read from ${project.projectPath ?? "the selected project"}.`;
}

/**
 * The request for one row's switch.
 *
 * The project id travels with the scope row it was read for, because the server resolves a project
 * scope from its own project store and a browser must never name a path.
 */
export function piSkillToggleRequest(
  info: Pick<PiSkillInfo, "name" | "scope">,
  enabled: boolean,
  scopes: readonly PiSkillsScopeInfo[],
): PiSkillSetEnabledRequest {
  const scopeInfo = scopes.find((entry) => entry.scope === info.scope);
  const projectId = scopeInfo?.projectId;
  return {
    name: info.name,
    scope: info.scope,
    enabled,
    ...(projectId === undefined || projectId === "" ? {} : { projectId }),
  };
}

export function isPiSkillTogglePending(operation: PiSkillOperationState | undefined, info: Pick<PiSkillInfo, "name" | "scope">, projectSelected = false): boolean {
  const preferenceScope: PiSkillScope = projectSelected ? "project" : info.scope;
  return operation?.name === info.name && operation.scope === preferenceScope;
}

export function piSkillMutationMessage(scope: PiSkillScope, name: string, enabled: boolean, target: SettingsMachineTarget): string {
  const targetSuffix = target.kind === "local" ? "" : ` on ${target.name}`;
  const sessionScope = target.kind === "local" ? "each idle PI WEB session" : `each idle PI WEB session on ${target.name}`;
  return `Skill ${name} ${enabled ? "turned on" : "turned off"}${targetSuffix}. Type /reload in ${sessionScope} to load the new skill list.`;
}
