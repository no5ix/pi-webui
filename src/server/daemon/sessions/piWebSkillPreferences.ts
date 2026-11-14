import type { ResourceDiagnostic, Skill } from "@earendil-works/pi-coding-agent";
import { loadGlobalSkillPreferences } from "../../../config.js";
import { loadProjectSkillPreferences, planSkillRuntime, type SkillPreferenceSubject, type SkillRuntimeRow } from "../../shared/resources/skillPreferences.js";
import { skillPreferenceIdentityFor, skillScopeCacheKey, type SkillIdentity } from "../../shared/resources/skillIdentity.js";
import { recoverShadowedSkills } from "../../shared/resources/skillShadowRecovery.js";
import type { PiSkillPreferenceConfig } from "../../../shared/apiTypes.js";

/**
 * The skills a session is allowed to see.
 *
 * Pi has no per-skill switch: a skill exists in a session when `loadSkills` read its file, and the
 * resource loader's `skillsOverride` is the supported place to take one out. PI WEB's Skills panel
 * writes the preference; this module is where that preference becomes true for a session, so the panel
 * and the runtime cannot end up with two answers about the same skill.
 *
 * The filter works on skill identities, not names, and it plans with the same
 * `planSkillRuntime` the panel renders rows with, which is the only reason a panel row and a session
 * can be trusted to agree.
 *
 * Pi's loader keeps one skill per name and drops the rest into `collision` diagnostics, so a shadowed
 * namesake is not in the list this filter was handed. It is recovered from the collision's
 * `loserPath` (Pi's own report of what it dropped) and re-read with Pi's public `loadSkillsFromDir`,
 * for the one case the plan allows: the reader turned the kept skill off and turned that specific
 * skill on. Nothing else here changes what Pi loaded.
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
 * in the panel has to reach the next session without restarting the daemon. The cache key is the
 * canonical spelling of both directories, so two spellings of one project cannot hold two answers.
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
    const identityFor = skillPreferenceIdentityFor(agentDir, cwd);
    const loaded = base.skills.map((skill) => ({ skill, identity: identityFor(skill.filePath) }));
    const losers = recoverShadowedSkills(base.diagnostics, base.skills, identityFor);
    const subjects: SkillPreferenceSubject[] = [
      ...loaded.map(({ skill, identity }) => ({ identity, name: skill.name })),
      ...losers.map((entry) => ({ identity: entry.identity, name: entry.skill.name, shadowedByPi: true })),
    ];
    const plan = planSkillRuntime(subjects, preferences.global, preferences.project);
    const kept = loaded.filter(({ identity }) => plan.rowFor(identity.id)?.enabled === true);
    const removed = loaded.filter(({ identity }) => plan.rowFor(identity.id)?.enabled !== true);
    const promoted = losers.filter((entry) => plan.rowFor(entry.identity.id)?.promoted === true);
    if (removed.length === 0 && promoted.length === 0) return base;
    const skills = [...kept.map(({ skill }) => skill), ...promoted.map(({ skill }) => skill)];
    log.info({
      cwd,
      loaded: base.skills.length,
      kept: kept.length,
      removed: removed.length,
      promoted: promoted.length,
      scopes: preferenceScopes(preferences, removed),
    }, "Applied PI WEB skill preferences to a session's skills");
    return {
      skills,
      diagnostics: [...base.diagnostics, ...promotionDiagnostics(promoted, plan.rows)],
    };
  };
}

/** A promoted skill says so in the session's own diagnostics: a list Pi did not build deserves a note. */
function promotionDiagnostics(promoted: readonly { skill: Skill }[], rows: readonly SkillRuntimeRow[]): ResourceDiagnostic[] {
  return promoted.map(({ skill }) => {
    const row = rows.find((entry) => entry.name === skill.name && entry.promoted === true);
    return {
      type: "warning" as const,
      message: `PI WEB skill preferences turned this skill on in place of a same-named skill that is turned off${row === undefined ? "" : ` (identity ${row.identity.id})`}.`,
      path: skill.filePath,
    };
  });
}

/**
 * Which scope removed each skill, so a log says where to look and not only how many.
 *
 * An identity entry is matched on the identity, and a legacy name entry on the name of the skill that
 * left the list - the same pairing resolution used to decide the answer, so the log cannot name a
 * scope that did not answer for that skill.
 */
function preferenceScopes(
  preferences: CachedPreferences,
  removed: readonly { skill: Skill; identity: SkillIdentity }[],
): string[] {
  const removedIds = new Set(removed.map(({ identity }) => identity.id));
  const removedNames = new Set(removed.map(({ skill }) => skill.name));
  const answered = (list: PiSkillPreferenceConfig["disabled"]) =>
    (list ?? []).some((entry) => typeof entry === "object" ? removedIds.has(entry.id) : removedNames.has(entry));
  const scopes: string[] = [];
  if (preferences.globalReadable && answered(preferences.global.disabled)) scopes.push("global");
  if (answered(preferences.project?.disabled)) scopes.push("project");
  return scopes;
}

function readPreferences(
  agentDir: string,
  cwd: string,
  reader: SkillPreferenceReader,
  cache: Map<string, CachedPreferences>,
  log: SkillFilterLogger,
): CachedPreferences {
  const key = skillScopeCacheKey(agentDir, cwd);
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
