import type {
  PiMcpConfiguredState,
  PiMcpListResponse,
  PiMcpMutationResponse,
  PiMcpProbe,
  PiMcpScope,
  PiMcpServerInfo,
  PiMcpSetEnabledRequest,
  PiMcpRemoveRequest,
  PiMcpTestRequest,
  PiMcpTransport,
} from "../../shared/apiTypes.js";
import {
  globalMcpConfigPath,
  redactMcpUrl,
  loadMcpConfig,
  projectMcpConfigPath,
  removeMcpServerConfig,
  updateMcpServerConfig,
  type McpServerConfig,
  type McpServerConfigPatch,
  type McpServerEntry,
} from "../shared/resources/mcpConfig.js";
import { DEFAULT_MCP_PROBE_TIMEOUT_MS, probeMcpServer } from "../shared/resources/mcpProbe.js";
import { requireActiveAgentProfile, type ActiveAgentProfileProvider } from "./activeAgentProfileProvider.js";
import type { SettingsProjectResolver } from "../shared/resources/settingsProjectResolver.js";

/** A request PI WEB will not answer: a 400 with the reader's own problem, not a crash. */
export class PiMcpRequestError extends Error {
  override name = "PiMcpRequestError";
}

/** A server the named scope does not define. */
export class PiMcpServerErrorNotFound extends Error {
  override name = "PiMcpServerErrorNotFound";
}

/**
 * What pi's own configuration reader answered for one machine.
 *
 * Trust is not one of its fields: the caller decides it (pi's trust store answers for a project) and
 * hands it to the read, so the reader cannot be asked to read a project's file by a caller that
 * never checked. The response's `projectTrusted` is the caller's decision, not a re-derivation.
 */
export interface McpConfigRead {
  servers: McpServerEntry[];
  errors: string[];
  globalConfigPath: string;
  projectConfigPath?: string;
}

export interface McpConfigPort {
  read(projectPath: string | undefined, projectTrusted: boolean): Promise<McpConfigRead>;
  /** `override` adds the entry as a project override of a global server, pi's own rule. */
  patch(configPath: string, name: string, patch: McpServerConfigPatch, options?: { override?: boolean }): Promise<void>;
  remove(configPath: string, name: string): Promise<boolean>;
}

export interface McpProbePort {
  probe: (name: string, config: McpServerConfig, cwd: string, timeoutSeconds: number | undefined) => Promise<PiMcpProbe>;
}

export interface PiMcpService {
  list(request: { projectId?: string }): Promise<PiMcpListResponse>;
  setEnabled(request: PiMcpSetEnabledRequest): Promise<PiMcpMutationResponse>;
  remove(request: PiMcpRemoveRequest): Promise<PiMcpMutationResponse>;
  test(request: PiMcpTestRequest): Promise<PiMcpMutationResponse>;
}

/**
 * The MCP panel's service.
 *
 * It reads and writes pi's files and speaks pi's rules, and it owns exactly two things pi does not
 * offer a second process: the redacted summary the panel shows (names, never values), and the probe
 * that answers "can this server be reached" without touching a running session.
 *
 * Configuration and connection stay two facts. A server that is enabled is not a server that is
 * connected: pi's own extension connects it when a session starts, and a change written here
 * reaches a running session after a reload, which is what `requiresReload` says.
 */
export class DefaultPiMcpService implements PiMcpService {
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly config: McpConfigPort,
    private readonly probe: McpProbePort,
    private readonly projects: SettingsProjectResolver,
  ) {}

  async list(request: { projectId?: string }): Promise<PiMcpListResponse> {
    const scopeContext = await this.scope(request.projectId);
    return this.describe(await this.config.read(scopeContext.projectPath, scopeContext.projectTrusted), scopeContext);
  }

  async setEnabled(request: PiMcpSetEnabledRequest): Promise<PiMcpMutationResponse> {
    const name = requireName(request.name);
    const scope = requireScope(request.scope);
    if (scope === "extension") throw new PiMcpRequestError("A server an extension registered is not editable from Settings; pi's /mcp manager is");
    const scopeContext = await this.scope(request.projectId);
    if (scope === "project" && scopeContext.projectPath === undefined) throw new PiMcpRequestError("A project-scope MCP change needs a project");
    requireTrustedProject(scopeContext);
    return await this.enqueueMutation(async () => {
      const read = await this.config.read(scopeContext.projectPath, scopeContext.projectTrusted);
      const entry = requireEntry(read, name, scope);
      const target = writeTarget(read, entry, scope, scopeContext.projectPath);
      await this.config.patch(target, name, { enabled: request.enabled }, { override: scope === "project" && entry.scope !== "project" });
      return { ...this.describe(await this.config.read(scopeContext.projectPath, scopeContext.projectTrusted), scopeContext), action: "set-enabled", name, enabled: request.enabled, requiresReload: true };
    });
  }

  async remove(request: PiMcpRemoveRequest): Promise<PiMcpMutationResponse> {
    const name = requireName(request.name);
    const scope = requireScope(request.scope);
    if (scope === "extension") throw new PiMcpRequestError("A server an extension registered is not removable from Settings; the extension that registers it owns it");
    const scopeContext = await this.scope(request.projectId);
    if (scope === "project" && scopeContext.projectPath === undefined) throw new PiMcpRequestError("A project-scope MCP removal needs a project");
    requireTrustedProject(scopeContext);
    return await this.enqueueMutation(async () => {
      const read = await this.config.read(scopeContext.projectPath, scopeContext.projectTrusted);
      const entry = requireEntry(read, name, scope);
      const target = writeTarget(read, entry, scope, scopeContext.projectPath);
      const removed = await this.config.remove(target, name);
      return { ...this.describe(await this.config.read(scopeContext.projectPath, scopeContext.projectTrusted), scopeContext), action: "remove", name, removed, requiresReload: true };
    });
  }

  async test(request: PiMcpTestRequest): Promise<PiMcpMutationResponse> {
    const name = requireName(request.name);
    const scopeContext = await this.scope(request.projectId);
    requireTrustedProject(scopeContext);
    const read = await this.config.read(scopeContext.projectPath, scopeContext.projectTrusted);
    const entry = findEntry(read, name);
    if (entry === undefined) throw new PiMcpServerErrorNotFound(`No MCP server named "${name}" is configured${scopeContext.projectPath === undefined ? " globally" : " for this project"}`);
    const probe = await this.probe.probe(name, entry.config, scopeContext.projectPath ?? process.cwd(), entry.config.timeout);
    const described = this.describe(read, scopeContext);
    return {
      ...described,
      servers: described.servers.map((server) => (server.name === name ? { ...server, probe } : server)),
      action: "test",
      name,
      probe,
      requiresReload: false,
    };
  }

  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const queued = this.mutationQueue.then(operation);
    this.mutationQueue = queued.then(
      () => undefined,
      () => undefined,
    );
    return queued;
  }

  private async scope(projectId: string | undefined): Promise<{ projectPath: string | undefined; projectTrusted: boolean }> {
    if (projectId === undefined) return { projectPath: undefined, projectTrusted: false };
    const projectPath = await this.projects.requireProjectPath(projectId);
    return { projectPath, projectTrusted: this.projects.isProjectTrusted(projectPath) };
  }

  /** The list the answer carries: what the files say now, plus the scope the request was about. */
  private describe(read: McpConfigRead, scopeContext: { projectPath: string | undefined; projectTrusted: boolean }): PiMcpListResponse {
    return {
      servers: read.servers.map((entry) => describeMcpServer(entry)),
      errors: read.errors,
      globalConfigPath: read.globalConfigPath,
      ...(read.projectConfigPath === undefined ? {} : { projectConfigPath: read.projectConfigPath }),
      ...(scopeContext.projectPath === undefined ? {} : { projectPath: scopeContext.projectPath }),
      projectTrusted: scopeContext.projectTrusted,
      projectScopeRead: scopeContext.projectPath !== undefined && scopeContext.projectTrusted,
    };
  }
}

/**
 * The gate a project's MCP scope needs, stated once.
 *
 * Connecting a project's server runs what the project's file names, so an untrusted project's
 * `mcp.json` is not read, not written, and above all not probed. A read that lists only the global
 * file is honest about it; a write and a probe refuse, because both act.
 */
function requireTrustedProject(scopeContext: { projectPath: string | undefined; projectTrusted: boolean }): void {
  if (scopeContext.projectPath === undefined || scopeContext.projectTrusted) return;
  throw new PiMcpRequestError("This project is not trusted, so its MCP servers are not read, changed, or connected. Trust the project in pi first.");
}

/** The file a scope's change belongs to: a project never rewrites the global file. */
function writeTarget(read: McpConfigRead, entry: McpServerEntry, scope: PiMcpScope, projectPath: string | undefined): string {
  if (scope === "project") {
    const path = projectPath === undefined ? read.projectConfigPath : projectMcpConfigPath(projectPath);
    if (path === undefined) throw new PiMcpRequestError("A project-scope MCP change needs a project");
    return path;
  }
  if (entry.scope === "global") return read.globalConfigPath;
  throw new PiMcpRequestError(`MCP server "${entry.name}" is defined by the project only; change it in the project, not globally`);
}

function requireEntry(read: McpConfigRead, name: string, scope: PiMcpScope): McpServerEntry {
  const entry = findEntry(read, name);
  if (entry === undefined) {
    throw new PiMcpServerErrorNotFound(`No MCP server named "${name}" is configured${scope === "project" ? " for this project" : " on this machine"}`);
  }
  return entry;
}

function findEntry(read: McpConfigRead, name: string): McpServerEntry | undefined {
  return read.servers.find((entry) => entry.name === name);
}

function requireName(value: string): string {
  const name = value.trim();
  if (name === "") throw new PiMcpRequestError("An MCP server name must be a non-empty string");
  return name;
}

const mcpScopes: readonly PiMcpScope[] = ["global", "project", "extension"];

function requireScope(value: PiMcpScope): PiMcpScope {
  if (!mcpScopes.includes(value)) throw new PiMcpRequestError("MCP scope must be \"global\", \"project\", or \"extension\"");
  return value;
}

/**
 * One server as the panel shows it.
 *
 * The summary carries names, not values: a header's name, an environment variable's name, a URL
 * without a credential in it. pi's own config is not copied out of the machine.
 */
export function describeMcpServer(entry: McpServerEntry): PiMcpServerInfo {
  const config = entry.config;
  const stdio = "command" in config ? config : undefined;
  const http = "url" in config ? config : undefined;
  const transport: PiMcpTransport = http !== undefined ? "http" : "stdio";
  const enabled = config.enabled !== false;
  const configured: PiMcpConfiguredState = enabled ? "enabled" : "disabled";
  const scope: PiMcpScope = entry.scope;
  const secretNames = secretBearingKeys(config);
  const overrideOnly = entry.override !== undefined;
  return {
    name: entry.name,
    scope,
    transport,
    configured,
    configPath: entry.source,
    ...(entry.override === undefined ? {} : { overridePath: entry.override }),
    ...(overrideOnly ? { overrideOnly: true } : {}),
    enabled,
    ...(config.exposure === undefined ? {} : { exposure: config.exposure }),
    ...(typeof config.description === "string" && config.description !== "" ? { description: config.description } : {}),
    ...(typeof config.timeout === "number" ? { timeout: config.timeout } : {}),
    ...(transport === "stdio"
      ? {
          command: stdio?.command ?? "",
          ...(stdio?.cwd !== undefined && stdio.cwd !== "" ? { cwd: stdio.cwd } : {}),
          ...(stdio?.env === undefined || Object.keys(stdio.env).length === 0 ? {} : { envNames: Object.keys(stdio.env) }),
        }
      : {
          url: http === undefined ? "" : redactMcpUrl(http.url),
          ...(http?.headers === undefined || Object.keys(http.headers).length === 0 ? {} : { headerNames: Object.keys(http.headers) }),
        }),
    ...(secretNames.length === 0 ? {} : { usesSecrets: true }),
    ...("auth" in config && isRecord(config.auth) && typeof config.auth.provider === "string" ? { authProvider: config.auth.provider } : {}),
    ...("oauth" in config ? { oauthConfigured: true } : {}),
    probe: { state: "unprobed" as const },
  };
}

/** The keys whose values the panel must never see, by name. */
function secretBearingKeys(config: McpServerConfig): string[] {
  const keys: string[] = [];
  if ("headers" in config && isRecord(config.headers)) keys.push(...Object.keys(config.headers));
  if ("env" in config && isRecord(config.env)) keys.push(...Object.keys(config.env));
  if ("oauth" in config && isRecord(config.oauth) && config.oauth["clientSecret"] !== undefined) keys.push("oauth.clientSecret");
  return keys;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** pi's own file reader, on this machine, for the agent directory this process was built with. */
export function fileMcpConfigPort(agentDir: string): McpConfigPort {
  return {
    read: (projectPath, projectTrusted) => Promise.resolve(readMcpConfigFiles(agentDir, projectPath, projectTrusted)),
    patch: (configPath, name, patch, options) => {
      updateMcpServerConfig(configPath, name, patch, options);
      return Promise.resolve();
    },
    remove: (configPath, name) => Promise.resolve(removeMcpServerConfig(configPath, name)),
  };
}

function readMcpConfigFiles(agentDir: string, projectPath: string | undefined, projectTrusted: boolean): McpConfigRead {
  const loaded = loadMcpConfig({ agentDir, cwd: projectPath ?? process.cwd(), projectTrusted });
  return {
    servers: loaded.servers,
    errors: loaded.errors,
    globalConfigPath: globalMcpConfigPath(agentDir),
    ...(loaded.projectConfig === undefined ? {} : { projectConfigPath: loaded.projectConfig }),
  };
}

export function createPiMcpProbePort(): McpProbePort {
  return {
    probe: (name, config, cwd, timeoutSeconds) => probeMcpServer({
      name,
      config,
      cwd,
      timeoutMs: timeoutSeconds === undefined ? DEFAULT_MCP_PROBE_TIMEOUT_MS : Math.min(Math.max(timeoutSeconds, 1) * 1000, 30_000),
    }),
  };
}

/**
 * The MCP service of the agent profile this machine is running right now. The project resolver is
 * built per agent directory because the active profile decides which trust store answers for a
 * project, and the same profile decides which `mcp.json` is the global one.
 */
export function createActiveProfilePiMcpService(
  activeAgentProfile: ActiveAgentProfileProvider,
  projects: (agentDir: string) => SettingsProjectResolver,
): PiMcpService {
  return new ActiveProfilePiMcpService(activeAgentProfile, (agentDir) => new DefaultPiMcpService(fileMcpConfigPort(agentDir), createPiMcpProbePort(), projects(agentDir)));
}

/**
 * The active profile decides which agent directory's `mcp.json` is the global one, so the panel
 * reads the file the next session on this machine will read.
 */
export class ActiveProfilePiMcpService implements PiMcpService {
  constructor(
    private readonly activeAgentProfile: ActiveAgentProfileProvider,
    private readonly serviceForAgentDir: (agentDir: string) => PiMcpService,
  ) {}

  async list(request: { projectId?: string }): Promise<PiMcpListResponse> {
    return await (await this.service()).list(request);
  }

  async setEnabled(request: PiMcpSetEnabledRequest): Promise<PiMcpMutationResponse> {
    return await (await this.service()).setEnabled(request);
  }

  async remove(request: PiMcpRemoveRequest): Promise<PiMcpMutationResponse> {
    return await (await this.service()).remove(request);
  }

  async test(request: PiMcpTestRequest): Promise<PiMcpMutationResponse> {
    return await (await this.service()).test(request);
  }

  private async service(): Promise<PiMcpService> {
    const profile = await requireActiveAgentProfile(this.activeAgentProfile);
    return this.serviceForAgentDir(profile.dir);
  }
}
