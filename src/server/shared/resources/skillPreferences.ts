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
import type {
  PiSkillPreference,
  PiSkillPreferenceConfig,
  PiSkillPreferenceEntryValue,
  PiSkillScope,
} from "../../../shared/apiTypes.js";
import { isRecord } from "../../../shared/unknownValues.js";
import type { SkillIdentity } from "./skillIdentity.js";

/**
 * Which skills PI WEB keeps out of the list Pi is given, and how the two scopes answer each other.
 *
 * Pi has no per-skill switch: a skill is available when `loadSkills` reads its file, and the resource
 * loader's `skillsOverride` is the supported place to take one out. This module owns the preference
 * that drives that filter, in the shape the two scopes need:
 *
 * - the global scope's list lives under the `skills` key of PI WEB's own config file, because the
 *   preference belongs to the machine that runs Pi, not to a browser;
 * - a project's list lives under the `skills` key of `<project>/.pi-web/config.json`, so a project can
 *   turn a skill off for itself without touching the global file, and the file is committable.
 *
 * A preference names a skill by its stable identity (see `skillIdentity.ts`), not by its display name,
 * because a name is front matter and two skills can carry it - a machine-wide skill and a project's own
 * skill, two projects' own skills, a package's skill and the agent folder's. Files written before
 * identities existed list bare names; `planSkillRuntime` resolves such an entry against the discovered
 * skills and applies it where it names exactly one skill.
 *
 * A name that two discovered skills carry is never guessed at: the entry is preserved exactly as it was
 * and answers for neither skill, and it is reported, because spreading one reader's switch over every
 * skill of that name would switch off skills nobody touched.
 *
 * A project entry answers for that project alone and never rewrites the global entry. A skill that
 * appears in neither list has no preference, so Pi's own default (the skill is available) stands:
 * installing this feature cannot silently disable a skill somebody already uses.
 */

/** The project file a scope's preferences live in, next to PI WEB's other project config. */
export const PROJECT_SKILL_PREFERENCES_PATH = join(".pi-web", "config.json");

export interface LoadedProjectSkillPreferences extends LoadedSkillPreferences {
  projectPath: string;
}

/** A discovered skill, as far as a preference is concerned. */
export interface SkillPreferenceSubject {
  identity: SkillIdentity;
  name: string;
  /** Pi's own answer for this skill: loaded, and in the list the caller is working from. */
  enabled?: boolean;
  /** True when Pi's loader kept a same-named skill in place of this one. */
  shadowedByPi?: boolean;
}

/** A skill's saved answer and the scope that wrote it. */
export interface SkillPreferenceAnswer {
  preference: PiSkillPreference;
  answeredBy: PiSkillScope | "default";
}

/** One skill, as both the Skills panel row and the session's filter need it. */
export interface SkillRuntimeRow extends SkillPreferenceAnswer {
  identity: SkillIdentity;
  name: string;
  /** Whether this skill is in the list Pi is given. */
  enabled: boolean;
  /** True when Pi's loader kept a same-named skill in place of this one. */
  shadowed?: boolean;
  /** True when this skill entered the list in place of a same-named skill that is turned off. */
  promoted?: boolean;
}

/** A saved name that two or more discovered skills carry: preserved, and answering for neither. */
export interface SkillPreferenceAmbiguity {
  scope: PiSkillScope;
  name: string;
  identities: readonly SkillIdentity[];
}

/** A saved name that matches no discovered skill: preserved, and answering for nothing. */
export interface SkillPreferenceUnresolvedEntry {
  scope: PiSkillScope;
  name: string;
}

export interface SkillRuntimePlan {
  /** One row per subject, in the subject order. */
  rows: readonly SkillRuntimeRow[];
  rowFor(id: string): SkillRuntimeRow | undefined;
  /** Saved names that two discovered skills share, in the scope they were saved in. */
  ambiguous: readonly SkillPreferenceAmbiguity[];
  /** Saved names that match no discovered skill, in the scope they were saved in. */
  unresolved: readonly SkillPreferenceUnresolvedEntry[];
  /** Skills one scope names in both the on list and the off list; the off answer stands. */
  conflicts: readonly SkillPreferenceConflict[];
}

const DEFAULT_ANSWER: SkillPreferenceAnswer = { preference: "default", answeredBy: "default" };

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

/**
 * The answer for every discovered skill, in precedence order: an entry in the project's scope, then one
 * in the global scope, then Pi's default.
 *
 * A legacy name entry is resolved against the discovered skills at read time, so it applies to the
 * skill it names where that is unambiguous, and to nothing where it is not. Rows keep the subject order,
 * which is what lets the panel and the session's filter read the same rows for the same skills.
 */
export function planSkillRuntime(
  subjects: readonly SkillPreferenceSubject[],
  globalConfig: PiSkillPreferenceConfig,
  projectConfig?: PiSkillPreferenceConfig,
): SkillRuntimePlan {
  const answers = new ScopeAnswers(subjectsByName(subjects));
  answers.add(globalConfig, "global");
  if (projectConfig !== undefined) answers.add(projectConfig, "project");
  const entries = subjects.map((subject) => ({ subject, row: rowFor(subject, answers.answerFor(subject)) }));
  applyNameCollisions(entries);
  const rows = entries.map((entry) => entry.row);
  const byId = new Map(rows.map((row) => [row.identity.id, row]));
  return { rows, rowFor: (id) => byId.get(id), ambiguous: answers.ambiguous, unresolved: answers.unresolved, conflicts: answers.conflicts };
}

/** A scope's saved preferences with one skill's answer written into them.
 *
 * The identity entry for the skill replaces whatever was there, so switching a skill is one write and
 * never leaves two answers for one skill. A legacy name that named exactly this skill retires with it,
 * because keeping both would leave a name and an identity answering for one skill, free to drift apart.
 * A name that names two skills is never touched: it is the ambiguous entry the panel reports, and
 * writing a preference for one skill of that name must not silently decide what the old entry meant.
 *
 * A `skills` key that gains an identity entry declares `version: 2`, because that is the shape the file
 * now has. Nothing else in the reader's file is rewritten: a global switch touches only the `skills`
 * key of the machine's config, and a project switch only the `skills` key of the project's config.
 */
export function applySkillPreference(
  config: PiSkillPreferenceConfig,
  subject: SkillPreferenceSubject,
  enabled: boolean,
  subjects: readonly SkillPreferenceSubject[],
): PiSkillPreferenceConfig {
  const byName = subjectsByName(subjects);
  const entry = { id: subject.identity.id, name: subject.name };
  const retire = (list: readonly PiSkillPreferenceEntryValue[] | undefined) =>
    (list ?? []).filter((value) => !namesIdentity(value, subject.identity.id) && !nameRetiredWith(value, subject.identity, byName));
  const disabled = retire(config.disabled);
  const enabledNames = retire(config.enabled);
  if (enabled) enabledNames.push(entry);
  else disabled.push(entry);
  const next: PiSkillPreferenceConfig = { ...config, version: 2 };
  if (disabled.length > 0) next.disabled = disabled;
  else delete next.disabled;
  if (enabledNames.length > 0) next.enabled = enabledNames;
  else delete next.enabled;
  return next;
}

function rowFor(subject: SkillPreferenceSubject, answer: SkillPreferenceAnswer): SkillRuntimeRow {
  const loaded = subject.enabled !== false;
  return {
    identity: subject.identity,
    name: subject.name,
    enabled: loaded && answer.preference !== "disabled",
    ...(subject.shadowedByPi === true ? { shadowed: true } : {}),
    ...answer,
  };
}

/**
 * A same-named set of skills, and what Pi's loader left of it, applied to rows in place.
 *
 * Pi loads one skill per name and reports the rest as collisions. A skill Pi shadowed is not in the list
 * a session is given, so a preference cannot put it there: its row is marked not live, with `shadowed`
 * set so a panel can say why. Only a subject the caller reports as shadowed counts - the claim comes
 * from Pi's own report, never from an inference about two rows that happen to share a name.
 *
 * Turning the loaded skill off is the one case a shadowed skill can be reached: the reader named a
 * specific skill, so the shadowed skill of that name with an explicit `enabled` preference is promoted
 * into the list, picked in a fixed order (a project's own skill before a machine-wide one, then by
 * identity) so the same files always give the same answer.
 */
function applyNameCollisions(entries: readonly SkillPlanEntry[]): void {
  const byName = new Map<string, SkillPlanEntry[]>();
  for (const entry of entries) {
    const group = byName.get(entry.subject.name);
    if (group === undefined) byName.set(entry.subject.name, [entry]);
    else group.push(entry);
  }
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    const shadowed = group.filter((entry) => entry.subject.shadowedByPi === true);
    if (shadowed.length === 0) continue;
    for (const entry of shadowed) {
      entry.row.enabled = false;
      entry.row.shadowed = true;
    }
    const loaded = group.find((entry) => entry.subject.shadowedByPi !== true);
    if (loaded === undefined || loaded.row.enabled) continue;
    const promoted = pickPromotion(shadowed);
    if (promoted === undefined) continue;
    promoted.row.enabled = true;
    promoted.row.shadowed = false;
    promoted.row.promoted = true;
  }
}

interface SkillPlanEntry {
  subject: SkillPreferenceSubject;
  row: SkillRuntimeRow;
}

/** The shadowed skill of a name that takes the loaded skill's place: a project's own skill first, then by identity. */
function pickPromotion(shadowed: readonly SkillPlanEntry[]): SkillPlanEntry | undefined {
  const ordered = [...shadowed].sort((a, b) => {
    if (a.subject.identity.scope !== b.subject.identity.scope) return a.subject.identity.scope === "project" ? -1 : 1;
    return a.subject.identity.id < b.subject.identity.id ? -1 : 1;
  });
  return ordered.find((entry) => entry.row.preference === "enabled");
}

/** One skill a single scope names in both the on list and the off list: the file cannot be trusted. */
export interface SkillPreferenceConflict {
  scope: PiSkillScope;
  name: string;
  identity: SkillIdentity;
}

/**
 * A scope's saved answers, keyed by the skill each one ends up naming.
 *
 * Within one scope, a skill can be named twice - by a legacy name and by its identity, or by an
 * identity in both lists. The rules, in the order they settle it: an identity entry out-names a legacy
 * name for the same skill (the identity is the canonical spelling, the name is the alias that is being
 * retired), and a skill named in both lists of one scope is kept out, because taking a skill out is
 * what a preference is for. Every such file is reported: the panel's own writes never produce one, so
 * it arrived by hand or by a merge, and a reader who edited a config deserves to be told which skill
 * the file cannot decide.
 */
class ScopeAnswers {
  private readonly answers = new Map<string, SkillPreferenceAnswer>();
  private readonly entryKind = new Map<string, "name" | "identity">();
  readonly ambiguous: SkillPreferenceAmbiguity[] = [];
  readonly unresolved: SkillPreferenceUnresolvedEntry[] = [];
  readonly conflicts: SkillPreferenceConflict[] = [];

  constructor(private readonly byName: ReadonlyMap<string, readonly SkillPreferenceSubject[]>) {}

  /** Adds one scope's entries. Later scopes overwrite earlier ones, which is the precedence. */
  add(config: PiSkillPreferenceConfig, scope: PiSkillScope): void {
    this.addList(config.disabled, "disabled", scope);
    this.addList(config.enabled, "enabled", scope);
  }

  answerFor(subject: SkillPreferenceSubject): SkillPreferenceAnswer {
    return this.answers.get(subject.identity.id) ?? DEFAULT_ANSWER;
  }

  /** Names are read before identities, so an identity entry settles a skill a name already spoke for. */
  private addList(list: readonly PiSkillPreferenceEntryValue[] | undefined, preference: PiSkillPreference, scope: PiSkillScope): void {
    const values = list ?? [];
    for (const value of values) {
      if (typeof value === "object") continue;
      const named = uniquelyNamedSkill(value, this.byName);
      if (named !== undefined) {
        this.answer(named.id, preference, scope, value, "name");
        continue;
      }
      const found = this.byName.get(value) ?? [];
      if (found.length > 1) this.ambiguous.push({ scope, name: value, identities: found.map((subject) => subject.identity) });
      else this.unresolved.push({ scope, name: value });
    }
    for (const value of values) {
      if (typeof value !== "object") continue;
      this.answer(value.id, preference, scope, value.name ?? "", "identity");
    }
  }

  private answer(id: string, preference: PiSkillPreference, scope: PiSkillScope, name: string, kind: "name" | "identity"): void {
    const existing = this.answers.get(id);
    const existingKind = this.entryKind.get(id);
    if (existing?.answeredBy === scope && existing.preference !== preference) {
      this.reportConflict(scope, name, id);
      if (kind === "identity" && existingKind === "name") {
        // The identity is the canonical spelling: it settles the skill the alias was pointing at.
      } else if (kind === "name" && existingKind === "identity") {
        return;
      } else if (preference === "enabled") {
        return;
      }
    }
    this.answers.set(id, { preference, answeredBy: scope });
    this.entryKind.set(id, kind);
  }

  private reportConflict(scope: PiSkillScope, name: string, id: string): void {
    const identity = this.identityById(id);
    if (identity === undefined || this.conflicts.some((entry) => entry.scope === scope && entry.identity.id === id)) return;
    this.conflicts.push({ scope, name, identity });
  }

  /** The discovered skill an entry names, so a report can say which skill file is meant. */
  private identityById(id: string): SkillIdentity | undefined {
    for (const group of this.byName.values()) {
      const found = group.find((subject) => subject.identity.id === id);
      if (found !== undefined) return found.identity;
    }
    return undefined;
  }
}

/** The one skill a bare name can mean, or none when the name is shared by two discovered skills. */
function uniquelyNamedSkill(name: string, byName: ReadonlyMap<string, readonly SkillPreferenceSubject[]>): SkillIdentity | undefined {
  const found = byName.get(name);
  const only = found?.[0];
  return found?.length === 1 && only !== undefined ? only.identity : undefined;
}

function subjectsByName(subjects: readonly SkillPreferenceSubject[]): Map<string, readonly SkillPreferenceSubject[]> {
  const byName = new Map<string, readonly SkillPreferenceSubject[]>();
  for (const subject of subjects) {
    const found = byName.get(subject.name);
    byName.set(subject.name, found === undefined ? [subject] : [...found, subject]);
  }
  return byName;
}

function namesIdentity(value: PiSkillPreferenceEntryValue, id: string): boolean {
  return typeof value === "object" && value.id === id;
}

/** True when a saved bare name named exactly this skill, and so retires when the skill's identity entry is written. */
function nameRetiredWith(
  value: PiSkillPreferenceEntryValue,
  identity: SkillIdentity,
  byName: ReadonlyMap<string, readonly SkillPreferenceSubject[]>,
): boolean {
  if (typeof value !== "string") return false;
  const named = uniquelyNamedSkill(value, byName);
  return named?.id === identity.id;
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
