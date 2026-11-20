import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { DefaultPackageManager, SettingsManager, VERSION as PI_CODING_AGENT_VERSION } from "@earendil-works/pi-coding-agent";
import type { ActiveAgentProfileDescriptor, PiWebCapability, PiWebComponentStatus, PiWebDeprecatedAgentInput, PiWebInstallationInfo, PiWebRuntimeComponent, PiWebRuntimeResponse, PiWebServiceComponent, PiWebOwnService, PiWebServiceRestartState, PiWebStatusMessage, PiWebStatusResponse, PiWebVersionResponse } from "../../shared/apiTypes.js";
import { effectivePiWebCapabilities, PI_WEB_CAPABILITIES, WEB_RUNTIME_CAPABILITIES } from "../../shared/capabilities.js";
import { piWebDockerCommand } from "../../docker/piWebDockerCommandPlan.js";
import { parsePiWebRuntimeComponent } from "../../shared/piWebStatusParsing.js";
import { SessionDaemonClient, type SessionDaemonRequestOptions } from "./sessiondClient/sessionDaemonClient.js";
import { REQUEST_TIMEOUT_MS } from "../../shared/requestTiming.js";
import { loadPiWebConfig, type LoadedPiWebConfig } from "../../config.js";
import { isRecord } from "../../shared/unknownValues.js";
import { nativeServiceBackendKind } from "../../nativeServices/serviceBackendKind.js";
import type { NativeServiceBackendKind } from "../../nativeServices/servicePlan.js";
import { termuxRunScriptPath, termuxServiceActionArgs, termuxServiceDirectory } from "../../nativeServices/termuxServices.js";
import { PI_WEB_PACKAGE_NAME } from "./npmAllowScripts.js";
import { ownService } from "./ownService.js";
import { serviceRestartState } from "./serviceRestartState.js";
import { installationRestartRefusal, installationRestartState, serviceRestartOffered, type InstallationRestartState } from "../../shared/serviceRestart.js";

const DEFAULT_VERSION = "0.0.0-dev";

type ServiceId = "sessiond" | "web" | "uiDev";
interface NativeServiceRef {
  id: ServiceId;
  systemdName: string;
  launchdLabel: string;
  launchdPlistName: string;
  termuxServiceName: string;
}

interface NativeServiceCommands {
  restart?: string;
  restartWeb?: string;
  restartSessiond?: string;
  status?: string;
}

const execFileAsync = promisify(execFile);

const serviceRefs: Record<ServiceId, NativeServiceRef> = {
  sessiond: {
    id: "sessiond",
    systemdName: "pi-web-sessiond.service",
    launchdLabel: "com.pi-web.sessiond",
    launchdPlistName: "com.pi-web.sessiond.plist",
    termuxServiceName: "pi-web-sessiond",
  },
  web: {
    id: "web",
    systemdName: "pi-web.service",
    launchdLabel: "com.pi-web.web",
    launchdPlistName: "com.pi-web.web.plist",
    termuxServiceName: "pi-web",
  },
  uiDev: {
    id: "uiDev",
    systemdName: "pi-web-ui-dev.service",
    launchdLabel: "com.pi-web.ui-dev",
    launchdPlistName: "com.pi-web.ui-dev.plist",
    termuxServiceName: "pi-web-ui-dev",
  },
};

const startServiceOrder: ServiceId[] = ["sessiond", "web", "uiDev"];
// Restart web/UI before sessiond: when the restart command runs in a pi-web
// terminal (owned by sessiond), restarting sessiond kills the command, so any
// services listed after it would never be restarted.
const restartServiceOrder: ServiceId[] = ["web", "uiDev", "sessiond"];

interface PackageInfo {
  name: string;
  version: string;
  path: string;
}

interface PiWebStatusDaemon {
  request(method: string, path: string, body?: unknown, options?: SessionDaemonRequestOptions): Promise<{ statusCode: number; headers: Record<string, string>; body: string }>;
}

export interface PiWebStatusOptions {
  activeAgentProfile?: ActiveAgentProfileDescriptor;
  /** The service this web/API process runs as; the session daemon reports its own. */
  webOwnService?: () => Promise<PiWebOwnService>;
}

const runtimePackageInfo = readPackageInfoSync();

export function getPiWebRuntimeComponent(component: PiWebServiceComponent, capabilities: readonly PiWebCapability[] = [], deprecatedAgentInputs: readonly PiWebDeprecatedAgentInput[] = []): PiWebRuntimeComponent {
  return {
    component,
    label: component === "web" ? "Web/UI" : "Session daemon",
    runtimeVersion: runtimePackageInfo?.version ?? DEFAULT_VERSION,
    piVersion: PI_CODING_AGENT_VERSION,
    available: true,
    capabilities: [...capabilities],
    ...(deprecatedAgentInputs.length === 0 ? {} : { deprecatedAgentInputs }),
  };
}

export interface PiWebRuntimeOptions {
  /**
   * Config loader behind the web component's deprecated-input detection. The
   * loader reads this process's environment and the config file, so a config
   * edit clears the web-reported warning on the next runtime check.
   */
  loadConfig?: () => LoadedPiWebConfig;
  /** The web/API's access gate is on; the web component then advertises `access-token`. */
  accessGate?: boolean;
}

/**
 * The web component's runtime report with deprecated-input detection contained
 * at the component boundary: a malformed config file must not blank the whole
 * runtime report (the endpoint has no error handler, and federation peers
 * would mark the machine failed). Version and capabilities stay intact and
 * only the undetectable web-sourced deprecated inputs are omitted; the failure
 * travels through the component error channel, the same channel
 * `unavailableSessiondRuntime` uses for the daemon.
 */
function webRuntimeComponent(loadConfig: () => LoadedPiWebConfig, accessGate: boolean): PiWebRuntimeComponent {
  const capabilities = accessGate ? [...WEB_RUNTIME_CAPABILITIES, PI_WEB_CAPABILITIES.accessToken] : WEB_RUNTIME_CAPABILITIES;
  try {
    return getPiWebRuntimeComponent("web", capabilities, loadConfig().deprecatedAgentInputs);
  } catch (error) {
    return {
      ...getPiWebRuntimeComponent("web", capabilities),
      error: `Could not check for deprecated agent configuration inputs: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function getPiWebRuntime(daemon: PiWebStatusDaemon = new SessionDaemonClient(), options: PiWebRuntimeOptions = {}): Promise<PiWebRuntimeResponse> {
  const web = webRuntimeComponent(options.loadConfig ?? loadPiWebConfig, options.accessGate ?? false);
  const sessiond = await getSessiondRuntimeComponent(daemon);
  return {
    packageName: PI_WEB_PACKAGE_NAME,
    generatedAt: new Date().toISOString(),
    components: { web, sessiond },
    capabilities: effectivePiWebCapabilities({ web, sessiond }),
  };
}

export async function getPiWebComponentStatus(component: PiWebServiceComponent, options: PiWebStatusOptions = {}): Promise<PiWebComponentStatus> {
  const [installed, installation] = await Promise.all([
    readInstalledPackageInfo(),
    detectPiWebInstallation(options.activeAgentProfile?.dir),
  ]);
  const runtimeVersion = runtimePackageInfo?.version ?? DEFAULT_VERSION;
  const installedVersion = installed?.version;
  return {
    component,
    label: component === "web" ? "Web/UI" : "Session daemon",
    runtimeVersion,
    ...(installedVersion === undefined ? {} : { installedVersion }),
    piVersion: PI_CODING_AGENT_VERSION,
    stale: isInstalledVersionNewer(installedVersion, runtimeVersion),
    available: true,
    installation,
  };
}

export async function getPiWebVersionStatus(daemon: PiWebStatusDaemon = new SessionDaemonClient(), options: PiWebStatusOptions = {}): Promise<PiWebVersionResponse> {
  return (await readPiWebVersionStatus(daemon, options)).version;
}

async function readPiWebVersionStatus(daemon: PiWebStatusDaemon, options: PiWebStatusOptions): Promise<{ version: PiWebVersionResponse; sessiondOwnService: PiWebOwnService | undefined }> {
  const [web, sessiond] = await Promise.all([
    getPiWebComponentStatus("web", options),
    getSessiondComponentStatus(daemon, options),
  ]);
  return {
    version: {
      packageName: PI_WEB_PACKAGE_NAME,
      generatedAt: new Date().toISOString(),
      components: { web, sessiond: sessiond.status },
    },
    sessiondOwnService: sessiond.ownService,
  };
}

export async function getPiWebStatus(daemon: PiWebStatusDaemon = new SessionDaemonClient(), options: PiWebStatusOptions = {}): Promise<PiWebStatusResponse> {
  const { version: versionStatus, sessiondOwnService } = await readPiWebVersionStatus(daemon, options);
  const { web, sessiond } = versionStatus.components;
  const ownServices = { web: await (options.webOwnService ?? ownService)(), sessiond: sessiondOwnService };
  const { commands, restartStates } = await commandsFor({ web, sessiond }, ownServices);
  const components = restartStates === undefined ? { web, sessiond } : {
    web: { ...web, serviceRestart: restartStates.web },
    sessiond: { ...sessiond, serviceRestart: restartStates.sessiond },
  };
  const messages = buildMessages(components, commands);
  return {
    ...versionStatus,
    components,
    commands,
    messages,
  };
}

export function comparePackageVersions(leftVersion: string, rightVersion: string): number | undefined {
  const left = parsePackageVersion(leftVersion);
  const right = parsePackageVersion(rightVersion);
  if (left === undefined || right === undefined) return undefined;
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  if (left.patch !== right.patch) return left.patch - right.patch;
  if (left.prerelease === right.prerelease) return 0;
  if (left.prerelease === undefined) return 1;
  if (right.prerelease === undefined) return -1;
  return left.prerelease.localeCompare(right.prerelease);
}

function readPackageInfoSync(): PackageInfo | undefined {
  const path = packageJsonPath();
  try {
    return parsePackageInfo(JSON.parse(readFileSync(path, "utf8")), path);
  } catch {
    return undefined;
  }
}

async function readInstalledPackageInfo(): Promise<PackageInfo | undefined> {
  const path = packageJsonPath();
  try {
    await stat(path);
    return parsePackageInfo(JSON.parse(await readFile(path, "utf8")), path);
  } catch {
    return undefined;
  }
}

function packageJsonPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "package.json");
}

function parsePackageInfo(value: unknown, path: string): PackageInfo | undefined {
  if (!isRecord(value)) return undefined;
  const name = value["name"];
  const version = value["version"];
  if (typeof name !== "string" || name === "" || typeof version !== "string" || version === "") return undefined;
  return { name, version, path };
}

async function detectPiWebInstallation(agentDir?: string): Promise<PiWebInstallationInfo> {
  const docker = detectDockerInstallation();
  if (docker !== undefined) return docker;
  const root = packageRootPath();
  const realRoot = await realPathOrSelf(root);
  if (agentDir !== undefined) {
    const piPackage = await detectPiPackageInstallation(realRoot, root, agentDir);
    if (piPackage !== undefined) return piPackage;
  }
  const npmGlobal = await detectNpmGlobalInstallation(realRoot, root);
  if (npmGlobal !== undefined) return npmGlobal;
  return detectNixInstallation(realRoot) ?? { kind: "local", path: root };
}

const NIX_STORE_PREFIX = "/nix/store/";

/**
 * A package under the nix store was placed there by a nix configuration
 * (a flake input, home-manager, nix-darwin, NixOS), and only that
 * configuration can replace it: PI WEB has no update of its own to offer, so
 * the kind stays "unknown" and the manager is named. Reporting it as a local
 * checkout of a store path, as it was, offered a git update for a directory
 * that is read-only and has no .git.
 */
function detectNixInstallation(realRoot: string): PiWebInstallationInfo | undefined {
  return realRoot.startsWith(NIX_STORE_PREFIX) ? { kind: "unknown", manager: "nix", path: realRoot } : undefined;
}

function detectDockerInstallation(): PiWebInstallationInfo | undefined {
  if (!isTruthyEnv("PI_WEB_DOCKER_RUNTIME")) return undefined;
  const dockerMode = dockerModeFromEnv(process.env["PI_WEB_DOCKER_MODE"]) ?? inferredDockerModeFromRoots();
  const path = dockerRootPathFromEnv(dockerMode);
  return {
    kind: "docker",
    ...(path === undefined ? {} : { path }),
    ...(dockerMode === undefined ? {} : { dockerMode }),
  };
}

function dockerModeFromEnv(value: string | undefined): PiWebInstallationInfo["dockerMode"] | undefined {
  return value === "runtime" || value === "dev" ? value : undefined;
}

function inferredDockerModeFromRoots(): PiWebInstallationInfo["dockerMode"] | undefined {
  if (firstNonEmptyEnv("PI_WEB_DOCKER_DEV_REPO_ROOT") !== undefined) return "dev";
  if (firstNonEmptyEnv("PI_WEB_DOCKER_INSTALL_DIR") !== undefined) return "runtime";
  return undefined;
}

function dockerRootPathFromEnv(mode: PiWebInstallationInfo["dockerMode"] | undefined): string | undefined {
  if (mode === "dev") return firstNonEmptyEnv("PI_WEB_DOCKER_DEV_REPO_ROOT", "PI_WEB_DOCKER_INSTALL_DIR");
  if (mode === "runtime") return firstNonEmptyEnv("PI_WEB_DOCKER_INSTALL_DIR", "PI_WEB_DOCKER_DEV_REPO_ROOT");
  return firstNonEmptyEnv("PI_WEB_DOCKER_INSTALL_DIR", "PI_WEB_DOCKER_DEV_REPO_ROOT");
}

export function firstNonEmptyEnv(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key];
    if (value !== undefined && value !== "") return value;
  }
  return undefined;
}

export function isTruthyEnv(key: string): boolean {
  const value = process.env[key];
  return value !== undefined && value !== "" && value !== "0" && value.toLowerCase() !== "false";
}

async function detectPiPackageInstallation(realRoot: string, displayPath: string, agentDir: string): Promise<PiWebInstallationInfo | undefined> {
  try {
    const packageManager = new DefaultPackageManager({
      cwd: process.cwd(),
      agentDir,
      settingsManager: SettingsManager.create(process.cwd(), agentDir),
    });
    for (const configuredPackage of packageManager.listConfiguredPackages()) {
      const installedPath = configuredPackage.installedPath ?? packageManager.getInstalledPath(configuredPackage.source, configuredPackage.scope);
      if (installedPath === undefined) continue;
      const realInstalledPath = await realPathOrSelf(installedPath);
      if (isSameOrWithin(realInstalledPath, realRoot) || isSameOrWithin(realRoot, realInstalledPath)) {
        return { kind: "pi-package", path: displayPath, source: configuredPackage.source, scope: configuredPackage.scope };
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

async function detectNpmGlobalInstallation(realRoot: string, displayPath: string): Promise<PiWebInstallationInfo | undefined> {
  const npmRoot = await npmGlobalRoot();
  if (npmRoot === undefined) return undefined;
  const realNpmRoot = await realPathOrSelf(npmRoot);
  if (!isSameOrWithin(realNpmRoot, realRoot)) return undefined;
  return { kind: "npm-global", path: displayPath, npmRoot };
}

/** npm is a `.cmd` script on Windows, which only a shell can start. */
async function npmGlobalRoot(): Promise<string | undefined> {
  const [command, args] = process.platform === "win32" ? ["cmd.exe", ["/d", "/s", "/c", "npm root -g"]] : ["npm", ["root", "-g"]];
  try {
    const { stdout } = await execFileAsync(command, args, { encoding: "utf8" });
    const root = stdout.trim();
    return root === "" ? undefined : root;
  } catch {
    return undefined;
  }
}

function packageRootPath(): string {
  return dirname(packageJsonPath());
}

async function realPathOrSelf(path: string): Promise<string> {
  return realpath(path).catch(() => resolve(path));
}

function isSameOrWithin(parent: string, candidate: string): boolean {
  const rel = relative(parent, candidate);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep));
}

/** The daemon's own runtime report, or why it could not be read. */
type SessiondRuntimeRead = { kind: "read"; runtime: PiWebRuntimeComponent } | { kind: "failed"; error: string };

async function readSessiondRuntime(daemon: PiWebStatusDaemon): Promise<SessiondRuntimeRead> {
  try {
    const upstream = await daemon.request("GET", "/runtime", undefined, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (upstream.statusCode < 200 || upstream.statusCode >= 300) return { kind: "failed", error: `runtime check returned HTTP ${String(upstream.statusCode)}` };
    const parsed: unknown = upstream.body === "" ? undefined : JSON.parse(upstream.body);
    const runtime = parsePiWebRuntimeComponent(parsed);
    return runtime === undefined ? { kind: "failed", error: "runtime response did not include valid runtime information" } : { kind: "read", runtime };
  } catch (error) {
    return { kind: "failed", error: error instanceof Error ? error.message : String(error) };
  }
}

async function getSessiondRuntimeComponent(daemon: PiWebStatusDaemon): Promise<PiWebRuntimeComponent> {
  const read = await readSessiondRuntime(daemon);
  return read.kind === "read" ? read.runtime : unavailableSessiondRuntime(read.error);
}

/** The daemon's status, and the service it reported for its own process, absent from a daemon that predates the report. */
async function getSessiondComponentStatus(daemon: PiWebStatusDaemon, options: PiWebStatusOptions = {}): Promise<{ status: PiWebComponentStatus; ownService?: PiWebOwnService }> {
  const read = await readSessiondRuntime(daemon);
  if (read.kind === "failed") return { status: unavailableSessiond(read.error) };
  const runtime = read.runtime;
  if (!runtime.available) return { status: unavailableSessiond(runtime.error ?? "runtime response did not include valid runtime information") };
  const status = await getPiWebComponentStatus("sessiond", options);
  const runtimeVersion = runtime.runtimeVersion ?? status.runtimeVersion;
  return { status: {
    ...status,
    ...(runtimeVersion === undefined ? {} : { runtimeVersion }),
    // The daemon reports the Pi version it has loaded in its own process;
    // the spread of `status` already carries this process's Pi version as
    // the fallback for daemons that predate Pi version reporting, mirroring
    // the runtimeVersion fallback.
    ...(runtime.piVersion === undefined ? {} : { piVersion: runtime.piVersion }),
    stale: isInstalledVersionNewer(status.installedVersion, runtimeVersion),
    available: true,
  }, ...(runtime.ownService === undefined ? {} : { ownService: runtime.ownService }) };
}

function unavailableSessiondRuntime(error: string): PiWebRuntimeComponent {
  return {
    component: "sessiond",
    label: "Session daemon",
    available: false,
    capabilities: [],
    error,
  };
}

function unavailableSessiond(error: string): PiWebComponentStatus {
  return {
    component: "sessiond",
    label: "Session daemon",
    stale: false,
    available: false,
    error,
  };
}

/** Restart commands are offered only when the installed service belongs to this PI WEB instance. */
async function commandsFor(components: PiWebStatusResponse["components"], ownServices: OwnServices): Promise<{ commands: PiWebStatusResponse["commands"]; restartStates?: ServiceRestartStates }> {
  const installation = preferredInstallation(components);
  if (installation?.kind === "docker") return { commands: dockerCommands(installation) };

  const scope = serviceRestartScope(ownServices);
  const [serviceCommands, cliCommands] = await Promise.all([
    nativeServiceCommands(scope),
    piWebCliCommands(installation, scope),
  ]);
  const restart = restartCommandFor(installation, serviceCommands, cliCommands);
  const restartWeb = serviceCommands.restartWeb;
  const restartSessiond = serviceCommands.restartSessiond ?? cliCommands.restart;
  const status = serviceCommands.status ?? cliCommands.status;
  return {
    commands: {
      ...(restart === undefined ? {} : { restart }),
      ...(restartWeb === undefined ? {} : { restartWeb }),
      ...(restartSessiond === undefined ? {} : { restartSessiond }),
      ...(status === undefined ? {} : { status }),
    },
    ...(scope === undefined ? {} : { restartStates: scope.states }),
  };
}

type OwnServices = Readonly<Record<PiWebServiceComponent, PiWebOwnService | undefined>>;
type ServiceRestartStates = Readonly<Record<PiWebServiceComponent, PiWebServiceRestartState>>;

interface ServiceRestartScope {
  backend: ManagerCommandBackendKind;
  installed: ReadonlySet<ServiceId>;
  states: ServiceRestartStates;
  /** The installed services of the components whose own process runs under them. */
  restartable: ReadonlySet<ServiceId>;
  /** Every installed service is restartable, so restarting them all restarts this PI WEB and nothing else. */
  whole: boolean;
}

const serviceComponents: Readonly<Record<ServiceId, PiWebServiceComponent>> = { sessiond: "sessiond", web: "web", uiDev: "web" };

/**
 * Which installed services this PI WEB may restart. The services are found by their files,
 * which a second PI WEB on the same account finds too; the service each component's own process
 * runs as decides. No scope where the Updates page drives no service manager, and on Windows,
 * whose `pi-web restart` stays offered as before (owner, 2026-10-21): a task's process cannot
 * confirm it from inside.
 */
function serviceRestartScope(ownServices: OwnServices): ServiceRestartScope | undefined {
  const backend = managerCommandBackend();
  if (backend === undefined) return undefined;
  const installed = installedServiceIds(backend);
  const web = serviceRestartState(installedServiceNames(backend, installed, "web"), ownServices.web, false);
  const states: ServiceRestartStates = {
    web,
    sessiond: serviceRestartState(installedServiceNames(backend, installed, "sessiond"), ownServices.sessiond, web === "runs-under-service"),
  };
  const restartable = new Set([...installed].filter((id) => serviceRestartOffered[states[serviceComponents[id]]]));
  return { backend, installed, states, restartable, whole: installed.size > 0 && restartable.size === installed.size };
}

function installationRestartStateOf(scope: ServiceRestartScope | undefined): InstallationRestartState {
  return installationRestartState(scope === undefined ? undefined : [scope.states.web, scope.states.sessiond]);
}

/**
 * Whether this PI WEB may restart every installed service, or update with a command from its
 * environment, decided as the Updates page decides its buttons: from the web/API process's own
 * service and the session daemon's report. `refusal` is the sentence a refused caller shows.
 */
export async function installationRestartCheck(
  daemon: PiWebStatusDaemon = new SessionDaemonClient(),
  webOwnService: () => Promise<PiWebOwnService> = ownService,
): Promise<{ state: InstallationRestartState; refusal: string | undefined }> {
  const [web, sessiond] = await Promise.all([webOwnService(), readSessiondOwnService(daemon)]);
  const state = installationRestartStateOf(serviceRestartScope({ web, sessiond }));
  return { state, refusal: installationRestartRefusal[state] };
}

/** The service the daemon reports for its own process; undefined when it does not answer or predates the report. */
async function readSessiondOwnService(daemon: PiWebStatusDaemon): Promise<PiWebOwnService | undefined> {
  const read = await readSessiondRuntime(daemon);
  return read.kind === "read" ? read.runtime.ownService : undefined;
}

const managerServiceNames: Readonly<Record<ManagerCommandBackendKind, (ref: NativeServiceRef) => string>> = {
  systemd: (ref) => ref.systemdName,
  launchd: (ref) => ref.launchdLabel,
  termux: (ref) => ref.termuxServiceName,
};

function installedServiceNames(backend: ManagerCommandBackendKind, installed: ReadonlySet<ServiceId>, component: PiWebServiceComponent): Set<string> {
  return new Set([...installed].filter((id) => serviceComponents[id] === component).map((id) => managerServiceNames[backend](serviceRefs[id])));
}

function preferredInstallation(components: PiWebStatusResponse["components"]): PiWebInstallationInfo | undefined {
  const web = components.web.installation;
  const sessiond = components.sessiond.installation;
  if (web?.kind === "docker" || sessiond?.kind === "docker") return web?.kind === "docker" ? web : sessiond;
  if (web?.kind === "local" || sessiond?.kind === "local") return web?.kind === "local" ? web : sessiond;
  return web ?? sessiond;
}

function dockerCommands(installation: PiWebInstallationInfo): PiWebStatusResponse["commands"] {
  return {
    restart: piWebDockerCommand(installation.dockerMode, "restart"),
    restartWeb: piWebDockerCommand(installation.dockerMode, "restart-web"),
    restartSessiond: piWebDockerCommand(installation.dockerMode, "restart-sessiond"),
    status: piWebDockerCommand(installation.dockerMode, "status"),
  };
}

/**
 * `pi-web restart` and `pi-web status` drive a service manager, so a host without one gets neither.
 * `pi-web restart` restarts every installed service, so it needs all of them to run this PI WEB.
 */
async function piWebCliCommands(installation: PiWebInstallationInfo | undefined, scope: ServiceRestartScope | undefined): Promise<NativeServiceCommands> {
  if (nativeServiceBackendKind(process.platform, process.env) === undefined) return {};
  if (installation?.kind !== "npm-global" || !(await hasCommand("pi-web"))) return {};
  return scope === undefined || scope.whole ? { restart: "pi-web restart", status: "pi-web status" } : { status: "pi-web status" };
}

function restartCommandFor(installation: PiWebInstallationInfo | undefined, serviceCommands: NativeServiceCommands, cliCommands: NativeServiceCommands): string | undefined {
  if (installation?.kind === "local" || installation?.kind === "pi-package") return serviceCommands.restart ?? cliCommands.restart;
  return cliCommands.restart ?? serviceCommands.restart;
}

async function nativeServiceCommands(scope: ServiceRestartScope | undefined): Promise<NativeServiceCommands> {
  if (scope === undefined || scope.installed.size === 0 || !(await hasCommand(nativeServiceManagerCommands[scope.backend]))) return {};
  const { backend, installed } = scope;
  const web = installedServiceRefs(scope.restartable, ["web", "uiDev"]);
  const sessiond = installedServiceRefs(scope.restartable, ["sessiond"]);
  const restartable = web.length === 0 || !scope.whole ? [] : installedServiceRefs(installed, restartServiceOrder, restartServiceOrder);
  const status = installedServiceRefs(installed);
  return {
    ...(restartable.length === 0 ? {} : { restart: restartNativeServicesCommand(backend, restartable, "pi-web-restart") }),
    ...(web.length === 0 ? {} : { restartWeb: restartNativeServicesCommand(backend, web, "pi-web-restart-web") }),
    ...(sessiond.length === 0 ? {} : { restartSessiond: restartNativeServicesCommand(backend, sessiond, "pi-web-restart-sessiond") }),
    ...(status.length === 0 ? {} : { status: statusNativeServicesCommand(backend, status) }),
  };
}

/**
 * Backends whose service manager the Updates page commands drive directly. Windows has none: its
 * terminals are Windows PowerShell, and `pi-web restart` (offered for npm installs) hands the restart
 * off to a scheduled task.
 */
type ManagerCommandBackendKind = Exclude<NativeServiceBackendKind, "windows">;

const nativeServiceManagerCommands: Readonly<Record<ManagerCommandBackendKind, string>> = {
  systemd: "systemctl",
  launchd: "launchctl",
  termux: "sv",
};

/** The backend the Updates page's commands drive: none on Windows, whose `pi-web restart` stays as before, or on a host without a service manager. */
function managerCommandBackend(): ManagerCommandBackendKind | undefined {
  const backend = nativeServiceBackendKind(process.platform, process.env);
  return backend === undefined || backend === "windows" ? undefined : backend;
}

function installedServiceIds(backend: ManagerCommandBackendKind): Set<ServiceId> {
  return new Set(startServiceOrder.filter((id) => existsSync(serviceFilePath(backend, serviceRefs[id]))));
}

function installedServiceRefs(installed: ReadonlySet<ServiceId>, candidates: ServiceId[] = startServiceOrder, order: ServiceId[] = startServiceOrder): NativeServiceRef[] {
  return order.filter((id) => candidates.includes(id) && installed.has(id)).map((id) => serviceRefs[id]);
}

const serviceFilePaths: Readonly<Record<ManagerCommandBackendKind, (ref: NativeServiceRef) => string>> = {
  systemd: (ref) => join(systemdServiceDir(), ref.systemdName),
  launchd: (ref) => join(launchdServiceDir(), ref.launchdPlistName),
  termux: termuxRunScriptPath,
};

function serviceFilePath(backend: ManagerCommandBackendKind, ref: NativeServiceRef): string {
  return serviceFilePaths[backend](ref);
}

function systemdServiceDir(): string {
  return join(homedir(), ".config", "systemd", "user");
}

function launchdServiceDir(): string {
  return join(homedir(), "Library", "LaunchAgents");
}

function restartNativeServicesCommand(backend: ManagerCommandBackendKind, refs: NativeServiceRef[], systemdUnit: string): string {
  // On systemd, run the restart inside a transient, detached `.service` unit
  // (the default `systemd-run` mode, not `--scope`). A scope would stay a child
  // of the calling shell and die with the terminal; a transient service is
  // reparented to the user service manager, so the restart finishes even when
  // restarting the session daemon kills the pi-web terminal that launched it.
  // `--collect` cleans the unit up afterwards, and the fixed `--unit` name makes
  // logs easy to find with `journalctl --user -u <unit>`.
  if (backend === "systemd") {
    const names = refs.map((ref) => ref.systemdName).join(" ");
    return `systemd-run --user --collect --unit=${systemdUnit} -- systemctl --user restart ${names}`;
  }
  if (backend === "termux") return `sv ${termuxServiceActionArgs("restart", refs.map(termuxServiceDirectory)).join(" ")}`;
  return refs.map((ref) => `launchctl kickstart -k gui/$(id -u)/${ref.launchdLabel}`).join(" && ");
}

function statusNativeServicesCommand(backend: ManagerCommandBackendKind, refs: NativeServiceRef[]): string {
  if (backend === "systemd") return `systemctl --user status ${refs.map((ref) => ref.systemdName).join(" ")}`;
  if (backend === "termux") return `sv status ${refs.map(termuxServiceDirectory).join(" ")}`;
  return refs.map((ref) => `launchctl print gui/$(id -u)/${ref.launchdLabel}`).join(" && ");
}

function hasCommand(command: string): Promise<boolean> {
  if (process.platform === "win32") return commandSucceeds("where.exe", ["/q", command]);
  return commandSucceeds("/usr/bin/env", ["sh", "-c", `command -v ${shellQuote(command)}`]);
}

async function commandSucceeds(command: string, args: string[]): Promise<boolean> {
  try {
    await execFileAsync(command, args, { encoding: "utf8" });
    return true;
  } catch {
    return false;
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function optionalMessageCommand(command: string | undefined): Pick<PiWebStatusMessage, "command"> | object {
  return command === undefined ? {} : { command };
}

function buildMessages(components: PiWebStatusResponse["components"], commands: PiWebStatusResponse["commands"]): PiWebStatusMessage[] {
  const messages: PiWebStatusMessage[] = [];

  if (components.web.stale) {
    const command = commands.restartWeb;
    messages.push({
      id: "web-stale",
      severity: "warning",
      title: "Web/UI service restart needed",
      body: command === undefined
        ? `The Web/UI service is running ${formatVersion(components.web.runtimeVersion)}, but ${formatVersion(components.web.installedVersion)} is installed. Restart the Web/UI service or process to use the installed version.`
        : `The Web/UI service is running ${formatVersion(components.web.runtimeVersion)}, but ${formatVersion(components.web.installedVersion)} is installed. Restart the service to use the installed version.`,
      ...optionalMessageCommand(command),
    });
  }

  if (!components.sessiond.available) {
    messages.push({
      id: "sessiond-unavailable",
      severity: "warning",
      title: "Session daemon version unavailable",
      body: commands.status === undefined
        ? `PI WEB could not check the session daemon version${components.sessiond.error === undefined ? "." : `: ${components.sessiond.error}`}. Check the session daemon service or process that runs this installation.`
        : `PI WEB could not check the session daemon version${components.sessiond.error === undefined ? "." : `: ${components.sessiond.error}`}`,
      ...optionalMessageCommand(commands.status),
    });
  } else if (components.sessiond.stale) {
    const command = commands.restartSessiond ?? commands.restart;
    messages.push({
      id: "sessiond-stale",
      severity: "warning",
      title: "Session daemon restart needed",
      body: command === undefined
        ? `The session daemon is running ${formatVersion(components.sessiond.runtimeVersion)}, but ${formatVersion(components.sessiond.installedVersion)} is installed. Restart the session daemon service or process to use the installed version.`
        : `The session daemon is running ${formatVersion(components.sessiond.runtimeVersion)}, but ${formatVersion(components.sessiond.installedVersion)} is installed. Restart the daemon to use the installed version.`,
      ...optionalMessageCommand(command),
    });
  }

  return messages;
}

function isInstalledVersionNewer(installedVersion: string | undefined, runtimeVersion: string | undefined): boolean {
  if (installedVersion === undefined || runtimeVersion === undefined) return false;
  return isNewerPackageVersion(installedVersion, runtimeVersion);
}

export function isNewerPackageVersion(candidateVersion: string, currentVersion: string): boolean {
  const comparison = comparePackageVersions(candidateVersion, currentVersion);
  if (comparison !== undefined) return comparison > 0;
  return candidateVersion.trim() !== currentVersion.trim();
}

function parsePackageVersion(version: string): { major: number; minor: number; patch: number; prerelease?: string } | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/u.exec(version.trim());
  if (match === null) return undefined;
  const [, major, minor, patch, prerelease] = match;
  if (major === undefined || minor === undefined || patch === undefined) return undefined;
  return {
    major: Number.parseInt(major, 10),
    minor: Number.parseInt(minor, 10),
    patch: Number.parseInt(patch, 10),
    ...(prerelease === undefined ? {} : { prerelease }),
  };
}

function formatVersion(version: string | undefined): string {
  return version ?? "unknown";
}
