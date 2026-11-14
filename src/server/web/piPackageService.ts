import { DefaultPackageManager, SettingsManager, type PackageSource } from "@earendil-works/pi-coding-agent";
import type { PiPackageInfo, PiPackageMutationAction, PiPackageMutationResponse, PiPackageScope, PiPackagesResponse } from "../../shared/apiTypes.js";
import { requireActiveAgentProfile, type ActiveAgentProfileProvider } from "./activeAgentProfileProvider.js";
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
}

/** A package the request names is not configured in the scope it names. */
export class PiPackageNotFoundError extends Error {
  override name = "PiPackageNotFoundError";
}

export interface PiPackageService {
  list(): Promise<PiPackagesResponse>;
  install(source: string): Promise<PiPackageMutationResponse>;
  remove(source: string, scope?: PiPackageScope): Promise<PiPackageMutationResponse>;
  update(source?: string): Promise<PiPackageMutationResponse>;
  setEnabled(source: string, scope: PiPackageScope, enabled: boolean): Promise<PiPackageMutationResponse>;
}

export type PiPackageServiceForAgentDir = (agentDir: string) => PiPackageService;

export class ActiveProfilePiPackageService implements PiPackageService {
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly activeAgentProfile: ActiveAgentProfileProvider,
    private readonly serviceForAgentDir: PiPackageServiceForAgentDir,
  ) {}

  async list(): Promise<PiPackagesResponse> {
    return await this.withActiveService((service) => service.list());
  }

  install(source: string): Promise<PiPackageMutationResponse> {
    return this.enqueueMutation((service) => service.install(source));
  }

  remove(source: string, scope?: PiPackageScope): Promise<PiPackageMutationResponse> {
    return this.enqueueMutation((service) => service.remove(source, scope));
  }

  update(source?: string): Promise<PiPackageMutationResponse> {
    return this.enqueueMutation((service) => service.update(source));
  }

  setEnabled(source: string, scope: PiPackageScope, enabled: boolean): Promise<PiPackageMutationResponse> {
    return this.enqueueMutation((service) => service.setEnabled(source, scope, enabled));
  }

  private enqueueMutation(operation: (service: PiPackageService) => Promise<PiPackageMutationResponse>): Promise<PiPackageMutationResponse> {
    const queuedMutation = this.mutationQueue.then(() => this.withActiveService(operation));
    this.mutationQueue = queuedMutation.then(
      () => undefined,
      () => undefined,
    );
    return queuedMutation;
  }

  private async withActiveService<T>(operation: (service: PiPackageService) => Promise<T>): Promise<T> {
    const profile = await requireActiveAgentProfile(this.activeAgentProfile);
    return await operation(this.serviceForAgentDir(profile.dir));
  }
}

export class DefaultPiPackageService implements PiPackageService {
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly manager: PiPackageManagerPort) {}

  list(): Promise<PiPackagesResponse> {
    return Promise.resolve({ packages: this.listPackages() });
  }

  install(source: string): Promise<PiPackageMutationResponse> {
    return this.enqueueMutation(async () => {
      await this.manager.installAndPersist(source);
      await this.flushSettings();
      return this.mutationResponse("install", { source, requiresReload: true });
    });
  }

  remove(source: string, scope: PiPackageScope = "user"): Promise<PiPackageMutationResponse> {
    return this.enqueueMutation(async () => {
      const removed = scope === "project"
        ? await this.manager.removeAndPersist(source, { local: true })
        : await this.manager.removeAndPersist(source);
      await this.flushSettings();
      return this.mutationResponse("remove", { source, scope, removed, requiresReload: true });
    });
  }

  update(source?: string): Promise<PiPackageMutationResponse> {
    return this.enqueueMutation(async () => {
      if (source === undefined) {
        await this.manager.update();
        await this.flushSettings();
        return this.mutationResponse("update", { requiresReload: true });
      }

      await this.manager.update(source);
      await this.flushSettings();
      return this.mutationResponse("update", { source, requiresReload: true });
    });
  }

  /**
   * Moves one package's filter, in the scope the request names, and nothing else.
   *
   * The entry is found by pi's own source string, and a scope that does not configure it is an
   * error rather than a write: a project-scope request can never reach the global list, and a
   * package this machine has never installed is not something a switch can turn on.
   */
  setEnabled(source: string, scope: PiPackageScope, enabled: boolean): Promise<PiPackageMutationResponse> {
    return this.enqueueMutation(async () => {
      const requested = source.trim();
      if (requested === "") throw new PiPackageNotFoundError("A Pi package source must be a non-empty string");
      const entries = this.manager.readPackageEntries(scope);
      const index = entries.findIndex((entry) => packageSourceString(entry) === requested);
      if (index < 0) throw new PiPackageNotFoundError(`No Pi package "${requested}" is configured in the ${scope === "project" ? "project" : "user"} scope`);
      const updated = [...entries];
      updated[index] = packageSourceForEnabled(requested, enabled);
      await this.manager.writePackageEntries(scope, updated);
      await this.flushSettings();
      return this.mutationResponse("set-enabled", { source: requested, scope, enabled, requiresReload: true });
    });
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
    return { action, ...metadata, packages: this.listPackages() };
  }

  private async flushSettings(): Promise<void> {
    await this.manager.flush?.();
  }

  private listPackages(): PiPackageInfo[] {
    const entriesByScope: Record<PiPackageScope, PackageSource[]> = {
      user: this.manager.readPackageEntries("user"),
      project: this.manager.readPackageEntries("project"),
    };
    return this.manager.listConfiguredPackages().map((configuredPackage) => {
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

export function createActiveProfilePiPackageService(activeAgentProfile: ActiveAgentProfileProvider, cwd = process.cwd()): PiPackageService {
  return new ActiveProfilePiPackageService(activeAgentProfile, (agentDir) => createDefaultPiPackageService(cwd, agentDir));
}

export function createDefaultPiPackageService(cwd: string, agentDir: string): PiPackageService {
  const settingsManager = SettingsManager.create(cwd, agentDir);
  const manager = new DefaultPackageManager({ cwd, agentDir, settingsManager });
  return new DefaultPiPackageService({
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
  });
}
