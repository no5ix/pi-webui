import { join } from "node:path";
import { DefaultPackageManager, SettingsManager, type PackageSource } from "@earendil-works/pi-coding-agent";
import type {
  PiPackageInfo,
  PiPackageInstallRequest,
  PiPackageMutationAction,
  PiPackageMutationResponse,
  PiPackageRemoveRequest,
  PiPackageScope,
  PiPackagesListRequest,
  PiPackagesResponse,
  PiPackageSetEnabledRequest,
  PiPackageUpdateRequest,
} from "../../shared/apiTypes.js";
import { requireActiveAgentProfile, type ActiveAgentProfileProvider } from "./activeAgentProfileProvider.js";
import { SettingsProjectError, type SettingsProjectResolver } from "../shared/resources/settingsProjectResolver.js";
import {
  isDisabledPackageSource,
  isFilteredPackageSource,
  packageSourceForEnabled,
  packageSourceString,
} from "../shared/resources/piPackageState.js";

/**
 * The package operations PI WEB needs from pi, in pi's own words.
 *
 * Enable and disable are settings writes, not install operations: the entries of one scope's
 * `packages` list are read and written whole, so a change touches that scope only and pi's own
 * filter carries it into every later resource resolution.
 *
 * Scope is decided by the *directory pi is pointed at*, because that is how pi decides it:
 * `SettingsManager.create(cwd, agentDir)` reads `<cwd>/.pi/settings.json` for the project scope, and
 * `installAndPersist(source, { local: true })` writes to that same file. A project-scope operation
 * therefore needs a manager built for the project's directory, never for the directory the web
 * process happens to start in. Every request that speaks about a project names it by id and lets
 * this module resolve the id, so a browser can never read a directory by naming a path — the same
 * rule the MCP and Skills settings follow, and for the same reason: on a remote machine the
 * project's folders are that machine's.
 */

/** One row of pi's own configured-package listing, before PI WEB adds the switch's state. */
export interface ConfiguredPackageRow {
  source: string;
  scope: PiPackageScope;
  filtered: boolean;
  installedPath?: string;
}

export interface PiPackageManagerPort {
  listConfiguredPackages(): ConfiguredPackageRow[];
  readPackageEntries(scope: PiPackageScope): PackageSource[];
  writePackageEntries(scope: PiPackageScope, entries: PackageSource[]): Promise<void>;
  installAndPersist(source: string, options?: { local?: boolean }): Promise<void>;
  removeAndPersist(source: string, options?: { local?: boolean }): Promise<boolean>;
  update(source?: string): Promise<void>;
  flush?(): Promise<void>;
  /** The two settings files this manager reads, so a response can name the file a write goes to. */
  settingsPaths(): { global: string; project: string };
}

/**
 * The project a package request is about, resolved by the server.
 *
 * `projectPath` is undefined for a request that names no project, which is a machine-wide request:
 * its project scope is not the server's own folder, so the project rows of such a read are not
 * reported at all.
 */
export interface PiPackageScopeContext {
  projectId?: string;
  projectPath?: string;
  projectTrusted: boolean;
}

/** A package the request names is not configured in the scope it names. */
export class PiPackageNotFoundError extends Error {
  override name = "PiPackageNotFoundError";
}

/** A request this machine will not act on: the scope it names is one it must not touch. */
export class PiPackageScopeError extends Error {
  override name = "PiPackageScopeError";
}

export interface PiPackageService {
  list(request: PiPackagesListRequest): Promise<PiPackagesResponse>;
  install(request: PiPackageInstallRequest): Promise<PiPackageMutationResponse>;
  remove(request: PiPackageRemoveRequest): Promise<PiPackageMutationResponse>;
  update(request: PiPackageUpdateRequest): Promise<PiPackageMutationResponse>;
  setEnabled(request: PiPackageSetEnabledRequest): Promise<PiPackageMutationResponse>;
}

/** A service for one agent profile and one project directory. */
export type PiPackageServiceFactory = (context: PiPackageScopeContext & { agentDir: string; cwd: string }) => PiPackageService;

/**
 * The service a running web process uses: one pi manager per (profile, project directory).
 *
 * The profile decides the global file, the project directory decides the project file, and the
 * profile's trust store decides whether a project's own file may be opened. All three are the
 * server's knowledge, so the request carries ids and never paths.
 */
export class ActiveProfilePiPackageService implements PiPackageService {
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly activeAgentProfile: ActiveAgentProfileProvider,
    private readonly factory: PiPackageServiceFactory,
    private readonly settingsProjects: (agentDir: string) => SettingsProjectResolver,
  ) {}

  list(request: PiPackagesListRequest): Promise<PiPackagesResponse> {
    return this.withService(request, (service) => service.list(request));
  }

  install(request: PiPackageInstallRequest): Promise<PiPackageMutationResponse> {
    return this.enqueueMutation(request, (service) => service.install(request));
  }

  remove(request: PiPackageRemoveRequest): Promise<PiPackageMutationResponse> {
    return this.enqueueMutation(request, (service) => service.remove(request));
  }

  update(request: PiPackageUpdateRequest): Promise<PiPackageMutationResponse> {
    return this.enqueueMutation(request, (service) => service.update(request));
  }

  setEnabled(request: PiPackageSetEnabledRequest): Promise<PiPackageMutationResponse> {
    return this.enqueueMutation(request, (service) => service.setEnabled(request));
  }

  private enqueueMutation(request: PiPackagesListRequest, operation: (service: PiPackageService) => Promise<PiPackageMutationResponse>): Promise<PiPackageMutationResponse> {
    const queuedMutation = this.mutationQueue.then(() => this.withService(request, operation));
    this.mutationQueue = queuedMutation.then(
      () => undefined,
      () => undefined,
    );
    return queuedMutation;
  }

  private async withService<T>(request: PiPackagesListRequest, operation: (service: PiPackageService) => Promise<T>): Promise<T> {
    const profile = await requireActiveAgentProfile(this.activeAgentProfile);
    return await operation(await this.serviceFor(profile.dir, request));
  }

  private async serviceFor(agentDir: string, request: PiPackagesListRequest): Promise<PiPackageService> {
    const projectId = request.projectId?.trim();
    if (projectId === undefined || projectId === "") return this.factory({ agentDir, cwd: process.cwd(), projectTrusted: false });
    const projects = this.settingsProjects(agentDir);
    const projectPath = await projects.requireProjectPath(projectId);
    return this.factory({ agentDir, cwd: projectPath, projectId, projectPath, projectTrusted: projects.isProjectTrusted(projectPath) });
  }
}

export class DefaultPiPackageService implements PiPackageService {
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly manager: PiPackageManagerPort,
    private readonly scope: PiPackageScopeContext = { projectTrusted: false },
  ) {}

  list(_request: PiPackagesListRequest = {}): Promise<PiPackagesResponse> {
    return Promise.resolve(this.listResponse());
  }

  install(request: PiPackageInstallRequest): Promise<PiPackageMutationResponse> {
    return this.enqueueMutation(async () => {
      const scope = request.scope ?? "user";
      this.requireWritableScope(scope);
      await this.manager.installAndPersist(request.source, scope === "project" ? { local: true } : undefined);
      await this.flushSettings();
      return this.mutationResponse("install", { source: request.source, scope, requiresReload: true });
    });
  }

  remove(request: PiPackageRemoveRequest): Promise<PiPackageMutationResponse> {
    return this.enqueueMutation(async () => {
      const scope = request.scope ?? "user";
      this.requireWritableScope(scope);
      const removedByManager = scope === "project"
        ? await this.manager.removeAndPersist(request.source, { local: true })
        : await this.manager.removeAndPersist(request.source);
      const droppedEntries = removedByManager ? 0 : await this.dropRecordedEntry(request.source, scope);
      await this.flushSettings();
      return this.mutationResponse("remove", { source: request.source, scope, removed: removedByManager || droppedEntries > 0, requiresReload: true });
    });
  }

  /**
   * The settings file can name a package in a form pi's manager does not remove.
   *
   * A path package installed by URL is recorded in the shape the machine wrote - for a package inside
   * the project's reach, the relative path - and the browser pass found a removal that pi answered
   * "nothing to remove" while the file still named that package, so a reader's Install then Remove left
   * the package installed with a page agreeing it was. pi is asked first, because a manager removal
   * also unregisters what it loaded. When it declines, drop the entry that records that source, through
   * the same write the enabled switch uses, and report `removed: false` when no entry names it: the page
   * then says nothing was removed, which is the truth about that file.
   */
  private async dropRecordedEntry(source: string, scope: PiPackageScope): Promise<number> {
    const entries = this.manager.readPackageEntries(scope);
    const keep = entries.filter((entry) => packageSourceString(entry) !== source);
    if (keep.length === entries.length) return 0;
    await this.manager.writePackageEntries(scope, keep);
    return entries.length - keep.length;
  }

  update(request: PiPackageUpdateRequest = {}): Promise<PiPackageMutationResponse> {
    return this.enqueueMutation(async () => {
      const source = request.source;
      if (source === undefined) {
        this.requireWritableScope("user");
        await this.manager.update();
        await this.flushSettings();
        return this.mutationResponse("update", { requiresReload: true });
      }

      const scope = request.scope ?? "user";
      this.requireWritableScope(scope);
      await this.manager.update(source);
      await this.flushSettings();
      return this.mutationResponse("update", { source, scope, requiresReload: true });
    });
  }

  /**
   * Moves one package's filter, in the scope the request names, and nothing else.
   *
   * The entry is found by pi's own source string, and a scope that does not configure it is an
   * error rather than a write: a project-scope request can never reach the global list, and a
   * package this machine has never installed is not something a switch can turn on.
   */
  setEnabled(request: PiPackageSetEnabledRequest): Promise<PiPackageMutationResponse> {
    return this.enqueueMutation(async () => {
      const requested = request.source.trim();
      if (requested === "") throw new PiPackageNotFoundError("A Pi package source must be a non-empty string");
      this.requireWritableScope(request.scope);
      const entries = this.manager.readPackageEntries(request.scope);
      const index = entries.findIndex((entry) => packageSourceString(entry) === requested);
      if (index < 0) throw new PiPackageNotFoundError(`No Pi package "${requested}" is configured in the ${request.scope === "project" ? "project" : "user"} scope`);
      const updated = [...entries];
      updated[index] = packageSourceForEnabled(requested, request.enabled);
      await this.manager.writePackageEntries(request.scope, updated);
      await this.flushSettings();
      return this.mutationResponse("set-enabled", { source: requested, scope: request.scope, enabled: request.enabled, requiresReload: true });
    });
  }

  /**
   * A project's package file is a project's own code to run, so pi's trust decision gates it.
   *
   * A machine-wide request is never gated, and a project request that names no project is refused:
   * the project scope of a request with no project is the folder the web process started in, and
   * writing packages there from a project card would be somebody else's file.
   */
  private requireWritableScope(scope: PiPackageScope): void {
    if (scope === "user") return;
    if (this.scope.projectPath === undefined) {
      throw new PiPackageScopeError("A project-scope package operation needs a project this machine knows.");
    }
    if (!this.scope.projectTrusted) {
      throw new PiPackageScopeError("This project is not trusted, so its Pi packages are not read, changed, or installed. Trust the project in pi first.");
    }
  }

  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const queuedMutation = this.mutationQueue.then(operation);
    this.mutationQueue = queuedMutation.then(
      () => undefined,
      () => undefined,
    );
    return queuedMutation;
  }

  private mutationResponse(action: PiPackageMutationAction, metadata: Omit<PiPackageMutationResponse, "action" | "packages">): PiPackageMutationResponse {
    return { action, ...metadata, ...this.listResponse() };
  }

  private async flushSettings(): Promise<void> {
    await this.manager.flush?.();
  }

  private listResponse(): PiPackagesResponse {
    const paths = this.manager.settingsPaths();
    const projectScopeRead = this.scope.projectPath !== undefined && this.scope.projectTrusted;
    return {
      packages: this.listPackages(projectScopeRead),
      globalConfigPath: paths.global,
      ...(this.scope.projectId === undefined ? {} : { projectId: this.scope.projectId }),
      ...(this.scope.projectPath === undefined ? {} : { projectPath: this.scope.projectPath, projectConfigPath: paths.project }),
      projectTrusted: this.scope.projectTrusted,
      projectScopeRead,
    };
  }

  private listPackages(projectScopeRead: boolean): PiPackageInfo[] {
    const entriesByScope: Record<PiPackageScope, PackageSource[]> = {
      user: this.manager.readPackageEntries("user"),
      project: this.manager.readPackageEntries("project"),
    };
    return this.manager.listConfiguredPackages()
      .filter((configuredPackage) => configuredPackage.scope === "user" || projectScopeRead)
      .map((configuredPackage) => {
        const entry = entriesByScope[configuredPackage.scope].find((candidate) => packageSourceString(candidate) === configuredPackage.source);
        const disabled = isDisabledPackageSource(entry);
        return {
          source: configuredPackage.source,
          scope: configuredPackage.scope,
          filtered: configuredPackage.filtered || isFilteredPackageSource(entry),
          ...(configuredPackage.installedPath === undefined ? {} : { installedPath: configuredPackage.installedPath }),
          disabled,
          enabled: !disabled,
        };
      });
  }
}

export function createActiveProfilePiPackageService(
  activeAgentProfile: ActiveAgentProfileProvider,
  settingsProjects: (agentDir: string) => SettingsProjectResolver,
): PiPackageService {
  return new ActiveProfilePiPackageService(activeAgentProfile, (context) => createDefaultPiPackageService(context), settingsProjects);
}

export function createDefaultPiPackageService(context: PiPackageScopeContext & { agentDir: string; cwd: string }): PiPackageService {
  const settingsManager = SettingsManager.create(context.cwd, context.agentDir);
  const manager = new DefaultPackageManager({ cwd: context.cwd, agentDir: context.agentDir, settingsManager });
  return new DefaultPiPackageService(
    {
      listConfiguredPackages: () => manager.listConfiguredPackages(),
      readPackageEntries: (scope) => (scope === "project" ? settingsManager.getProjectSettings().packages : settingsManager.getGlobalSettings().packages) ?? [],
      writePackageEntries: async (scope, entries) => {
        if (scope === "project") settingsManager.setProjectPackages(entries);
        else settingsManager.setPackages(entries);
        await settingsManager.flush();
      },
      installAndPersist: (source, options) => manager.installAndPersist(source, options),
      removeAndPersist: (source, options) => manager.removeAndPersist(source, options),
      update: (source) => manager.update(source),
      flush: () => settingsManager.flush(),
      settingsPaths: () => ({ global: piGlobalSettingsPath(context.agentDir), project: piProjectSettingsPath(context.cwd) }),
    },
    {
      ...(context.projectId === undefined ? {} : { projectId: context.projectId }),
      ...(context.projectPath === undefined ? {} : { projectPath: context.projectPath }),
      projectTrusted: context.projectTrusted,
    },
  );
}

/** pi's own two package files, in the words the panel shows. */
export function piGlobalSettingsPath(agentDir: string): string {
  return join(agentDir, "settings.json");
}

export function piProjectSettingsPath(projectPath: string): string {
  return join(projectPath, ".pi", "settings.json");
}

export { SettingsProjectError };
