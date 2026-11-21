import type {
  PiMcpConfiguredState,
  PiMcpListResponse,
  PiMcpMutationResponse,
  PiMcpProbe,
  PiMcpSaveRequest,
  PiMcpScope,
  PiMcpServerDraft,
  PiMcpServerInfo,
  PiMcpSetEnabledRequest,
  PiMcpRemoveRequest,
  PiMcpTestRequest,
  PiMcpTransport,
  PiMcpWriteKind,
  PiMcpWriteTarget,
} from "../../shared/apiTypes.js";
import {
  addMcpServerConfig,
  globalMcpConfigPath,
  redactMcpUrl,
  loadMcpConfig,
  projectMcpConfigPath,
  removeMcpServerConfig,
  updateMcpServerConfig,
  validateMcpServerConfig,
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
  /** Writes one whole entry; true when the file already defined that name. */
  add(configPath: string, name: string, config: McpServerConfig): Promise<boolean>;
}

export interface McpProbePort {
  probe: (name: string, config: McpServerConfig, cwd: string, timeoutSeconds: number | undefined) => Promise<PiMcpProbe>;
}

/** The project a request is answering for, and whether its own config may be touched at all. */
export interface McpScopeContext {
  projectPath: string | undefined;
  projectTrusted: boolean;
}

export interface PiMcpService {
  list(request: { projectId?: string }): Promise<PiMcpListResponse>;
  setEnabled(request: PiMcpSetEnabledRequest): Promise<PiMcpMutationResponse>;
  remove(request: PiMcpRemoveRequest): Promise<PiMcpMutationResponse>;
  test(request: PiMcpTestRequest): Promise<PiMcpMutationResponse>;
  save(request: PiMcpSaveRequest): Promise<PiMcpMutationResponse>;
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
    const kind = requireWriteKind(request.target, request.scope);
    const scopeContext = await this.scope(request.projectId);
    requireTrustedProject(scopeContext);
    return await this.enqueueMutation(async () => {
      const read = await this.config.read(scopeContext.projectPath, scopeContext.projectTrusted);
      const entry = requireEntry(read, name);
      const target = writeTarget(read, entry, kind, scopeContext);
      requireLegacyScope(request.scope, target.scope);
      await this.config.patch(target.path, name, { enabled: request.enabled }, { override: kind === "override" });
      return { ...this.describe(await this.config.read(scopeContext.projectPath, scopeContext.projectTrusted), scopeContext), action: "set-enabled", name, enabled: request.enabled, requiresReload: true };
    });
  }

  async remove(request: PiMcpRemoveRequest): Promise<PiMcpMutationResponse> {
    const name = requireName(request.name);
    const kind = requireWriteKind(request.target, request.scope);
    const scopeContext = await this.scope(request.projectId);
    requireTrustedProject(scopeContext);
    return await this.enqueueMutation(async () => {
      const read = await this.config.read(scopeContext.projectPath, scopeContext.projectTrusted);
      const entry = requireEntry(read, name);
      const target = writeTarget(read, entry, kind, scopeContext);
      requireLegacyScope(request.scope, target.scope);
      const removed = await this.config.remove(target.path, name);
      return { ...this.describe(await this.config.read(scopeContext.projectPath, scopeContext.projectTrusted), scopeContext), action: "remove", name, removed, requiresReload: true };
    });
  }

  /**
   * Writes one server's config, creating it or replacing what the scope already had.
   *
   * A draft is merged over the entry that exists, and the merge is validated as one config before the
   * file opens. That is what lets the panel edit a server whose secrets it cannot read: the keys the
   * draft leaves out keep the values the file already had, so a hidden header value survives an edit
   * without ever reaching the browser.
   */
  async save(request: PiMcpSaveRequest): Promise<PiMcpMutationResponse> {
    const name = requireName(request.name);
    const kind = requireWriteKind(request.target, request.scope);
    const scopeContext = await this.scope(request.projectId);
    requireTrustedProject(scopeContext);
    return await this.enqueueMutation(async () => {
      const read = await this.config.read(scopeContext.projectPath, scopeContext.projectTrusted);
      const entry = findEntry(read, name);
      const target = saveTarget(read, entry, kind, scopeContext);
      requireLegacyScope(request.scope, target.scope);
      const validated = validateMcpServerConfig(name, mergeMcpDraft(request.config, entry?.config));
      if (typeof validated === "string") throw new PiMcpRequestError(validated);
      const added = await this.writeDraft(kind, target.path, name, validated, entry);
      return { ...this.describe(await this.config.read(scopeContext.projectPath, scopeContext.projectTrusted), scopeContext), action: "save", name, added, requiresReload: true };
    });
  }

  /**
   * Writes one draft to one file, and says whether the file gained an entry.
   *
   * A definition write replaces the entry, which is why a draft that leaves a secret out keeps the
   * stored one: the merged config the validator checked is what lands. An override write is pi's own
   * patch, not a config: only the override keys go into the project's file, and the transport the
   * server runs on stays in the file that defines it.
   */
  private async writeDraft(kind: PiMcpWriteKind, configPath: string, name: string, config: McpServerConfig, entry: McpServerEntry | undefined): Promise<boolean> {
    if (kind === "override") {
      await this.config.patch(configPath, name, mcpOverrideDraft(config), { override: true });
      return entry?.override === undefined;
    }
    return !(await this.config.add(configPath, name, config));
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
  private describe(read: McpConfigRead, scopeContext: McpScopeContext): PiMcpListResponse {
    return {
      servers: read.servers.map((entry) => describeMcpServer(entry, scopeContext)),
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

/**
 * The file a write is aimed at, and the reason a project's press can never open the global file.
 *
 * Two rules do the protecting. An override write resolves through the project the request named - the
 * entry's own override when one exists, that project's `mcp.json` when the press is creating one - and
 * a path that would land on the global file is refused rather than taken. A definition write resolves
 * through the entry, and a project-defined entry is only writable for the project that is answering, so
 * a request naming one project cannot edit a server that lives in another project's file.
 */
function writeTarget(read: McpConfigRead, entry: McpServerEntry, kind: PiMcpWriteKind, scopeContext: McpScopeContext): { path: string; scope: PiMcpScope } {
  if (kind === "override") {
    if (scopeContext.projectPath === undefined) throw new PiMcpRequestError("Writing a project's override of an MCP server needs a project");
    if (entry.scope === "project") {
      throw new PiMcpRequestError(`MCP server "${entry.name}" is defined by this project, so there is no override to write: change the definition`);
    }
    const path = entry.override ?? projectMcpConfigPath(scopeContext.projectPath);
    if (path === read.globalConfigPath) {
      throw new PiMcpRequestError(`A project's override cannot be written to ${path}, which is the global config`);
    }
    return { path, scope: "project" };
  }
  if (entry.scope === "global") return { path: read.globalConfigPath, scope: "global" };
  const projectFile = scopeContext.projectPath === undefined ? undefined : projectMcpConfigPath(scopeContext.projectPath);
  if (projectFile === undefined || entry.source !== projectFile) {
    throw new PiMcpRequestError(`MCP server "${entry.name}" is defined in ${entry.source}, which this request's project does not own`);
  }
  return { path: entry.source, scope: "project" };
}

/**
 * The scope a PI WEB old enough to send only `scope` asked for, checked against the entry the write
 * resolved to. A request that says "global" is not allowed to land in a project's file, and one that
 * says "project" is not allowed to land in the global one - which is the promise `target` makes
 * explicit and this check keeps.
 */
function requireLegacyScope(requested: PiMcpScope | undefined, resolved: PiMcpScope): void {
  if (requested === undefined || requested === resolved) return;
  throw new PiMcpRequestError(`The entry this write resolved to is a ${resolved} one, not the ${requested} scope the request named`);
}

/**
 * The file a save is aimed at.
 *
 * An existing entry resolves exactly as an enable or a remove does, so a press in a project cannot
 * write the global file and another project's server cannot be edited here. A name the scope does not
 * have yet has no entry to resolve, so its target decides: a definition goes to the file that owns the
 * scope the request named, and an override refuses, because pi's override is an override *of* a global
 * server, and there is nothing to override before one exists.
 */
function saveTarget(read: McpConfigRead, entry: McpServerEntry | undefined, kind: PiMcpWriteKind, scopeContext: McpScopeContext): { path: string; scope: PiMcpScope } {
  if (entry !== undefined) return writeTarget(read, entry, kind, scopeContext);
  if (kind === "override") throw new PiMcpRequestError("A project's override needs a global MCP server of that name to override, so write its definition first");
  if (scopeContext.projectPath === undefined) return { path: read.globalConfigPath, scope: "global" };
  return { path: projectMcpConfigPath(scopeContext.projectPath), scope: "project" };
}

/**
 * The config a save writes: the draft over the entry that exists.
 *
 * Keys the draft does not speak for keep what the file had. `env` and `headers` follow that rule too,
 * which is what makes it useful: a form that shows an environment variable's name but never its value
 * sends no `env` at all when the person editing did not touch them, and the values survive. Sent whole
 * (pi reads a plain object), they replace the set.
 *
 * A transport switch is not a merge. A draft that names a command speaks for a stdio server, so the URL
 * and header keys the previous HTTP entry had are dropped - pi reads `url` ahead of `command`, and a
 * saved form that switched transport must not leave a stale URL that pi would connect to.
 */
const STDIO_CONFIG_KEYS = ["command", "args", "cwd", "env"];
const HTTP_CONFIG_KEYS = ["url", "headers", "oauth", "auth"];

function mergeMcpDraft(draft: PiMcpServerDraft, existing: McpServerConfig | undefined): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...(existing ?? {}) };
  for (const [key, value] of Object.entries(draft)) {
    if (value !== undefined) merged[key] = value;
  }
  if (Object.hasOwn(draft, "command")) return withoutKeys(merged, HTTP_CONFIG_KEYS);
  if (Object.hasOwn(draft, "url")) return withoutKeys(merged, STDIO_CONFIG_KEYS);
  return merged;
}

/** A transport switch drops the other transport's fields; pi reads `url` ahead of `command`, and a leftover URL would be connected to. */
function withoutKeys(config: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(config).filter(([key]) => !keys.includes(key)));
}

/**
 * What a project's override of a global server is allowed to say, and nothing else.
 *
 * pi reads `enabled`, `exposure` and `toolExposure` from a project's `mcp.json` entry and refuses the
 * entry when it names anything more (its loader reports "an override can only set ..."). Merging the
 * whole definition over the global entry - which is what makes editing a server whose secrets the panel
 * cannot read work - would therefore write a file pi rejects, and leak the definition's command, URL and
 * secret keys into a project file that gets committed. The merge is validated whole (it is the config pi
 * will effectively run, global definition plus this override) and narrowed to these keys for the write.
 */
/**
 * What a project may say about a server it does not define: pi's own patch, whose keys are exactly
 * the ones an override entry is allowed to carry. The transport fields are not copied - a project
 * that could change the command of a global server would run any program on this machine.
 */
function mcpOverrideDraft(config: McpServerConfig): McpServerConfigPatch {
  const patch: McpServerConfigPatch = {};
  if (typeof config.enabled === "boolean") patch.enabled = config.enabled;
  const exposure = config.exposure;
  if (exposure === "codemode" || exposure === "deferred" || exposure === "direct" || exposure === "hidden") patch.exposure = exposure;
  return patch;
}

function requireEntry(read: McpConfigRead, name: string): McpServerEntry {
  const entry = findEntry(read, name);
  if (entry === undefined) throw new PiMcpServerErrorNotFound(`No MCP server named "${name}" is configured`);
  return entry;
}

/**
 * The entry a write is aimed at.
 *
 * `target` is the request's own word for it. A PI WEB old enough to send only `scope` is read through
 * the same rule - a project-scope write has always meant the project's file - so both senders land on
 * one meaning and neither can pick the global file by accident.
 */
function requireWriteKind(target: PiMcpWriteKind | undefined, scope: PiMcpScope | undefined): PiMcpWriteKind {
  if (target === "definition" || target === "override") return target;
  if (scope === "project") return "override";
  if (scope === "global") return "definition";
  throw new PiMcpRequestError('An MCP write must name its target: "definition" or "override"');
}

function findEntry(read: McpConfigRead, name: string): McpServerEntry | undefined {
  return read.servers.find((entry) => entry.name === name);
}

function requireName(value: string): string {
  const name = value.trim();
  if (name === "") throw new PiMcpRequestError("An MCP server name must be a non-empty string");
  return name;
}

/**
 * The entries a row can be written to, for the project the answer is about.
 *
 * A row is not one thing to write: a global server that a project overrides has a definition file and
 * an override file, and the two answers mean different things. The row carries both targets, each
 * naming its file, so the panel can show the difference and a press can be honest about what it opens.
 * Nothing reads an extension's registrations as file entries, so every entry here is a file's own.
 */
export function mcpWriteTargets(entry: McpServerEntry, scopeContext: McpScopeContext): PiMcpWriteTarget[] {
  if (entry.scope === "project") return [{ kind: "definition", scope: "project", configPath: entry.source }];
  const targets: PiMcpWriteTarget[] = [{ kind: "definition", scope: "global", configPath: entry.source }];
  if (scopeContext.projectPath !== undefined && scopeContext.projectTrusted) {
    targets.push({ kind: "override", scope: "project", configPath: entry.override ?? projectMcpConfigPath(scopeContext.projectPath) });
  }
  return targets;
}

/**
 * One server as the panel shows it.
 *
 * The summary carries names, not values: a header's name, an environment variable's name, a URL
 * without a credential in it. pi's own config is not copied out of the machine.
 */
export function describeMcpServer(entry: McpServerEntry, scopeContext: McpScopeContext): PiMcpServerInfo {
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
    targets: mcpWriteTargets(entry, scopeContext),
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
    add: (configPath, name, config) => Promise.resolve(addMcpServerConfig(configPath, name, config)),
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

  async save(request: PiMcpSaveRequest): Promise<PiMcpMutationResponse> {
    return await (await this.service()).save(request);
  }

  private async service(): Promise<PiMcpService> {
    const profile = await requireActiveAgentProfile(this.activeAgentProfile);
    return this.serviceForAgentDir(profile.dir);
  }
}
