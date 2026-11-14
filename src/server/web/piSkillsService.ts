import { readdir } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  DefaultPackageManager,
  loadSkills,
  loadSkillsFromDir,
  SettingsManager,
  type ResolvedResource,
} from "@earendil-works/pi-coding-agent";
import type {
  PiSkillInfo,
  PiSkillOrigin,
  PiSkillPreferenceConfig,
  PiSkillScope,
  PiSkillSetEnabledRequest,
  PiSkillSetEnabledResponse,
  PiSkillsDiagnostic,
  PiSkillsResponse,
  PiSkillsScopeInfo,
} from "../../shared/apiTypes.js";
import { loadGlobalSkillPreferences, saveGlobalSkillPreferences, type LoadedSkillPreferences } from "../../config.js";
import {
  applySkillPreference,
  loadProjectSkillPreferences,
  planSkillRuntime,
  saveProjectSkillPreferences,
  type SkillPreferenceSubject,
  type SkillRuntimePlan,
  type SkillRuntimeRow,
  type LoadedProjectSkillPreferences,
} from "../shared/resources/skillPreferences.js";
import { isGlobalAgentSkillPath, skillOwnership, skillPreferenceIdentityFor } from "../shared/resources/skillIdentity.js";
import { recoverShadowedSkills } from "../shared/resources/skillShadowRecovery.js";
import { piProjectIsTrusted, unconfiguredSettingsProjectResolver, type SettingsProjectResolver } from "../shared/resources/settingsProjectResolver.js";
import { isRecord } from "../../shared/unknownValues.js";
import { isDisabledPackageSource, packageSourceString } from "../shared/resources/piPackageState.js";
import { requireActiveAgentProfile, type ActiveAgentProfileProvider } from "./activeAgentProfileProvider.js";

/** One skill as pi's own discovery reported it, with the package that carries it when one does. */
export interface DiscoveredSkill {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  /** pi's own source label: `user`, `project`, `path`, or the package's source. */
  source: string;
  /** pi's own scope: a user (global) skill, a project one, a temporary one, or none - a configured path has none. */
  piScope?: "user" | "project" | "temporary";
  disableModelInvocation: boolean;
  /** The configured Pi package whose install root holds this skill. */
  packageSource?: string;
  /** A package that is configured off, so this skill is not in the runtime list at all. */
  ownerPackageDisabled?: boolean;
  /**
   * Pi's loader kept a same-named skill from a stronger source and dropped this one, so the session
   * cannot see this file while the other is in the list. It is still a skill with its own identity and
   * its own preference, and the panel has to be able to say so.
   */
  shadowedByPi?: boolean;
}

export interface SkillDiscovery {
  skills: DiscoveredSkill[];
  diagnostics: PiSkillsDiagnostic[];
  /** Skill paths pi's settings or a package names that pi could not read, with the reason. */
  unreadablePaths: PiSkillsDiagnostic[];
  /** The directories pi scans for each scope's own skills, so the panel can name them. */
  skillsDirs: { scope: PiSkillScope; path: string }[];
}

/** Reads the skills of one project, on the machine this process runs on. */
export interface PiSkillDiscoveryPort {
  /** `projectPath` is undefined for the global view, where only the agent directory is read. */
  discover(projectPath: string | undefined): Promise<SkillDiscovery>;
}

export interface SkillPreferencesStore {
  readGlobal(): LoadedSkillPreferences;
  writeGlobal(config: PiSkillPreferenceConfig): LoadedSkillPreferences;
  readProject(projectPath: string): LoadedProjectSkillPreferences;
  writeProject(projectPath: string, config: PiSkillPreferenceConfig): LoadedProjectSkillPreferences;
}

export interface PiSkillsListRequest {
  projectId?: string;
}

export interface PiSkillsService {
  list(request: PiSkillsListRequest): Promise<PiSkillsResponse>;
  setEnabled(request: PiSkillSetEnabledRequest): Promise<PiSkillSetEnabledResponse>;
}

/** A request PI WEB will not answer: a 400 with the reader's own problem, not a crash. */
export class PiSkillsRequestError extends Error {
  override name = "PiSkillsRequestError";
}

/** The skill a preference names is not one the named scope offers, so nothing is written. */
export class PiSkillNotFoundError extends Error {
  override name = "PiSkillNotFoundError";
}

/**
 * The skills of one discovery, as preference subjects: each with the identity the session runtime will
 * name it by.
 *
 * Folder-owned skills retain the owner encoded by their `.pi/skills` or `.agents/skills` path.
 * Configured absolute paths inside the selected project use that project's context, matching the
 * session cwd. Disabled-package rows are informational only and are excluded from preference planning.
 */
export function skillPreferenceSubjects(skills: readonly DiscoveredSkill[], agentDir: string, projectPath?: string): SkillPreferenceSubject[] {
  const identityFor = skillPreferenceIdentityFor(agentDir, projectPath);
  return skills.map((skill) => ({
    identity: identityFor(skill.filePath),
    name: skill.name,
    ...(skill.shadowedByPi === true ? { shadowedByPi: true } : {}),
  }));
}



/**
 * The Skills panel's service: pi's own discovery, with PI WEB's saved preference applied to it.
 *
 * Discovery is pi's, not a list PI WEB keeps. The configured packages are resolved without
 * installing anything, their enabled skill paths and the settings' skill paths go to
 * `loadSkills`, and that is the same call pi's resource loader makes. The saved preference is the one
 * the session's `skillsOverride` filter reads, through the same `planSkillRuntime` this service calls,
 * so the panel and the runtime cannot disagree about one skill: both answer from the same rows, in the
 * same order, over the same identities.
 */
export class DefaultPiSkillsService implements PiSkillsService {
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly discovery: PiSkillDiscoveryPort,
    private readonly preferences: SkillPreferencesStore,
    private readonly projects: SettingsProjectResolver,
    private readonly agentDir: string,
  ) {}

  async list(request: PiSkillsListRequest): Promise<PiSkillsResponse> {
    const scope = await this.resolveScope(request.projectId);
    return this.response(await this.discovery.discover(scope.projectPath), scope);
  }

  /**
   * One skill switch, written against that skill's identity.
   *
   * The identity decides which skill the answer belongs to, so a machine-wide skill and a project's own
   * skill of the same display name are switched apart, and a project's answer never lands in the
   * machine's file. The request's own `scope` says which file to write, and a skill has to be one that
   * file can speak for: the machine's file cannot name a project's own skill, because that skill's
   * identity is built from the project.
   */
  async setEnabled(request: PiSkillSetEnabledRequest): Promise<PiSkillSetEnabledResponse> {
    const scope = await this.resolveScope(request.projectId);
    if (request.scope === "project" && scope.projectPath === undefined) {
      throw new PiSkillsRequestError("A project-scope skill preference needs a project");
    }
    return await this.enqueueMutation(async () => {
      const projectPath = scope.projectPath;
      const discovered = await this.discovery.discover(projectPath);
      const subjects = skillPreferenceSubjects(discovered.skills, this.agentDir, projectPath);
      const subject = findPreferenceSubject(subjects, request);
      if (request.scope === "global" && subject.identity.scope !== "global") {
        throw new PiSkillsRequestError("A global skill preference cannot name a project's own skill: turn it off for that project instead.");
      }
      if (request.scope === "project" && projectPath !== undefined) {
        const stored = this.preferences.readProject(projectPath);
        this.preferences.writeProject(projectPath, applySkillPreference(stored.config, subject, request.enabled, subjects));
      } else {
        const stored = this.preferences.readGlobal();
        this.preferences.writeGlobal(applySkillPreference(stored.config, subject, request.enabled, subjects));
      }
      return { ...this.response(await this.discovery.discover(projectPath), scope), requiresReload: true };
    });
  }

  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const queued = this.mutationQueue.then(operation);
    this.mutationQueue = queued.then(
      () => undefined,
      () => undefined,
    );
    return queued;
  }

  private async resolveScope(projectId: string | undefined): Promise<ReadScope> {
    if (projectId === undefined) return { projectPath: undefined, projectTrusted: false };
    const projectPath = await this.projects.requireProjectPath(projectId);
    return { projectPath, projectId, projectTrusted: this.projects.isProjectTrusted(projectPath) };
  }

  private response(found: SkillDiscovery, scope: ReadScope): PiSkillsResponse {
    const global = this.preferences.readGlobal();
    const project = scope.projectPath === undefined ? undefined : this.preferences.readProject(scope.projectPath);
    const subjects = skillPreferenceSubjects(found.skills, this.agentDir, scope.projectPath);
    const runtimeSubjects = subjects.filter((_, index) => found.skills[index]?.ownerPackageDisabled !== true);
    const plan = planSkillRuntime(runtimeSubjects, global.config, project?.config);
    const skills = found.skills.flatMap((skill, index) => {
      const subject = subjects[index];
      if (subject === undefined) return [];
      return [describeSkill(skill, plan.rowFor(subject.identity.id) ?? unreachableRow(subject), scope.projectPath, this.agentDir)];
    });
    return {
      skills,
      diagnostics: [...found.diagnostics, ...preferenceResolutionDiagnostics(plan)],
      unreadablePaths: found.unreadablePaths,
      scopes: scopeRows(found, global, project, scope),
    };
  }
}

/**
 * The skill a preference request is about.
 *
 * A current client names the identity, and one written before identities existed names the display
 * name. A name is only safe when one discovered skill carries it: where two do, the request is
 * refused rather than answered for an arbitrary one, because writing that preference would switch off a
 * skill the reader did not touch.
 */
function findPreferenceSubject(
  subjects: readonly SkillPreferenceSubject[],
  request: PiSkillSetEnabledRequest,
): SkillPreferenceSubject {
  const id = request.id?.trim();
  if (id !== undefined && id !== "") {
    const found = subjects.find((subject) => subject.identity.id === id);
    if (found === undefined) throw new PiSkillNotFoundError(`No skill with the identity "${id}" is available`);
    return found;
  }
  const name = request.name?.trim();
  if (name === undefined || name === "") {
    throw new PiSkillsRequestError("A skill preference needs a skill identity or a skill name");
  }
  const found = subjects.filter((subject) => subject.name === name);
  if (found.length === 0) throw new PiSkillNotFoundError(`No skill named "${name}" is available`);
  if (found.length > 1) {
    throw new PiSkillsRequestError(`More than one skill is named "${name}", so the preference has to name the skill's identity`);
  }
  const [only] = found;
  if (only === undefined) throw new PiSkillNotFoundError(`No skill named "${name}" is available`);
  return only;
}

/**
 * What a saved preference could not say, in the rows' own diagnostics.
 *
 * A legacy name shared by two skills is kept as it was and answers for neither, and a name that
 * matches no discovered skill is kept and answers for nothing. Both are reported: a preference that is
 * doing nothing is a fact about the reader's config, and a panel that quietly ignores it leaves the
 * reader to work that out from a switch that does not move.
 */
function preferenceResolutionDiagnostics(plan: SkillRuntimePlan): PiSkillsDiagnostic[] {
  return [
    ...plan.ambiguous.map((entry) => ({
      message: `The saved ${entry.scope} skill preference "${entry.name}" names ${String(entry.identities.length)} skills that share that name, so it was kept as it is and applies to none of them. Switch the skill you mean, and that answer is saved against the skill itself.`,
    })),
    ...plan.unresolved.map((entry) => ({
      message: `The saved ${entry.scope} skill preference "${entry.name}" names no skill Pi discovers, so it applies to nothing. It is kept in case the skill comes back.`,
    })),
    ...plan.conflicts.map((entry) => ({
      message: `The saved ${entry.scope} skill preference names "${entry.name}" in both the turned-on list and the turned-off list, which cannot both be true. The skill is kept out of the list Pi is given. Switch it to write one answer.`,
      path: entry.identity.resourceKey,
    })),
  ];
}

interface ReadScope {
  projectPath: string | undefined;
  projectId?: string;
  projectTrusted: boolean;
}

function scopeRows(
  found: SkillDiscovery,
  global: LoadedSkillPreferences,
  project: LoadedProjectSkillPreferences | undefined,
  scope: ReadScope,
): PiSkillsScopeInfo[] {
  const globalDir = found.skillsDirs.find((entry) => entry.scope === "global");
  const projectDir = found.skillsDirs.find((entry) => entry.scope === "project");
  const projectPath = scope.projectPath;
  return [
    { scope: "global", skillsDir: globalDir?.path ?? "", configPath: global.path },
    ...(projectPath === undefined
      ? []
      : [{
          scope: "project" as const,
          skillsDir: projectDir?.path ?? "",
          configPath: project?.path ?? join(projectPath, ".pi-web", "config.json"),
          projectId: scope.projectId ?? "",
          projectPath,
          projectTrusted: scope.projectTrusted,
        }]),
  ];
}

/**
 * One discovered skill as the panel shows it.
 *
 * Two questions are answered here, and they are not the same question. Where a skill lives decides its
 * `scope` and `origin`: a path inside the selected repository is project-owned even when pi discovered
 * it through a configured path. Whether the session loads it is the plan's answer for that skill's
 * identity, and both fields come out of that one row because a row that is switched off while the
 * session still loads the skill, or the other way round, is a panel that lies about the machine.
 *
 * `enabled` therefore reports the plan, not the preference. A skill the reader turned on and Pi shadowed
 * by a same-named one is shown off and marked shadowed, and a skill the plan promoted into the list is
 * shown on and says why.
 */
/** A skill row for a skill the session can never be given: a Pi package that is turned off loads nothing. */
function unreachableRow(subject: SkillPreferenceSubject): SkillRuntimeRow {
  return { identity: subject.identity, name: subject.name, preference: "default", answeredBy: "default", enabled: false };
}

function describeSkill(skill: DiscoveredSkill, row: SkillRuntimeRow, projectPath: string | undefined, agentDir: string): PiSkillInfo {
  const resolvedFile = resolve(skill.filePath);
  const resolvedProject = projectPath === undefined ? undefined : resolve(projectPath);
  const owner = skillOwnership(skill.filePath, agentDir);
  const isProjectOwnedPath = owner.kind === "project" || (owner.kind !== "global" && (
    skill.piScope === "project"
    || (resolvedProject !== undefined && (resolvedFile === resolvedProject || resolvedFile.startsWith(`${resolvedProject}/`)))
  ));
  const scope: PiSkillScope = isProjectOwnedPath ? "project" : "global";
  const fromAgentDir = isGlobalAgentSkillPath(skill.filePath, agentDir);
  const origin: PiSkillOrigin = skill.packageSource !== undefined || skill.source === "package"
    ? "package"
    : fromAgentDir ? "agent"
    : isProjectOwnedPath ? "project"
    : skill.piScope === "user" ? "agent"
    : "path";
  const filteredByOwner = skill.ownerPackageDisabled === true;
  const validationMessage = filteredByOwner
    ? `Supplied by the disabled Pi package ${skill.packageSource ?? ""}, which loads none of its resources.`
    : undefined;
  return {
    id: row.identity.id,
    name: skill.name,
    description: skill.description,
    filePath: skill.filePath,
    baseDir: skill.baseDir,
    scope,
    origin,
    source: skill.source,
    ...(skill.packageSource === undefined ? {} : { packageSource: skill.packageSource }),
    ...(filteredByOwner ? { ownerPackageDisabled: true } : {}),
    preference: row.preference,
    answeredBy: row.answeredBy,
    enabled: filteredByOwner ? false : row.enabled,
    ...(row.shadowed === true ? { shadowed: true } : {}),
    ...(row.promoted === true ? { promoted: true } : {}),
    validation: validationMessage === undefined ? "valid" : "warning",
    ...(validationMessage === undefined ? {} : { validationMessage }),
    ...(skill.disableModelInvocation ? { disableModelInvocation: true } : {}),
  };
}

/**
 * Whether pi loads this project's own skills, asked the one way pi asks it.
 *
 * The panel's project row answers with pi's rule (`piProjectIsTrusted`: an explicit decision, and
 * for a project the store has never seen, untrusted when it ships resources that need trust). The
 * discovery that fills the rows has to answer with the same one, or one project gets two answers:
 * a list carrying a cloned project's skills next to a row that says the project is not trusted.
 */
export function projectSkillTrust(agentDir: string, projectPath: string | undefined): boolean {
  return projectPath === undefined ? false : piProjectIsTrusted(agentDir, projectPath);
}

/**
 * The skill paths Pi's own resource loader hands `loadSkills`, in its order.
 *
 * Pi keeps one skill per name and keeps the first it reads, so this list - not the set of files on
 * disk - decides which skill of a name a session loads. The Skills panel shows which skill is in the
 * list, so it has to read the same list the session's loader reads: the enabled skill resources in
 * package-manager resolution order (a project's own skills before a machine's), a directory that holds
 * a `SKILL.md` mapped to that file, deduped, and no default directories added on top. Handing it a
 * different order - defaults first, settings paths appended - makes the panel claim a skill is in a
 * session that the session loads from a different file, which is the one thing this surface must not
 * do (found in a live browser run on 2026-11-14, where a project skill and a machine skill of one name
 * swapped places between panel and session).
 */
function piLoaderSkillPaths(resources: readonly ResolvedResource[]): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const resource of resources) {
    if (!resource.enabled) continue;
    const path = skillResourcePath(resource);
    if (seen.has(path)) continue;
    seen.add(path);
    paths.push(path);
  }
  return paths;
}

/** Pi's loader maps an auto-discovered or package skill directory that holds a `SKILL.md` to that file. */
function skillResourcePath(resource: ResolvedResource): string {
  if (resource.metadata.source !== "auto" && resource.metadata.origin !== "package") return resource.path;
  try {
    if (!statSync(resource.path).isDirectory()) return resource.path;
  } catch {
    return resource.path;
  }
  const skillFile = join(resource.path, "SKILL.md");
  return existsSync(skillFile) ? skillFile : resource.path;
}

/**
 * Pi's own skill discovery for one machine.
 *
 * `resolve` answers "skip" for a package that is configured and not installed: a panel that is only
 * being looked at must not install anything. A package that is configured off contributes no skill
 * path at all, so its skills are read from its install root and reported as unavailable, which is
 * what lets the panel say what the package switch costs without pretending the skill is live.
 */
export function createPiSkillDiscovery(cwd: string, agentDir: string): PiSkillDiscoveryPort {
  return {
    async discover(projectPath) {
      const workspace = projectPath ?? cwd;
      const trusted = projectSkillTrust(agentDir, projectPath);
      const settingsManager = SettingsManager.create(workspace, agentDir, { projectTrusted: trusted });
      const manager = new DefaultPackageManager({ cwd: workspace, agentDir, settingsManager });
      const disabledSources = configuredDisabledSources(settingsManager);
      const resolved = await manager.resolve(() => Promise.resolve("skip"));
      const enabledSkillPaths = piLoaderSkillPaths(resolved.skills);
      const packageRoots = packageRootsBySource(resolved.skills);
      const diagnostics: PiSkillsDiagnostic[] = resolved.skills
        .filter((resource) => !resource.enabled)
        .map((resource) => ({ message: `Filtered out by the Pi package ${resource.metadata.source}.`, path: resource.path }));
      const loaded = loadSkills({
        cwd: workspace,
        agentDir,
        skillPaths: enabledSkillPaths,
        includeDefaults: false,
      });
      const unreadablePaths: PiSkillsDiagnostic[] = [];
      for (const diagnostic of loaded.diagnostics) {
        const entry: PiSkillsDiagnostic = { message: diagnostic.message, ...(diagnostic.path === undefined ? {} : { path: diagnostic.path }) };
        if (diagnostic.type === "collision") diagnostics.push(entry);
        else if (isMissingPathDiagnostic(diagnostic.message)) unreadablePaths.push(entry);
        else diagnostics.push(entry);
      }
      const skills = loaded.skills.map((skill) => ({
        name: skill.name,
        description: skill.description,
        filePath: skill.filePath,
        baseDir: skill.baseDir,
        source: skill.sourceInfo.source,
        piScope: skill.sourceInfo.scope,
        disableModelInvocation: skill.disableModelInvocation,
        ...packageOwner(skill.filePath, packageRoots),
      }));
      const shadowed = recoverShadowedSkills(loaded.diagnostics, loaded.skills, skillPreferenceIdentityFor(agentDir))
        .map((entry) => ({
          name: entry.skill.name,
          description: entry.skill.description,
          filePath: entry.skill.filePath,
          baseDir: entry.skill.baseDir,
          source: entry.skill.sourceInfo.source,
          piScope: entry.skill.sourceInfo.scope,
          disableModelInvocation: entry.skill.disableModelInvocation,
          shadowedByPi: true as const,
          ...packageOwner(entry.skill.filePath, packageRoots),
        }));
      const skillsDirs: { scope: PiSkillScope; path: string }[] = [
        { scope: "global", path: join(agentDir, "skills") },
        ...(projectPath === undefined ? [] : [{ scope: "project" as const, path: join(projectPath, ".pi", "skills") }]),
      ];
      for (const dir of skillsDirs) {
        const unreadable = await describeUnreadableSkillsDir(dir.path);
        if (unreadable !== undefined) unreadablePaths.push(unreadable);
      }
      return {
        skills: [...skills, ...shadowed, ...readDisabledPackageSkills(manager, disabledSources)],
        diagnostics,
        unreadablePaths,
        skillsDirs,
      };
    },
  };
}

/**
 * A scan directory that cannot be listed yields a short list that is not a short set of skills.
 *
 * pi's scanner walks what it can read and says nothing about the rest, so a permissions failure shows
 * up as fewer skills with no word about why - and a panel that answers "none configured" about a
 * directory it could not open is asserting something it did not learn. A directory that is simply not
 * there is left alone: pi looks in places a fresh install never creates, and that absence is empty.
 */
export async function describeUnreadableSkillsDir(path: string): Promise<PiSkillsDiagnostic | undefined> {
  try {
    await readdir(path);
    return undefined;
  } catch (error) {
    const code = isRecord(error) && typeof error["code"] === "string" ? error["code"] : "unknown";
    if (code === "ENOENT") return undefined;
    return { path, message: `The skills directory could not be listed (${code}), so its skills are not known.` };
  }
}

function isMissingPathDiagnostic(message: string): boolean {
  return message.includes("does not exist") || message.includes("not a file") || message.includes("failed to load");
}

/** The configured sources whose filter loads nothing of the package. */
export function configuredDisabledSources(settingsManager: SettingsManager): { source: string; scope: "user" | "project" }[] {
  const rows: { source: string; scope: "user" | "project" }[] = [];
  for (const [scope, entries] of [["user", settingsManager.getGlobalSettings().packages], ["project", settingsManager.getProjectSettings().packages]] as const) {
    for (const entry of entries ?? []) {
      if (isDisabledPackageSource(entry)) rows.push({ source: packageSourceString(entry), scope });
    }
  }
  return rows;
}

function packageRootsBySource(resources: readonly { path: string; metadata: { source: string; packageRoot?: string } }[]): Map<string, string> {
  const roots = new Map<string, string>();
  for (const resource of resources) {
    const root = resource.metadata.packageRoot;
    if (root !== undefined) roots.set(resource.metadata.source, resolve(root));
  }
  return roots;
}

function packageOwner(filePath: string, roots: Map<string, string>): { packageSource?: string } {
  const resolved = resolve(filePath);
  for (const [source, root] of roots) {
    if (resolved === root || resolved.startsWith(`${root}/`)) return { packageSource: source };
  }
  return {};
}

/** The skills a disabled package would supply, read from its install root so the panel can name them. */
function readDisabledPackageSkills(
  manager: DefaultPackageManager,
  packages: readonly { source: string; scope: "user" | "project" }[],
): DiscoveredSkill[] {
  const skills: DiscoveredSkill[] = [];
  for (const entry of packages) {
    const installedPath = manager.getInstalledPath(entry.source, entry.scope);
    if (installedPath === undefined) continue;
    const dir = join(installedPath, "skills");
    if (!resolve(dir).startsWith(resolve(installedPath))) continue;
    const result = loadSkillsFromDir({ dir, source: entry.source });
    for (const skill of result.skills) {
      skills.push({
        name: skill.name,
        description: skill.description,
        filePath: skill.filePath,
        baseDir: skill.baseDir,
        source: entry.source,
        piScope: entry.scope,
        disableModelInvocation: skill.disableModelInvocation,
        packageSource: entry.source,
        ownerPackageDisabled: true,
      });
    }
  }
  return skills;
}

export function fileSkillPreferencesStore(): SkillPreferencesStore {
  return {
    readGlobal: () => loadGlobalSkillPreferences(),
    writeGlobal: (config) => saveGlobalSkillPreferences(config),
    readProject: (projectPath) => loadProjectSkillPreferences(projectPath),
    writeProject: (projectPath, config) => saveProjectSkillPreferences(projectPath, config),
  };
}

/**
 * The Skills service of the agent profile this machine is running right now. `projects` is built
 * per agent directory because the profile decides which trust store answers for a project.
 */
export function createActiveProfilePiSkillsService(
  activeAgentProfile: ActiveAgentProfileProvider,
  projects: (agentDir: string) => SettingsProjectResolver = () => unconfiguredSettingsProjectResolver(),
  cwd = process.cwd(),
): PiSkillsService {
  return new ActiveProfilePiSkillsService(activeAgentProfile, (agentDir) => createDefaultPiSkillsService(cwd, agentDir, projects(agentDir)));
}

export function createDefaultPiSkillsService(cwd: string, agentDir: string, projects: SettingsProjectResolver = unconfiguredSettingsProjectResolver()): PiSkillsService {
  return new DefaultPiSkillsService(
    createPiSkillDiscovery(cwd, agentDir),
    fileSkillPreferencesStore(),
    {
      requireProjectPath: (projectId) => projects.requireProjectPath(projectId),
      isProjectTrusted: (projectPath) => piProjectIsTrusted(agentDir, projectPath),
    },
    agentDir,
  );
}

/**
 * The active profile decides the agent directory, so the panel reads the skills the next session
 * on this machine will load, and a profile switch moves the panel with it.
 */
export class ActiveProfilePiSkillsService implements PiSkillsService {
  constructor(
    private readonly activeAgentProfile: ActiveAgentProfileProvider,
    private readonly serviceForAgentDir: (agentDir: string) => PiSkillsService,
  ) {}

  async list(request: PiSkillsListRequest): Promise<PiSkillsResponse> {
    return await (await this.service()).list(request);
  }

  async setEnabled(request: PiSkillSetEnabledRequest): Promise<PiSkillSetEnabledResponse> {
    return await (await this.service()).setEnabled(request);
  }

  private async service(): Promise<PiSkillsService> {
    const profile = await requireActiveAgentProfile(this.activeAgentProfile);
    return this.serviceForAgentDir(profile.dir);
  }
}

/** `skills/foo/SKILL.md` for a skill root, `foo.md` for a loose file: the path a reader recognises. */
