import { describe, expect, it, vi } from "vitest";
import type { PackageSource } from "@earendil-works/pi-coding-agent";
import type { PiPackageInfo, PiPackageScope } from "../../shared/apiTypes.js";
import { type ActiveAgentProfileProvider } from "./activeAgentProfileProvider.js";
import {
  ActiveProfilePiPackageService,
  DefaultPiPackageService,
  PiPackageNotFoundError,
  PiPackageScopeError,
  type ConfiguredPackageRow,
  type PiPackageManagerPort,
  type PiPackageScopeContext,
  type PiPackageService,
} from "./piPackageService.js";
import { SettingsProjectError, type SettingsProjectResolver } from "../shared/resources/settingsProjectResolver.js";

function fakeManager(packages: ConfiguredPackageRow[] = [], entries: Partial<Record<PiPackageScope, PackageSource[]>> = {}) {
  const listConfiguredPackages = vi.fn<PiPackageManagerPort["listConfiguredPackages"]>(() => packages);
  const readPackageEntries = vi.fn<PiPackageManagerPort["readPackageEntries"]>((scope) => entries[scope] ?? []);
  const writePackageEntries = vi.fn<PiPackageManagerPort["writePackageEntries"]>(() => Promise.resolve());
  const installAndPersist = vi.fn<PiPackageManagerPort["installAndPersist"]>(() => Promise.resolve());
  const removeAndPersist = vi.fn<PiPackageManagerPort["removeAndPersist"]>(() => Promise.resolve(true));
  const update = vi.fn<PiPackageManagerPort["update"]>(() => Promise.resolve());
  const settingsPaths = vi.fn<PiPackageManagerPort["settingsPaths"]>(() => ({ global: "/agent/settings.json", project: "/project/.pi/settings.json" }));
  const manager: PiPackageManagerPort = { listConfiguredPackages, readPackageEntries, writePackageEntries, installAndPersist, removeAndPersist, update, settingsPaths };
  return { manager, listConfiguredPackages, readPackageEntries, writePackageEntries, installAndPersist, removeAndPersist, update, settingsPaths };
}

/** The state PI WEB reports for a package whose entry loads its resources. */
function enabledInfo(row: Omit<PiPackageInfo, "disabled" | "enabled">): PiPackageInfo {
  return { ...row, disabled: false, enabled: true };
}

/** The scope a machine-wide request answers: no project, so no project rows and no project file. */
const machineScope: PiPackageScopeContext = { projectTrusted: false };

/** The scope of a request that names a project this machine trusts. */
const trustedProject: PiPackageScopeContext = { projectId: "p-1", projectPath: "/project", projectTrusted: true };

/** The scope of a request that names a project pi will not load resources for. */
const untrustedProject: PiPackageScopeContext = { projectId: "p-1", projectPath: "/project", projectTrusted: false };

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function resolverFor(projects: Record<string, string>, trusted: boolean): SettingsProjectResolver {
  return {
    requireProjectPath: (projectId) => {
      const path = projects[projectId];
      if (path === undefined) return Promise.reject(new SettingsProjectError(404, `Project ${projectId} was not found`));
      return Promise.resolve(path);
    },
    isProjectTrusted: () => trusted,
  };
}

describe("ActiveProfilePiPackageService", () => {
  it("uses the daemon profile active when each package operation begins", async () => {
    const getActiveAgentProfile = vi.fn<ActiveAgentProfileProvider["getActiveAgentProfile"]>()
      .mockResolvedValueOnce(availableProfile("/state/first"))
      .mockResolvedValueOnce(availableProfile("/state/second"));
    const firstService = fakePiPackageService("first");
    const secondService = fakePiPackageService("second");
    const serviceForContext = vi.fn((context: { agentDir: string; cwd: string; projectTrusted: boolean }): PiPackageService => context.agentDir === "/state/first" ? firstService : secondService);
    const service = new ActiveProfilePiPackageService({ getActiveAgentProfile }, serviceForContext, () => resolverFor({}, true));

    await expect(service.list({})).resolves.toEqual({ packages: [enabledInfo({ source: "first", scope: "user", filtered: false })] });
    await expect(service.install({ source: "npm:@acme/tools" })).resolves.toMatchObject({ action: "install", source: "npm:@acme/tools", packages: [{ source: "second" }] });

    expect(serviceForContext).toHaveBeenNthCalledWith(1, { agentDir: "/state/first", cwd: process.cwd(), projectTrusted: false });
    expect(serviceForContext).toHaveBeenNthCalledWith(2, { agentDir: "/state/second", cwd: process.cwd(), projectTrusted: false });
    expect(firstService.list).toHaveBeenCalledOnce();
    expect(secondService.install).toHaveBeenCalledWith({ source: "npm:@acme/tools" });
  });

  it("passes an enable change to the profile that is active when the change begins", async () => {
    const getActiveAgentProfile = vi.fn<ActiveAgentProfileProvider["getActiveAgentProfile"]>()
      .mockResolvedValueOnce(availableProfile("/state/first"))
      .mockResolvedValueOnce(availableProfile("/state/second"));
    const firstService = fakePiPackageService("first");
    const secondService = fakePiPackageService("second");
    const service = new ActiveProfilePiPackageService({ getActiveAgentProfile }, (context) => context.agentDir === "/state/first" ? firstService : secondService, () => resolverFor({ "p-1": "/project" }, true));

    await expect(service.setEnabled({ source: "npm:@acme/tools", scope: "project", enabled: false, projectId: "p-1" })).resolves.toMatchObject({ action: "set-enabled", scope: "project", enabled: false });

    expect(firstService.setEnabled).toHaveBeenCalledWith({ source: "npm:@acme/tools", scope: "project", enabled: false, projectId: "p-1" });
  });

  /**
   * The project decides the directory pi is pointed at, because pi's project scope is the settings
   * file of a directory. A request that names a project must therefore be answered by a service
   * bound to that project's path, and one that names no project by the machine's own.
   */
  it("binds a project-scope request to the project's directory and reports pi's trust decision", async () => {
    const getActiveAgentProfile = vi.fn<ActiveAgentProfileProvider["getActiveAgentProfile"]>().mockResolvedValue(availableProfile("/state/a"));
    const projectService = fakePiPackageService("project-tools");
    const machineService = fakePiPackageService("global-tools");
    const serviceForContext = vi.fn((context: { agentDir: string; cwd: string; projectTrusted: boolean }): PiPackageService => context.cwd === "/state/a/project" ? projectService : machineService);
    const service = new ActiveProfilePiPackageService({ getActiveAgentProfile }, serviceForContext, () => resolverFor({ "p-1": "/state/a/project" }, true));

    await service.remove({ source: "../project-tools", scope: "project", projectId: "p-1" });
    await service.list({});

    expect(serviceForContext).toHaveBeenNthCalledWith(1, { agentDir: "/state/a", cwd: "/state/a/project", projectId: "p-1", projectPath: "/state/a/project", projectTrusted: true });
    expect(serviceForContext).toHaveBeenNthCalledWith(2, { agentDir: "/state/a", cwd: process.cwd(), projectTrusted: false });
  });

  it("answers a project id the machine does not know with the resolver's own status", async () => {
    const getActiveAgentProfile = vi.fn<ActiveAgentProfileProvider["getActiveAgentProfile"]>().mockResolvedValue(availableProfile("/state/a"));
    const serviceForContext = vi.fn<(context: { agentDir: string; cwd: string; projectTrusted: boolean }) => PiPackageService>();
    const service = new ActiveProfilePiPackageService({ getActiveAgentProfile }, serviceForContext, () => resolverFor({}, true));

    await expect(service.list({ projectId: "nope" })).rejects.toBeInstanceOf(SettingsProjectError);
    expect(serviceForContext).not.toHaveBeenCalled();
  });

  it.each(["unavailable", "invalid"] as const)("fails closed without constructing a package manager when the profile is %s", async (status) => {
    const activeAgentProfile: ActiveAgentProfileProvider = {
      getActiveAgentProfile: () => Promise.resolve({ status, error: `${status} profile` }),
    };
    const serviceForContext = vi.fn<(context: { agentDir: string; cwd: string; projectTrusted: boolean }) => PiPackageService>();
    const service = new ActiveProfilePiPackageService(activeAgentProfile, serviceForContext, () => resolverFor({}, true));

    await expect(service.list({})).rejects.toMatchObject({
      profileStatus: status,
      message: `Active agent profile is ${status}: ${status} profile`,
    });
    await expect(service.install({ source: "npm:@acme/tools" })).rejects.toMatchObject({
      profileStatus: status,
      message: `Active agent profile is ${status}: ${status} profile`,
    });
    expect(serviceForContext).not.toHaveBeenCalled();
  });
});

describe("DefaultPiPackageService list", () => {
  it("lists configured Pi packages with source, scope, filtered status, and installed path", async () => {
    const fake = fakeManager([
      { source: "npm:@acme/user-tools", scope: "user", filtered: false, installedPath: "/home/test/.pi/packages/user-tools" },
      { source: "../project-tools", scope: "project", filtered: true },
    ]);
    const service = new DefaultPiPackageService(fake.manager, trustedProject);

    await expect(service.list({})).resolves.toEqual({
      packages: [
        enabledInfo({ source: "npm:@acme/user-tools", scope: "user", filtered: false, installedPath: "/home/test/.pi/packages/user-tools" }),
        enabledInfo({ source: "../project-tools", scope: "project", filtered: true }),
      ],
      globalConfigPath: "/agent/settings.json",
      projectId: "p-1",
      projectPath: "/project",
      projectConfigPath: "/project/.pi/settings.json",
      projectTrusted: true,
      projectScopeRead: true,
    });
  });

  /**
   * The project scope of a machine-wide read is the folder the web process started in, not a project
   * the reader selected, so its rows are not reported at all. Saying "no project packages" from that
   * read would describe somebody else's file as the page's own.
   */
  it("reports no project rows, and says the project scope was not read, for a machine-wide read", async () => {
    const fake = fakeManager([
      { source: "npm:@acme/user-tools", scope: "user", filtered: false },
      { source: "../server-cwd-tools", scope: "project", filtered: false },
    ]);
    const service = new DefaultPiPackageService(fake.manager, machineScope);

    await expect(service.list({})).resolves.toEqual({
      packages: [enabledInfo({ source: "npm:@acme/user-tools", scope: "user", filtered: false })],
      globalConfigPath: "/agent/settings.json",
      projectTrusted: false,
      projectScopeRead: false,
    });
  });

  it("reads the global scope only, and names the trust gate, for a project pi does not trust", async () => {
    const fake = fakeManager([
      { source: "npm:@acme/user-tools", scope: "user", filtered: false },
      { source: "../project-tools", scope: "project", filtered: false },
    ]);
    const service = new DefaultPiPackageService(fake.manager, untrustedProject);

    await expect(service.list({})).resolves.toEqual({
      packages: [enabledInfo({ source: "npm:@acme/user-tools", scope: "user", filtered: false })],
      globalConfigPath: "/agent/settings.json",
      projectId: "p-1",
      projectPath: "/project",
      projectConfigPath: "/project/.pi/settings.json",
      projectTrusted: false,
      projectScopeRead: false,
    });
  });

  it("reports a package whose filter loads none of its resources as disabled and not enabled", async () => {
    const fake = fakeManager(
      [{ source: "npm:@acme/tools", scope: "user", filtered: true }, { source: "npm:@acme/other", scope: "user", filtered: true }],
      {
        user: [
          { source: "npm:@acme/tools", autoload: false, extensions: [], skills: [], prompts: [], themes: [] },
          { source: "npm:@acme/other", autoload: false, extensions: ["only.js"] },
        ],
      },
    );
    const service = new DefaultPiPackageService(fake.manager, machineScope);

    await expect(service.list({})).resolves.toEqual({
      packages: [
        { source: "npm:@acme/tools", scope: "user", filtered: true, disabled: true, enabled: false },
        enabledInfo({ source: "npm:@acme/other", scope: "user", filtered: true }),
      ],
      globalConfigPath: "/agent/settings.json",
      projectTrusted: false,
      projectScopeRead: false,
    });
  });
});

describe("DefaultPiPackageService mutations", () => {
  it("installs globally through pi's default location, with no local option", async () => {
    const fake = fakeManager([{ source: "npm:@acme/tools", scope: "user", filtered: false }]);
    const service = new DefaultPiPackageService(fake.manager, machineScope);

    const response = await service.install({ source: "npm:@acme/tools" });

    expect(fake.installAndPersist).toHaveBeenCalledWith("npm:@acme/tools", undefined);
    expect(response).toMatchObject({ action: "install", source: "npm:@acme/tools", scope: "user", requiresReload: true });
  });

  /**
   * The project install is pi's own local install: `installAndPersist(source, { local: true })` writes
   * the project's `.pi/settings.json`, and this service is bound to that project's directory. Nothing
   * in a global file is touched, so the same source in both scopes stays two independent entries.
   */
  it("installs into a trusted project with pi's native local install", async () => {
    const fake = fakeManager([{ source: "../project-tools", scope: "project", filtered: false }]);
    const service = new DefaultPiPackageService(fake.manager, trustedProject);

    const response = await service.install({ source: "../project-tools", scope: "project" });

    expect(fake.installAndPersist).toHaveBeenCalledWith("../project-tools", { local: true });
    expect(response).toMatchObject({
      action: "install",
      source: "../project-tools",
      scope: "project",
      projectId: "p-1",
      projectPath: "/project",
      projectScopeRead: true,
      requiresReload: true,
    });
  });

  it("refuses a project install for an untrusted project before pi is asked", async () => {
    const fake = fakeManager();
    const service = new DefaultPiPackageService(fake.manager, untrustedProject);

    await expect(service.install({ source: "../project-tools", scope: "project" })).rejects.toBeInstanceOf(PiPackageScopeError);
    expect(fake.installAndPersist).not.toHaveBeenCalled();
  });

  it("refuses a project write when the request resolved no project, so the server's own folder is never written", async () => {
    const fake = fakeManager();
    const service = new DefaultPiPackageService(fake.manager, machineScope);

    await expect(service.remove({ source: "../tools", scope: "project" })).rejects.toBeInstanceOf(PiPackageScopeError);
    expect(fake.removeAndPersist).not.toHaveBeenCalled();
  });

  it("removes from the scope the request names: the user file by default, the project file with local", async () => {
    const fake = fakeManager();
    const service = new DefaultPiPackageService(fake.manager, trustedProject);

    await service.remove({ source: "npm:@acme/user-tools" });
    await service.remove({ source: "../project-tools", scope: "project" });

    expect(fake.removeAndPersist).toHaveBeenNthCalledWith(1, "npm:@acme/user-tools");
    expect(fake.removeAndPersist).toHaveBeenNthCalledWith(2, "../project-tools", { local: true });
  });

  it("updates the whole machine, or one source in the scope the row was read for", async () => {
    const fake = fakeManager();
    const service = new DefaultPiPackageService(fake.manager, trustedProject);

    await service.update({});
    await service.update({ source: "npm:@acme/tools", scope: "project" });

    expect(fake.update).toHaveBeenNthCalledWith(1);
    expect(fake.update).toHaveBeenNthCalledWith(2, "npm:@acme/tools");
  });
});

describe("DefaultPiPackageService removal pi's manager declines", () => {
  // pi's manager removes the source it recognises. A path package is recorded in the shape the machine
  // wrote, and the browser pass found a removal pi answered "nothing to remove" while the settings file
  // still named that package - so a reader's Install then Remove left the package installed. The service
  // asks the manager first and, when it declines, drops the entry that records that source.
  it("drops the entry pi's manager would not remove", async () => {
    const { manager, removeAndPersist, writePackageEntries } = fakeManager([], { user: ["../pkg/pi-demo-extension"] });
    removeAndPersist.mockResolvedValueOnce(false);
    const service = new DefaultPiPackageService(manager, machineScope);

    await expect(service.remove({ source: "../pkg/pi-demo-extension" })).resolves.toMatchObject({
      action: "remove",
      source: "../pkg/pi-demo-extension",
      scope: "user",
      removed: true,
    });
    expect(writePackageEntries).toHaveBeenCalledWith("user", []);
  });

  it("reports nothing removed when the settings file never named the package", async () => {
    const { manager, removeAndPersist, writePackageEntries } = fakeManager([], { user: ["npm:@acme/other"] });
    removeAndPersist.mockResolvedValueOnce(false);
    const service = new DefaultPiPackageService(manager, machineScope);

    await expect(service.remove({ source: "../pkg/pi-demo-extension" })).resolves.toMatchObject({ removed: false });
    expect(writePackageEntries).not.toHaveBeenCalled();
  });

  it("writes nothing when the manager removed the package itself", async () => {
    const { manager, writePackageEntries } = fakeManager([], { user: ["../pkg/pi-demo-extension"] });
    const service = new DefaultPiPackageService(manager, machineScope);

    await expect(service.remove({ source: "../pkg/pi-demo-extension" })).resolves.toMatchObject({ removed: true });
    expect(writePackageEntries).not.toHaveBeenCalled();
  });

  it("drops the entry recorded as an object", async () => {
    const { manager, removeAndPersist, writePackageEntries } = fakeManager([], { user: [{ source: "../pkg/pi-demo-extension", autoload: false }] });
    removeAndPersist.mockResolvedValueOnce(false);
    const service = new DefaultPiPackageService(manager, machineScope);

    await expect(service.remove({ source: "../pkg/pi-demo-extension" })).resolves.toMatchObject({ removed: true });
    expect(writePackageEntries).toHaveBeenCalledWith("user", []);
  });

  it("drops a project entry from the project file alone", async () => {
    const { manager, removeAndPersist, writePackageEntries } = fakeManager([], { project: ["../project-tools"], user: ["npm:@acme/global-tools"] });
    removeAndPersist.mockResolvedValueOnce(false);
    const service = new DefaultPiPackageService(manager, trustedProject);

    await expect(service.remove({ source: "../project-tools", scope: "project" })).resolves.toMatchObject({ removed: true, scope: "project" });
    expect(writePackageEntries.mock.calls.map(([scope]) => scope)).toEqual(["project"]);
  });
});

describe("DefaultPiPackageService setEnabled", () => {
  it("writes pi's own disable filter, in the scope the request names, and reports a reload", async () => {
    const fake = fakeManager([{ source: "npm:@acme/tools", scope: "user", filtered: false }], { user: ["npm:@acme/tools"] });
    const service = new DefaultPiPackageService(fake.manager, machineScope);

    const response = await service.setEnabled({ source: "npm:@acme/tools", scope: "user", enabled: false });

    expect(fake.writePackageEntries).toHaveBeenCalledWith("user", [{ source: "npm:@acme/tools", autoload: false, extensions: [], skills: [], prompts: [], themes: [] }]);
    expect(response).toMatchObject({ action: "set-enabled", source: "npm:@acme/tools", scope: "user", enabled: false, requiresReload: true });
  });

  it("restores pi's plain entry when a package is enabled again", async () => {
    const fake = fakeManager([], { user: [{ source: "npm:@acme/tools", autoload: false, extensions: [], skills: [], prompts: [], themes: [] }] });
    const service = new DefaultPiPackageService(fake.manager, machineScope);

    await service.setEnabled({ source: "npm:@acme/tools", scope: "user", enabled: true });

    expect(fake.writePackageEntries).toHaveBeenCalledWith("user", ["npm:@acme/tools"]);
  });

  it("writes a project package to the project scope alone, so the global list is never touched", async () => {
    const fake = fakeManager([], { project: ["../project-tools"], user: ["npm:@acme/global-tools"] });
    const service = new DefaultPiPackageService(fake.manager, trustedProject);

    await service.setEnabled({ source: "../project-tools", scope: "project", enabled: false });

    expect(fake.writePackageEntries).toHaveBeenCalledWith("project", [{ source: "../project-tools", autoload: false, extensions: [], skills: [], prompts: [], themes: [] }]);
    expect(fake.writePackageEntries.mock.calls.map(([scope]) => scope)).toEqual(["project"]);
    expect(fake.readPackageEntries.mock.calls.filter(([scope]) => scope === "user").length).toBeGreaterThan(0);
  });

  it("keeps the other configured entries of the scope it writes", async () => {
    const fake = fakeManager([], { user: ["npm:@acme/keep", "npm:@acme/tools", { source: "npm:@acme/filtered", extensions: ["one.js"] }] });
    const service = new DefaultPiPackageService(fake.manager, machineScope);

    await service.setEnabled({ source: "npm:@acme/tools", scope: "user", enabled: false });

    expect(fake.writePackageEntries.mock.calls[0]?.[1]).toEqual([
      "npm:@acme/keep",
      { source: "npm:@acme/tools", autoload: false, extensions: [], skills: [], prompts: [], themes: [] },
      { source: "npm:@acme/filtered", extensions: ["one.js"] },
    ]);
  });

  it("refuses to disable a package the named scope does not configure", async () => {
    const fake = fakeManager([], { user: ["npm:@acme/tools"], project: [] });
    const service = new DefaultPiPackageService(fake.manager, trustedProject);

    await expect(service.setEnabled({ source: "npm:@acme/tools", scope: "project", enabled: false })).rejects.toBeInstanceOf(PiPackageNotFoundError);
    expect(fake.writePackageEntries).not.toHaveBeenCalled();
  });

  it("refuses an empty source instead of writing an entry nobody named", async () => {
    const fake = fakeManager();
    const service = new DefaultPiPackageService(fake.manager, machineScope);

    await expect(service.setEnabled({ source: "   ", scope: "user", enabled: false })).rejects.toThrow("non-empty string");
    expect(fake.writePackageEntries).not.toHaveBeenCalled();
  });

  it("serializes package mutations in call order and lists after each mutation before starting the next", async () => {
    const firstMutation = deferred();
    const events: string[] = [];
    let packages: ConfiguredPackageRow[] = [{ source: "npm:@acme/old-tools", scope: "user", filtered: false }];
    const listConfiguredPackages = vi.fn<PiPackageManagerPort["listConfiguredPackages"]>(() => {
      events.push(`list:${packages.map((configuredPackage) => configuredPackage.source).join(",")}`);
      return packages;
    });
    const installAndPersist = vi.fn<PiPackageManagerPort["installAndPersist"]>(async (source) => {
      events.push(`install:start:${source}`);
      await firstMutation.promise;
      packages = [{ source, scope: "user", filtered: false }];
      events.push(`install:finish:${source}`);
    });
    const removeAndPersist = vi.fn<PiPackageManagerPort["removeAndPersist"]>((source) => {
      events.push(`remove:start:${source}`);
      packages = [];
      events.push(`remove:finish:${source}`);
      return Promise.resolve(true);
    });
    const update = vi.fn<PiPackageManagerPort["update"]>(() => Promise.resolve());
    const flush = vi.fn<NonNullable<PiPackageManagerPort["flush"]>>(() => {
      events.push("flush");
      return Promise.resolve();
    });
    const manager: PiPackageManagerPort = {
      listConfiguredPackages,
      readPackageEntries: () => [],
      writePackageEntries: () => Promise.resolve(),
      installAndPersist,
      removeAndPersist,
      update,
      flush,
      settingsPaths: () => ({ global: "/agent/settings.json", project: "/project/.pi/settings.json" }),
    };
    const service = new DefaultPiPackageService(manager, machineScope);

    const installPromise = service.install({ source: "npm:@acme/new-tools" });
    const removePromise = service.remove({ source: "npm:@acme/new-tools" });

    await Promise.resolve();
    expect(installAndPersist).toHaveBeenCalledOnce();
    expect(removeAndPersist).not.toHaveBeenCalled();
    expect(events).toEqual(["install:start:npm:@acme/new-tools"]);

    firstMutation.resolve();
    const [installed, removed] = await Promise.all([installPromise, removePromise]);
    expect(installed).toMatchObject({ action: "install", source: "npm:@acme/new-tools", requiresReload: true, packages: [enabledInfo({ source: "npm:@acme/new-tools", scope: "user", filtered: false })] });
    expect(removed).toMatchObject({ action: "remove", source: "npm:@acme/new-tools", scope: "user", removed: true, requiresReload: true, packages: [] });
    expect(events).toEqual([
      "install:start:npm:@acme/new-tools",
      "install:finish:npm:@acme/new-tools",
      "flush",
      "list:npm:@acme/new-tools",
      "remove:start:npm:@acme/new-tools",
      "remove:finish:npm:@acme/new-tools",
      "flush",
      "list:",
    ]);
  });

  it("does not queue list requests behind an in-flight mutation", async () => {
    const mutation = deferred();
    const events: string[] = [];
    let packages: ConfiguredPackageRow[] = [{ source: "npm:@acme/old-tools", scope: "user", filtered: false }];
    const listConfiguredPackages = vi.fn<PiPackageManagerPort["listConfiguredPackages"]>(() => {
      events.push("list");
      return packages;
    });
    const installAndPersist = vi.fn<PiPackageManagerPort["installAndPersist"]>(async (source) => {
      events.push(`install:start:${source}`);
      await mutation.promise;
      packages = [{ source, scope: "user", filtered: false }];
      events.push(`install:finish:${source}`);
    });
    const removeAndPersist = vi.fn<PiPackageManagerPort["removeAndPersist"]>(() => Promise.resolve(true));
    const update = vi.fn<PiPackageManagerPort["update"]>(() => Promise.resolve());
    const manager: PiPackageManagerPort = {
      listConfiguredPackages,
      readPackageEntries: () => [],
      writePackageEntries: () => Promise.resolve(),
      installAndPersist,
      removeAndPersist,
      update,
      settingsPaths: () => ({ global: "/agent/settings.json", project: "/project/.pi/settings.json" }),
    };
    const service = new DefaultPiPackageService(manager, machineScope);

    const installPromise = service.install({ source: "npm:@acme/new-tools" });
    await Promise.resolve();

    await expect(service.list({})).resolves.toEqual({
      packages: [enabledInfo({ source: "npm:@acme/old-tools", scope: "user", filtered: false })],
      globalConfigPath: "/agent/settings.json",
      projectTrusted: false,
      projectScopeRead: false,
    });
    expect(events).toEqual(["install:start:npm:@acme/new-tools", "list"]);

    mutation.resolve();
    await expect(installPromise).resolves.toMatchObject({
      action: "install",
      source: "npm:@acme/new-tools",
      requiresReload: true,
      packages: [enabledInfo({ source: "npm:@acme/new-tools", scope: "user", filtered: false })],
    });
  });

  it("releases the mutation queue after a mutation fails", async () => {
    const failingMutation = deferred();
    const events: string[] = [];
    const packages: ConfiguredPackageRow[] = [{ source: "npm:@acme/tools", scope: "user", filtered: false }];
    const listConfiguredPackages = vi.fn<PiPackageManagerPort["listConfiguredPackages"]>(() => {
      events.push("list");
      return packages;
    });
    const installAndPersist = vi.fn<PiPackageManagerPort["installAndPersist"]>(async (source) => {
      events.push(`install:start:${source}`);
      await failingMutation.promise;
    });
    const removeAndPersist = vi.fn<PiPackageManagerPort["removeAndPersist"]>(() => Promise.resolve(true));
    const update = vi.fn<PiPackageManagerPort["update"]>((source) => {
      events.push(`update:start:${source ?? "all"}`);
      return Promise.resolve();
    });
    const flush = vi.fn<NonNullable<PiPackageManagerPort["flush"]>>(() => {
      events.push("flush");
      return Promise.resolve();
    });
    const manager: PiPackageManagerPort = {
      listConfiguredPackages,
      readPackageEntries: () => [],
      writePackageEntries: () => Promise.resolve(),
      installAndPersist,
      removeAndPersist,
      update,
      flush,
      settingsPaths: () => ({ global: "/agent/settings.json", project: "/project/.pi/settings.json" }),
    };
    const service = new DefaultPiPackageService(manager, machineScope);

    const installPromise = service.install({ source: "npm:@acme/fails" });
    const updatePromise = service.update({ source: "npm:@acme/tools" });

    await Promise.resolve();
    expect(update).not.toHaveBeenCalled();
    expect(events).toEqual(["install:start:npm:@acme/fails"]);

    failingMutation.reject(new Error("install failed"));
    await expect(installPromise).rejects.toThrow("install failed");
    await expect(updatePromise).resolves.toMatchObject({
      action: "update",
      source: "npm:@acme/tools",
      requiresReload: true,
      packages: [enabledInfo({ source: "npm:@acme/tools", scope: "user", filtered: false })],
    });
    expect(events).toEqual([
      "install:start:npm:@acme/fails",
      "update:start:npm:@acme/tools",
      "flush",
      "list",
    ]);
  });
});

function availableProfile(dir: string) {
  return {
    status: "available" as const,
    profile: {
      schemaVersion: 2 as const,
      dir,
    },
  };
}

function fakePiPackageService(source: string) {
  const packages = [enabledInfo({ source, scope: "user" as const, filtered: false })];
  return {
    list: vi.fn(() => Promise.resolve({ packages })),
    install: vi.fn((request: { source?: string }) => Promise.resolve({ action: "install" as const, ...(request.source === undefined ? {} : { source: request.source }), requiresReload: true, packages })),
    remove: vi.fn((request: { source?: string; scope?: PiPackageScope }) => Promise.resolve({ action: "remove" as const, ...(request.source === undefined ? {} : { source: request.source }), scope: request.scope ?? "user", removed: true, requiresReload: true, packages })),
    update: vi.fn((request: { source?: string }) => Promise.resolve({ action: "update" as const, ...(request.source === undefined ? {} : { source: request.source }), requiresReload: true, packages })),
    setEnabled: vi.fn((request: { source: string; scope: PiPackageScope; enabled: boolean }) => Promise.resolve({ action: "set-enabled" as const, source: request.source, scope: request.scope, enabled: request.enabled, requiresReload: true, packages })),
  } satisfies PiPackageService;
}
