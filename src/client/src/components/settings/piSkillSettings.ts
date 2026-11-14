import type { PiSkillInfo, PiSkillOrigin, PiSkillPreference, PiSkillScope, PiSkillSetEnabledRequest, PiSkillsDiagnostic, PiSkillsScopeInfo } from "../../api";
import type { SettingsMachineTarget } from "./settingsMachineTarget";

/**
 * The skill requests and the words the Skills panel shows.
 *
 * The panel is a dumb executor: it asks for a switch on a row it is showing, and every decision
 * that carries product meaning - which scope a request is written to, what a saved preference means
 * against what Pi loaded, when an absence must be called "not read" - lives here, in one pure file.
 */

/** The skill switch the reader is waiting for: one row, named by the skill's identity. */
export interface PiSkillOperationState {
  /** The row's identity. Empty for a machine that answers switches by name, in which case the name is the key. */
  id: string;
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

const PI_SKILL_SCOPE_ORDER: readonly PiSkillScope[] = ["project", "global"];

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

/**
 * What the reader has saved for this skill, and the scope that saved it.
 *
 * "Turned off" is half an answer: a project's own entry and the machine's entry are different files,
 * and a reader who is trying to work out why a skill is missing needs to know which one said so.
 * Nothing written anywhere is Pi's default, and that is said plainly.
 */
export function piSkillPreferenceNote(info: Pick<PiSkillInfo, "preference" | "answeredBy">): string {
  if (info.preference === "default") return PI_SKILL_PREFERENCE_WORDS.default;
  const scope: PiSkillScope = info.answeredBy === "project" ? "project" : "global";
  return PI_SKILL_PREFERENCE_NOTES[info.preference === "enabled" ? "enabled" : "disabled"][scope];
}

const PI_SKILL_PREFERENCE_WORDS: Readonly<Record<PiSkillPreference, string>> = {
  default: "No saved preference: Pi decides",
  enabled: "Turned on in PI WEB settings",
  disabled: "Turned off in PI WEB settings",
};

const PI_SKILL_PREFERENCE_NOTES: Readonly<Record<"enabled" | "disabled", Record<PiSkillScope, string>>> = {
  enabled: { project: "Turned on for this project", global: "Turned on on this machine" },
  disabled: { project: "Turned off for this project", global: "Turned off on this machine" },
};

/** A project's entry that answers over the machine's, said as the override it is. */
export function piSkillOverrideNote(info: Pick<PiSkillInfo, "preference" | "answeredBy">): string | undefined {
  if (info.answeredBy !== "project" || info.preference === "default") return undefined;
  return "This project's saved answer overrides this machine's answer for this skill. This machine's answer is left exactly as it was.";
}

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
  if (info.shadowed !== true) return undefined;
  return `Pi keeps one skill per name, and a same-named skill from a stronger source is the one it loads, so this file is not in a session. Turn this row on, then turn off the skill that is loaded, and this file takes its place.`;
}

/** The skill the plan promoted, in the reader's own words. */
export function piSkillPromotionNote(info: PiSkillInfo): string | undefined {
  if (info.promoted !== true) return undefined;
  return `In the list Pi is given in place of a same-named skill that is turned off, because this skill was turned on.`;
}

/**
 * The display names more than one row carries.
 *
 * A skill's name is front matter, and Pi's own loader proves two skills can share one: it keeps one
 * and shadows the rest. The panel shows both rows, so a reader needs to be told the two are not the
 * same skill, and which of them a switch speaks for.
 */
export function piSkillDuplicateNames(skills: readonly Pick<PiSkillInfo, "name">[]): ReadonlySet<string> {
  const counts = new Map<string, number>();
  for (const skill of skills) counts.set(skill.name, (counts.get(skill.name) ?? 0) + 1);
  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([name]) => name));
}

/**
 * The words that name this row for a screen reader.
 *
 * Two rows can share a name, a scope and a source (a machine-wide skill in two configured paths, for
 * instance), so the skill file is what tells them apart: it is the thing the identity is built from and
 * the thing the row says it switches.
 */
export function piSkillRowLabel(info: PiSkillInfo, duplicates: ReadonlySet<string>): string {
  const base = `${piSkillScopeLabel(info.scope)} skill ${info.name}`;
  return duplicates.has(info.name) ? `${base}, ${piSkillOriginLabel(info.origin)}, ${info.filePath}` : base;
}

/** Why two rows carry the same name, and what makes this one the skill it is. */
export function piSkillDuplicateNameNote(info: PiSkillInfo, duplicates: ReadonlySet<string>): string | undefined {
  if (!duplicates.has(info.name)) return undefined;
  return `More than one skill is named "${info.name}". This row is the ${piSkillScopeLabel(info.scope)} one (${piSkillOriginLabel(info.origin).toLowerCase()}), and its switch saves the preference for this skill file alone.`;
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
  const hasProject = scopes.some((entry) => entry.scope === "project") || skills.some((skill) => skill.scope === "project");
  const order: readonly PiSkillScope[] = hasProject ? PI_SKILL_SCOPE_ORDER : ["global"];
  return order.map((scope) => ({
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
 * What a finished preference write means for the row the reader pressed.
 *
 * The panel verifies by re-reading the list, and the list answers with the effective state - whether a
 * session would be given the skill. A write can be exactly what the reader asked for and the effective
 * state still say no: Pi loads a same-named skill instead, the skill's owning Pi package is turned off,
 * the skill is loaded for `/skill:` only, or a running session has not reloaded its skills yet. A
 * panel that reports those as failures is worse than one that stays quiet: the reader is told a saved,
 * correct preference did not save.
 */
export type PiSkillWriteOutcome =
  | { kind: "effective" }
  | { kind: "saved"; reason: string }
  | { kind: "unverified"; reason: string };

export function piSkillWriteOutcome(row: PiSkillInfo | undefined, enabled: boolean): PiSkillWriteOutcome {
  if (row === undefined) return { kind: "unverified", reason: "The skill list returned after the write has no such skill." };
  if (row.enabled === enabled) return { kind: "effective" };
  const wanted: PiSkillPreference = enabled ? "enabled" : "disabled";
  if (row.preference !== wanted) return { kind: "unverified", reason: `The saved preference is "${row.preference}", not "${wanted}".` };
  if (row.shadowed === true) return { kind: "saved", reason: "Pi loads one skill per name, and a same-named skill is the one it loads. Turn that skill off to put this file in its place." };
  if (row.ownerPackageDisabled === true) return { kind: "saved", reason: `The Pi package that supplies this skill is turned off, so no session can load it.` };
  if (row.disableModelInvocation === true) return { kind: "saved", reason: "Pi loads this skill for /skill: and its disable-model-invocation is on, so it is not in the model's list." };
  return { kind: "saved", reason: "A running session picks the change up at its next skill reload." };
}

/**
 * The request for one row's switch.
 *
 * The skill's identity travels with it, so the machine writes the answer for the skill the reader
 * pressed and not for the skill of the same name that lives somewhere else. The display name travels
 * beside it for a machine that answers switches by name; a current machine reads the identity.
 *
 * The project id travels with the scope row it was read for, because the server resolves a project
 * scope from its own project store and a browser must never name a path.
 */
export function piSkillToggleRequest(
  info: Pick<PiSkillInfo, "id" | "name" | "scope">,
  enabled: boolean,
  scopes: readonly PiSkillsScopeInfo[],
  selectedProjectId?: string,
): PiSkillSetEnabledRequest {
  const preferenceScope: PiSkillScope = selectedProjectId === undefined ? info.scope : "project";
  const projectScope = scopes.find((entry) => entry.scope === "project");
  const projectId = preferenceScope === "project" ? selectedProjectId ?? projectScope?.projectId : undefined;
  return {
    ...(info.id === "" ? {} : { id: info.id }),
    name: info.name,
    scope: preferenceScope,
    enabled,
    ...(projectId === undefined || projectId === "" ? {} : { projectId }),
  };
}

/** The row a switch is being saved for: the identity when there is one, and the name for a machine that has none. */
export function isPiSkillTogglePending(
  operation: PiSkillOperationState | undefined,
  info: Pick<PiSkillInfo, "id" | "name" | "scope">,
  projectSelected = false,
): boolean {
  if (operation === undefined) return false;
  const preferenceScope: PiSkillScope = projectSelected ? "project" : info.scope;
  const sameSkill = operation.id !== "" && info.id !== "" ? operation.id === info.id : operation.name === info.name;
  return sameSkill && operation.scope === preferenceScope;
}

/**
 * The row a switch was just saved for.
 *
 * The identity names the row. A display name can belong to two rows, and a verification that checked
 * "a row of that name" would pass while the skill the reader pressed stayed off - so a name is only
 * used when it names one row, and an answer that cannot be checked is reported as a failed check.
 */
export function findSkillRow(
  skills: readonly PiSkillInfo[],
  toggle: Pick<PiSkillSetEnabledRequest, "id" | "name">,
): PiSkillInfo | undefined {
  const id = toggle.id;
  if (id !== undefined && id !== "") return skills.find((skill) => skill.id === id);
  const found = skills.filter((skill) => skill.name === (toggle.name ?? ""));
  return found.length === 1 ? found[0] : undefined;
}

export function piSkillMutationMessage(scope: PiSkillScope, name: string, enabled: boolean, target: SettingsMachineTarget): string {
  const targetSuffix = target.kind === "local" ? "" : ` on ${target.name}`;
  const sessionScope = target.kind === "local" ? "each idle PI WEB session" : `each idle PI WEB session on ${target.name}`;
  const preferenceTarget = scope === "project" ? " for this project" : " globally";
  return `Skill ${name} ${enabled ? "turned on" : "turned off"}${preferenceTarget}${targetSuffix}. Type /reload in ${sessionScope} to load the new skill list.`;
}
