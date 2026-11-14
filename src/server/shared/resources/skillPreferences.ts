import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  jsonErrorLocation,
  parseConfigFileText,
  parseSkillPreferenceConfig,
  PiWebConfigError,
  skillPreferenceRecord,
  SKILL_PREFERENCE_CONFIG_KEY,
  type LoadedSkillPreferences,
} from "../../../config.js";
import type { PiSkillPreference, PiSkillPreferenceConfig } from "../../../shared/apiTypes.js";
import { isRecord } from "../../../shared/unknownValues.js";

/**
 * Which skills PI WEB keeps out of Pi's runtime list, and how the two scopes answer each other.
 *
 * Pi has no per-skill switch: a skill is available when `loadSkills` reads its file, and the
 * resource loader's `skillsOverride` is the supported place to take one out. This module owns the
 * preference that drives that filter, in the shape the two scopes need:
 *
 * - the global scope's list lives under the `skills` key of PI WEB's own config file, because the
 *   preference belongs to the machine that runs Pi, not to a browser;
 * - a project's list lives under the `skills` key of `<project>/.pi-web/config.json`, so a project
 *   can turn a global skill off without touching the global file, and the file is committable.
 *
 * A project entry answers for that project alone and never rewrites the global entry. A name that
 * appears in neither list has no preference, so Pi's own default (the skill is available) stands:
 * installing this feature cannot silently disable a skill somebody already uses.
 */

/** The preference that answers for one skill name, in the scope a reader asked about. */
export function resolveSkillPreference(name: string, globalConfig: PiSkillPreferenceConfig, projectConfig?: PiSkillPreferenceConfig): PiSkillPreference {
  if (projectConfig !== undefined) {
    if (projectConfig.disabled?.includes(name) === true) return "disabled";
    if (projectConfig.enabled?.includes(name) === true) return "enabled";
  }
  if (globalConfig.disabled?.includes(name) === true) return "disabled";
  if (globalConfig.enabled?.includes(name) === true) return "enabled";
  return "default";
}

/**
 * Whether Pi's runtime list keeps one skill.
 *
 * The project scope is the nearer answer, then the global one, then Pi's default. `default` is
 * enabled, because that is what Pi does with a skill nobody has written anything about.
 */
export function isSkillEnabled(name: string, globalConfig: PiSkillPreferenceConfig, projectConfig?: PiSkillPreferenceConfig): boolean {
  return resolveSkillPreference(name, globalConfig, projectConfig) !== "disabled";
}

/**
 * The skill names Pi's runtime should carry, applied to a discovered list.
 *
 * This is the shape the resource loader's `skillsOverride` wants: the same diagnostics, with the
 * disabled skills out of the list, so a disabled skill leaves no trace in the prompt and no
 * `/skill:<name>` command behind.
 */
export function filterSkillsByPreference<T extends { name: string }>(
  skills: readonly T[],
  globalConfig: PiSkillPreferenceConfig,
  projectConfig?: PiSkillPreferenceConfig,
): T[] {
  return skills.filter((skill) => isSkillEnabled(skill.name, globalConfig, projectConfig));
}

/**
 * What a scope's saved list looks like once one skill is turned on or off.
 *
 * The name leaves the other list, so a scope can never hold both answers for one skill: a reader
 * that disables a skill it had enabled before gets one entry, not two that cancel out.
 */
export function applySkillPreference(config: PiSkillPreferenceConfig, name: string, enabled: boolean): PiSkillPreferenceConfig {
  const trimmed = name.trim();
  if (trimmed === "") throw new PiWebConfigError("A skill preference needs a skill name");
  const disabled = withoutName(withoutName(config.disabled ?? [], trimmed), trimmed);
  const enabledNames = withoutName(withoutName(config.enabled ?? [], trimmed), trimmed);
  return enabled
    ? { version: 1, enabled: [...enabledNames, trimmed], ...(disabled.length === 0 ? {} : { disabled }) }
    : { version: 1, disabled: [...disabled, trimmed], ...(enabledNames.length === 0 ? {} : { enabled: enabledNames }) };
}

function withoutName(names: readonly string[], name: string): string[] {
  return names.filter((entry) => entry !== name);
}

/** The project file a scope's preferences live in, next to PI WEB's other project config. */
export const PROJECT_SKILL_PREFERENCES_PATH = join(".pi-web", "config.json");

export interface LoadedProjectSkillPreferences extends LoadedSkillPreferences {
  projectPath: string;
}

/** The project's saved skill preferences; a missing file is no preferences, not an empty list. */
export function loadProjectSkillPreferences(projectPath: string): LoadedProjectSkillPreferences {
  const path = join(projectPath, PROJECT_SKILL_PREFERENCES_PATH);
  const value = readProjectConfigObject(path, projectPath)[SKILL_PREFERENCE_CONFIG_KEY];
  return { projectPath, path, exists: value !== undefined, config: value === undefined ? {} : parseSkillPreferenceConfig(value, path) };
}

/**
 * Writes one project's skill preferences, keeping every other key of its config file.
 *
 * The file is committable, so its shape is the file's own: `version`, `pathAccess`, `uploads`, and
 * whatever a plugin owns stay exactly as the project has them.
 */
export function saveProjectSkillPreferences(projectPath: string, preferences: PiSkillPreferenceConfig): LoadedProjectSkillPreferences {
  const path = join(projectPath, PROJECT_SKILL_PREFERENCES_PATH);
  const existing = readProjectConfigObject(path, projectPath);
  const config = parseSkillPreferenceConfig(preferences, path);
  const kept = Object.fromEntries(Object.entries(existing).filter(([key]) => key !== SKILL_PREFERENCE_CONFIG_KEY));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ ...kept, [SKILL_PREFERENCE_CONFIG_KEY]: skillPreferenceRecord(config) }, null, 2)}\n`, "utf8");
  return { projectPath, path, exists: true, config };
}

function readProjectConfigObject(path: string, projectPath: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  let parsed: unknown;
  try {
    parsed = parseConfigFileText(readFileSync(path, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) throw new PiWebConfigError(`PI WEB project config must contain valid JSON: ${path}${jsonErrorLocation(error)}`);
    throw error;
  }
  if (!isRecord(parsed)) throw new PiWebConfigError(`PI WEB project config must be a JSON object: ${path} (project ${projectPath})`);
  return parsed;
}
