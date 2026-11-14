import type { ResourceDiagnostic, Skill } from "@earendil-works/pi-coding-agent";
import { loadGlobalSkillPreferences } from "../../../config.js";
import { filterSkillsByPreference, loadProjectSkillPreferences } from "../../shared/resources/skillPreferences.js";
import type { PiSkillPreferenceConfig } from "../../../shared/apiTypes.js";

/**
 * The skills a session is not allowed to see.
 *
 * Pi has no per-skill switch: a skill exists in a session when `loadSkills` read its file, and the
 * resource loader's `skillsOverride` is the supported place to take one out. PI WEB's Skills panel
 * writes the preference; this module is where that preference becomes true for a session, so the
 * panel and the runtime cannot end up with two answers about the same skill.
 *
 * Two rules keep the filter safe to run at every session start:
 *
 * - A skill no preference names is kept. An absent preference is Pi's default (available), never a
 *   refusal, so installing this feature cannot take a skill away from somebody who uses it.
 * - A preference file that cannot be read is treated as no preferences, and the failure is logged.
 *   A malformed file in a project nobody controls must not be able to blank every skill of every
 *   session on this machine.
 *
 * Reads are cached per agent directory and project on the same short TTL the built-in extension
 * states use: the answer is needed at session creation, sessions start in bursts, and a change made
 * in the panel has to reach the next session without restarting the daemon.
 */

const PREFERENCE_TTL_MS = 15_000;

/** What pi's loader hands `skillsOverride`: the skills it read, and the diagnostics that came with them. */
export interface SkillLoadResult {
  skills: Skill[];
  diagnostics: ResourceDiagnostic[];
}

export interface SkillFilterLogger {
  info: (details: Record<string, unknown>, message: string) => void;
  warn: (details: Record<string, unknown>, message: string) => void;
}

/** Where the two scopes' preferences come from, so a test can answer without touching a disk. */
export interface SkillPreferenceReader {
  readGlobal: () => PiSkillPreferenceConfig;
  readProject: (cwd: string) => PiSkillPreferenceConfig;
}

export interface CachedPreferences {
  readAt: number;
  global: PiSkillPreferenceConfig;
  project: PiSkillPreferenceConfig | undefined;
  globalReadable: boolean;
}

export const fileSkillPreferenceReader: SkillPreferenceReader = {
  readGlobal: () => loadGlobalSkillPreferences().config,
  readProject: (cwd) => loadProjectSkillPreferences(cwd).config,
};

export function piWebSkillsOverride(
  agentDir: string,
  cwd: string,
  log: SkillFilterLogger,
  reader: SkillPreferenceReader = fileSkillPreferenceReader,
  cache = new Map<string, CachedPreferences>(),
): (base: SkillLoadResult) => SkillLoadResult {
  return (base) => {
    const preferences = readPreferences(agentDir, cwd, reader, cache, log);
    const kept = filterSkillsByPreference(base.skills, preferences.global, preferences.project);
    if (kept.length === base.skills.length) return base;
    const removed = base.skills.filter((skill) => !kept.some((entry) => entry === skill)).map((skill) => skill.name);
    log.info({
      cwd,
      loaded: base.skills.length,
      kept: kept.length,
      removed: removed.length,
      scopes: preferenceScopes(preferences, removed),
    }, "Applied PI WEB skill preferences to a session's skills");
    return { ...base, skills: kept };
  };
}

/** Which scope removed each name, so a log says where to look and not only how many. */
function preferenceScopes(preferences: CachedPreferences, removed: readonly string[]): string[] {
  const scopes: string[] = [];
  if (preferences.globalReadable && preferences.global.disabled?.some((name) => removed.includes(name)) === true) scopes.push("global");
  if (preferences.project?.disabled?.some((name) => removed.includes(name)) === true) scopes.push("project");
  return scopes;
}

function readPreferences(
  agentDir: string,
  cwd: string,
  reader: SkillPreferenceReader,
  cache: Map<string, CachedPreferences>,
  log: SkillFilterLogger,
): CachedPreferences {
  const key = `${agentDir}\u0000${cwd}`;
  const cached = cache.get(key);
  if (cached !== undefined && Date.now() - cached.readAt < PREFERENCE_TTL_MS) return cached;
  const read: CachedPreferences = { readAt: Date.now(), global: {}, project: undefined, globalReadable: true };
  try {
    read.global = reader.readGlobal();
  } catch (error) {
    read.globalReadable = false;
    read.global = {};
    log.warn({
      agentDir,
      error: error instanceof Error ? error.message : String(error),
    }, "PI WEB skill preferences could not be read from this machine's config; every skill stays available");
  }
  try {
    read.project = reader.readProject(cwd);
  } catch (error) {
    read.project = undefined;
    log.warn({
      cwd,
      error: error instanceof Error ? error.message : String(error),
    }, "A project's skill preferences could not be read; its skills stay available");
  }
  cache.set(key, read);
  return read;
}
