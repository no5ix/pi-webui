import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  DefaultPackageManager,
  loadSkills,
  loadSkillsFromDir,
  SettingsManager,
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
  isSkillEnabled,
  loadProjectSkillPreferences,
  resolveSkillPreference,
  saveProjectSkillPreferences,
  type LoadedProjectSkillPreferences,
} from "../shared/resources/skillPreferences.js";
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
  /** pi's own scope: a user (global) install, a project one, or a temporary one. */
  piScope: "user" | "project" | "temporary";
  disableModelInvocation: boolean;
  /** The configured Pi package whose install root holds this skill. */
  packageSource?: string;
  /** A package that is configured off, so this skill is not in the runtime list at all. */
  ownerPackageDisabled?: boolean;
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
 * The Skills panel's service: pi's own discovery, with PI WEB's saved preference applied to it.
 *
 * Discovery is pi's, not a list PI WEB keeps. The configured packages are resolved without
 * installing anything, their enabled skill paths and the settings' skill paths go to
 * `loadSkills`, and that is the same call pi's resource loader makes. The saved preference is the
 * one the session's `skillsOverride` filter reads, so the panel and the runtime cannot disagree.
 */
export class DefaultPiSkillsService implements PiSkillsService {
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly discovery: PiSkillDiscoveryPort,
    private readonly preferences: SkillPreferencesStore,
    private readonly projects: SettingsProjectResolver,
  ) {}

  async list(request: PiSkillsListRequest): Promise<PiSkillsResponse> {
    const scope = await this.resolveScope(request.projectId);
    return this.response(await this.discovery.discover(scope.projectPath), scope);
  }

  async setEnabled(request: PiSkillSetEnabledRequest): Promise<PiSkillSetEnabledResponse> {
    const name = request.name.trim();
    if (name === "") throw new PiSkillsRequestError("A skill preference needs a skill name");
    const scope = await this.resolveScope(request.projectId);
    if (request.scope === "project" && scope.projectPath === undefined) {
      throw new PiSkillsRequestError("A project-scope skill preference needs a project");
    }
    return await this.enqueueMutation(async () => {
      const projectPath = scope.projectPath;
      const discovered = await this.discovery.discover(projectPath);
      if (!discovered.skills.some((skill) => skill.name === name)) {
        const scopeLabel = request.scope === "project" ? "for this project" : "on this machine";
        throw new PiSkillNotFoundError(`No skill named "${name}" is available ${scopeLabel}`);
      }
      if (request.scope === "project" && projectPath !== undefined) {
        const stored = this.preferences.readProject(projectPath);
        this.preferences.writeProject(projectPath, applySkillPreference(stored.config, name, request.enabled));
      } else {
        const stored = this.preferences.readGlobal();
        this.preferences.writeGlobal(applySkillPreference(stored.config, name, request.enabled));
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
    const skills = found.skills.map((skill) => describeSkill(skill, global.config, project?.config));
    return {
      skills,
      diagnostics: found.diagnostics,
      unreadablePaths: found.unreadablePaths,
      scopes: scopeRows(found, global, project, scope),
    };
  }
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

function describeSkill(skill: DiscoveredSkill, global: PiSkillPreferenceConfig, project: PiSkillPreferenceConfig | undefined): PiSkillInfo {
  const scope: PiSkillScope = skill.piScope === "project" ? "project" : "global";
  const origin: PiSkillOrigin = skill.packageSource !== undefined
    ? "package"
    : skill.source === "user" ? "agent" : skill.source === "project" ? "project" : "path";
  const filteredByOwner = skill.ownerPackageDisabled === true;
  const validationMessage = filteredByOwner
    ? `Supplied by the disabled Pi package ${skill.packageSource ?? ""}, which loads none of its resources.`
    : undefined;
  return {
    name: skill.name,
    description: skill.description,
    filePath: skill.filePath,
    baseDir: skill.baseDir,
    scope,
    origin,
    source: skill.source,
    ...(skill.packageSource === undefined ? {} : { packageSource: skill.packageSource }),
    ...(filteredByOwner ? { ownerPackageDisabled: true } : {}),
    preference: resolveSkillPreference(skill.name, global, project),
    enabled: filteredByOwner ? false : isSkillEnabled(skill.name, global, project),
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
  return projectPath === undefined ? true : piProjectIsTrusted(agentDir, projectPath);
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
      const enabledPaths = resolved.skills.filter((resource) => resource.enabled).map((resource) => resource.path);
      const packageRoots = packageRootsBySource(resolved.skills);
      const diagnostics: PiSkillsDiagnostic[] = resolved.skills
        .filter((resource) => !resource.enabled)
        .map((resource) => ({ message: `Filtered out by the Pi package ${resource.metadata.source}.`, path: resource.path }));
      const loaded = loadSkills({
        cwd: workspace,
        agentDir,
        skillPaths: [...enabledPaths, ...settingsManager.getSkillPaths()],
        includeDefaults: true,
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
      const skillsDirs: { scope: PiSkillScope; path: string }[] = [
        { scope: "global", path: join(agentDir, "skills") },
        ...(projectPath === undefined ? [] : [{ scope: "project" as const, path: join(projectPath, ".pi", "skills") }]),
      ];
      for (const dir of skillsDirs) {
        const unreadable = await describeUnreadableSkillsDir(dir.path);
        if (unreadable !== undefined) unreadablePaths.push(unreadable);
      }
      return {
        skills: [...skills, ...readDisabledPackageSkills(manager, disabledSources)],
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
