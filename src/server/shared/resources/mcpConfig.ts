import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Pi's MCP configuration, read and written by PI WEB.
 *
 * Pi owns the format - `mcp.json` in the agent directory, and `<project>/.pi/mcp.json` for a
 * trusted project, both in the `mcpServers` shape other MCP clients share - and pi owns what the
 * configuration does: a server with `enabled: false` is loaded, reported, and never connected, so
 * turning it back on is a settings write and a reload, not a reinstall. The shape and the rules
 * here are pi's, transcribed from `extensions/mcp` and `core/mcp-servers` in the installed SDK.
 *
 * They are re-implemented, not imported, for one mechanical reason: the SDK's `exports` map publishes
 * only `.` and `./rpc-entry`, and the MCP config functions are not among the root exports, so a deep
 * import of `dist/extensions/mcp/config.js` is not a supported dependency. Everything here is
 * therefore file-shaped and validated the way pi validates it, and nothing here decides how a
 * session connects - pi's own MCP extension does that when it reads these files.
 *
 * Secrets never leave through this module. A header value, an env value, an OAuth client secret, or
 * a `!command` reference is read as an opaque string and is not part of any summary; the panel is
 * given names, and the probe reports a redacted reason.
 */

/** The keys a project entry may set when it only overrides a global server. */
export const MCP_OVERRIDE_KEYS = ["enabled", "exposure", "toolExposure"] as const;
/** pi's own exposures. `codemode` is the default and is written as the absence of the key. */
export const MCP_EXPOSURES = ["codemode", "deferred", "direct", "hidden"] as const;
/** The same names, widened for membership tests, so a config key can be looked up in them. */
const MCP_OVERRIDE_KEY_NAMES: readonly string[] = MCP_OVERRIDE_KEYS;
const MCP_EXPOSURE_NAMES: readonly string[] = MCP_EXPOSURES;

/** Older exposure names pi accepts in configs and replaces when it validates them. */
const MCP_EXPOSURE_ALIASES: Readonly<Record<string, McpExposure>> = { "codemode-deferred": "codemode" };
const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;
const GLOBAL_MCP_FILE_NAME = "mcp.json";
const PROJECT_MCP_PATH_SEGMENTS = [".pi", "mcp.json"];

export type McpExposure = (typeof MCP_EXPOSURES)[number];
export type McpConfigScope = "global" | "project";

export interface McpStdioServerConfig {
  type?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  enabled?: boolean;
  exposure?: McpExposure;
  toolExposure?: Record<string, McpExposure>;
  description?: string;
  timeout?: number;
}

export interface McpHttpServerConfig {
  type?: "http";
  url: string;
  headers?: Record<string, string>;
  oauth?: Record<string, unknown>;
  auth?: { provider: string };
  enabled?: boolean;
  exposure?: McpExposure;
  toolExposure?: Record<string, McpExposure>;
  description?: string;
  timeout?: number;
}

export type McpServerConfig = McpStdioServerConfig | McpHttpServerConfig;

export interface McpServerEntry {
  name: string;
  config: McpServerConfig;
  /** The `mcp.json` that defined the server. */
  source: string;
  scope: McpConfigScope;
  /** The project `mcp.json` that overrides this global server's enabled / exposure keys. */
  override?: string;
}

export interface LoadedMcpConfigFile {
  servers: McpServerEntry[];
  autoEnableCodemode?: boolean;
  errors: string[];
  /** The project `mcp.json`, when the project is trusted and so was read. */
  projectConfig?: string;
}

export interface McpServerConfigPatch {
  enabled?: boolean;
  exposure?: McpExposure;
}

export function globalMcpConfigPath(agentDir: string): string {
  return join(agentDir, GLOBAL_MCP_FILE_NAME);
}

export function projectMcpConfigPath(projectPath: string): string {
  return join(projectPath, ...PROJECT_MCP_PATH_SEGMENTS);
}

/** A server's tool namespace, which `-` and `_` share: two names in one namespace would collide. */
export function mcpNamespace(server: string): string {
  return `mcp__${server.replaceAll("-", "_")}`;
}

/**
 * Reads pi's MCP configuration: the global file, then a trusted project's, where a project entry
 * with no `command`, `url`, or `type` overrides only the enabled / exposure keys of the global
 * server of the same name. A server that is disabled is returned with `enabled: false`, because it
 * is configured, not absent.
 */
export function loadMcpConfig(options: { agentDir: string; cwd: string; projectTrusted: boolean }): LoadedMcpConfigFile {
  const servers = new Map<string, McpServerEntry>();
  const errors: string[] = [];
  let autoEnableCodemode: boolean | undefined;
  const read = (path: string, scope: McpConfigScope) => {
    const outcome = readMcpConfigFile(path, scope, servers);
    errors.push(...outcome.errors);
    if (outcome.autoEnableCodemode !== undefined) autoEnableCodemode = outcome.autoEnableCodemode;
  };
  read(globalMcpConfigPath(options.agentDir), "global");
  const projectConfig = options.projectTrusted ? projectMcpConfigPath(options.cwd) : undefined;
  if (projectConfig !== undefined) read(projectConfig, "project");
  return {
    servers: [...servers.values()],
    ...(autoEnableCodemode === undefined ? {} : { autoEnableCodemode }),
    errors,
    ...(projectConfig === undefined ? {} : { projectConfig }),
  };
}

interface ReadFileOutcome {
  errors: string[];
  autoEnableCodemode?: boolean;
}

function readMcpConfigFile(path: string, scope: McpConfigScope, servers: Map<string, McpServerEntry>): ReadFileOutcome {
  const errors: string[] = [];
  if (!existsSync(path)) return { errors };
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripBom(readFileSync(path, "utf8")));
  } catch (error) {
    return { errors: [`${path}: ${describeJsonParseFailure(error)}`] };
  }
  if (!isRecord(parsed) || (parsed["mcpServers"] !== undefined && !isRecord(parsed["mcpServers"]))) {
    return { errors: [`${path}: expected an object with an "mcpServers" object`] };
  }
  const autoEnableCodemode = parsed["autoEnableCodemode"];
  if (autoEnableCodemode !== undefined && typeof autoEnableCodemode !== "boolean") {
    errors.push(`${path}: autoEnableCodemode must be a boolean`);
  }
  const entries = parsed["mcpServers"];
  for (const [name, value] of Object.entries(entries ?? {})) {
    if (scope === "project" && isRecord(value) && isOverrideEntry(value)) {
      const base = servers.get(name);
      const extra = Object.keys(value).filter((key) => !MCP_OVERRIDE_KEY_NAMES.includes(key));
      if (base === undefined) {
        errors.push(`${path}: server "${name}" needs "command" or "url", or a global server to override`);
      } else if (extra.length > 0) {
        errors.push(`${path}: server "${name}": an override can only set ${MCP_OVERRIDE_KEYS.join(", ")}`);
      } else {
        const config = validateMcpServerConfig(name, { ...base.config, ...value });
        if (typeof config === "string") errors.push(`${path}: ${config}`);
        else servers.set(name, { ...base, config, override: path });
      }
      continue;
    }
    const config = validateMcpServerConfig(name, value);
    if (typeof config === "string") {
      errors.push(`${path}: ${config}`);
      continue;
    }
    const clash = [...servers.keys()].find((other) => other !== name && mcpNamespace(other) === mcpNamespace(name));
    if (clash !== undefined) {
      errors.push(`${path}: server "${name}" conflicts with "${clash}"`);
      continue;
    }
    if (scope === "project" && "url" in config && config.auth !== undefined) {
      errors.push(`${path}: server "${name}": auth is only allowed in the global mcp.json`);
      continue;
    }
    servers.set(name, { name, config, source: path, scope });
  }
  return { errors, ...(typeof autoEnableCodemode === "boolean" ? { autoEnableCodemode } : {}) };
}

/** Whether an entry overrides a server defined elsewhere instead of defining one. */
function isOverrideEntry(value: Record<string, unknown>): boolean {
  return value["command"] === undefined && value["url"] === undefined && value["type"] === undefined;
}

/**
 * Validates one `mcpServers` entry, pi's own rules, and returns the resolved copy (exposure
 * aliases resolved) or the problem as a string.
 */
export function validateMcpServerConfig(name: string, raw: unknown): McpServerConfig | string {
  if (!SERVER_NAME_PATTERN.test(name)) return `invalid server name "${name}" (use letters, digits, "_" and "-")`;
  if (!isRecord(raw)) return `server "${name}" must be an object`;
  const value = resolveExposureAliases(raw);
  const exposures = MCP_EXPOSURES.map((entry) => `"${entry}"`).join(", ");
  const { type, exposure, enabled, timeout, toolExposure, description } = value;
  if (exposure !== undefined && !isExposure(exposure)) return `server "${name}": exposure must be one of ${exposures}`;
  if (toolExposure !== undefined) {
    if (!isRecord(toolExposure)) return `server "${name}": toolExposure must map tool names to exposures`;
    for (const [tool, toolValue] of Object.entries(toolExposure)) {
      if (!isExposure(toolValue)) return `server "${name}": toolExposure "${tool}" must be one of ${exposures}`;
    }
  }
  if (enabled !== undefined && typeof enabled !== "boolean") return `server "${name}": enabled must be a boolean`;
  if (description !== undefined && typeof description !== "string") return `server "${name}": description must be a string`;
  if (timeout !== undefined && (typeof timeout !== "number" || !(timeout > 0))) return `server "${name}": timeout must be a positive number of seconds`;
  if (type === "sse") return `server "${name}": legacy SSE transport is not supported; use the streamable HTTP URL`;
  if (typeof value["url"] === "string" && (type === undefined || type === "http" || type === "streamable-http")) {
    const url = value["url"];
    if (!isHttpUrl(url)) return `server "${name}": url must be an http or https URL`;
    if (value["headers"] !== undefined && !isStringRecord(value["headers"])) return `server "${name}": headers must map names to strings`;
    const oauthError = validateOAuth(value["oauth"]);
    if (oauthError !== undefined) return `server "${name}": ${oauthError}`;
    if (value["auth"] !== undefined) {
      const auth = value["auth"];
      if (!isRecord(auth) || typeof auth["provider"] !== "string" || auth["provider"] === "") {
        return `server "${name}": auth.provider must be a provider name`;
      }
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" && !LOOPBACK_HOSTS.includes(parsed.hostname)) {
        return `server "${name}": auth requires an https URL, or http on localhost, 127.0.0.1, or [::1]`;
      }
    }
    if (!isHttpServerConfig(value)) return `server "${name}": the http configuration is not in the shape pi reads`;
    return value;
  }
  if (typeof value["command"] === "string" && (type === undefined || type === "stdio")) {
    if (value["args"] !== undefined && !(Array.isArray(value["args"]) && value["args"].every((arg) => typeof arg === "string"))) {
      return `server "${name}": args must be an array of strings`;
    }
    if (value["env"] !== undefined && !isStringRecord(value["env"])) return `server "${name}": env must map names to strings`;
    if (value["cwd"] !== undefined && typeof value["cwd"] !== "string") return `server "${name}": cwd must be a string`;
    if (!isStdioServerConfig(value)) return `server "${name}": the stdio configuration is not in the shape pi reads`;
    return value;
  }
  return `server "${name}" needs either "command" (stdio) or "url" (streamable HTTP)`;
}

function isHttpUrl(value: string): boolean {
  if (!/^https?:/i.test(value)) return false;
  try {
    return URL.canParse(value);
  } catch {
    return false;
  }
}

/**
 * narrows a validated record to the config shape pi reads.
 *
 * validateMcpServerConfig has already refused everything pi would refuse; these predicates state the
 * same shape in the type system, so a config is passed on without a cast and a shape that is not one
 * of the two pi reads is reported as a problem rather than passed through.
 */
function isHttpServerConfig(value: unknown): value is McpHttpServerConfig {
  if (!isRecord(value)) return false;
  const type = value["type"];
  const url = value["url"];
  const headers = value["headers"];
  const oauth = value["oauth"];
  const auth = value["auth"];
  return (type === undefined || type === "http" || type === "streamable-http")
    && typeof url === "string"
    && (headers === undefined || isStringRecord(headers))
    && (oauth === undefined || isRecord(oauth))
    && (auth === undefined || (isRecord(auth) && typeof auth["provider"] === "string" && auth["provider"] !== ""))
    && isCommonConfigShape(value);
}

function isStdioServerConfig(value: unknown): value is McpStdioServerConfig {
  if (!isRecord(value)) return false;
  const type = value["type"];
  const command = value["command"];
  const args = value["args"];
  const env = value["env"];
  const cwd = value["cwd"];
  return (type === undefined || type === "stdio")
    && typeof command === "string"
    && (args === undefined || (Array.isArray(args) && args.every((arg) => typeof arg === "string")))
    && (env === undefined || isStringRecord(env))
    && (cwd === undefined || typeof cwd === "string")
    && isCommonConfigShape(value);
}

/** The keys both transports carry, checked once for both shapes. */
function isCommonConfigShape(value: Record<string, unknown>): boolean {
  const enabled = value["enabled"];
  const description = value["description"];
  const timeout = value["timeout"];
  const exposure = value["exposure"];
  const toolExposure = value["toolExposure"];
  if (enabled !== undefined && typeof enabled !== "boolean") return false;
  if (description !== undefined && typeof description !== "string") return false;
  if (timeout !== undefined && (typeof timeout !== "number" || !(timeout > 0))) return false;
  if (exposure !== undefined && !isExposure(exposure)) return false;
  if (toolExposure === undefined) return true;
  return isRecord(toolExposure) && Object.values(toolExposure).every(isExposure);
}

function isExposure(value: unknown): value is McpExposure {
  return typeof value === "string" && MCP_EXPOSURE_NAMES.includes(value);
}

function resolveExposureAliases(value: Record<string, unknown>): Record<string, unknown> {
  const resolved: Record<string, unknown> = { ...value };
  const exposure = value["exposure"];
  if (typeof exposure === "string") resolved["exposure"] = MCP_EXPOSURE_ALIASES[exposure] ?? exposure;
  const toolExposure = value["toolExposure"];
  if (isRecord(toolExposure)) {
    resolved["toolExposure"] = Object.fromEntries(Object.entries(toolExposure).map(([tool, entry]) => [
      tool,
      typeof entry === "string" ? MCP_EXPOSURE_ALIASES[entry] ?? entry : entry,
    ]));
  }
  return resolved;
}

function validateOAuth(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return "oauth must be an object";
  for (const key of ["clientId", "clientSecret", "callbackUrl"] as const) {
    const entry = value[key];
    if (entry !== undefined && typeof entry !== "string") return `oauth.${key} must be a string`;
  }
  const scope = value["scope"];
  if (scope !== undefined && typeof scope !== "string") return "oauth.scope must be a string";
  const scopeFiles = value["scopeFiles"];
  if (scopeFiles !== undefined && !(Array.isArray(scopeFiles) && scopeFiles.every((entry) => typeof entry === "string"))) {
    return "oauth.scopeFiles must be an array of strings";
  }
  const redirectUri = value["redirectUri"];
  if (redirectUri !== undefined && (typeof redirectUri !== "string" || !isLoopbackRedirectUri(redirectUri))) {
    return "oauth.redirectUri must be a loopback http URI, such as http://localhost:3118/callback";
  }
  const open = value["open"];
  if (open !== undefined && typeof open !== "boolean") return "oauth.open must be a boolean";
  return undefined;
}

function isLoopbackRedirectUri(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return url.protocol === "http:" && LOOPBACK_HOSTS.includes(url.hostname);
}

/**
 * Changes one server's settings in the `mcp.json` that defines it, keeping every other key and the
 * file's own indentation.
 *
 * `enabled: true` and `exposure: "codemode"` are pi's defaults and remove the key, except in an
 * override entry, which keeps its defaults because it replaces the global server's.
 */
export function updateMcpServerConfig(path: string, name: string, patch: McpServerConfigPatch, options: { override?: boolean } = {}): void {
  editMcpServers(path, (servers, parsed) => {
    let server = servers?.[name];
    if (server === undefined && options.override === true) {
      server = {};
      parsed["mcpServers"] = { ...servers, [name]: server };
    }
    if (!isRecord(server)) throw new McpConfigWriteError(`${path} does not define MCP server "${name}"`);
    const keepDefaults = isOverrideEntry(server);
    if (patch.enabled !== undefined) {
      if (patch.enabled && !keepDefaults) delete server["enabled"];
      else server["enabled"] = patch.enabled;
    }
    if (patch.exposure !== undefined) {
      if (patch.exposure === "codemode" && !keepDefaults) delete server["exposure"];
      else server["exposure"] = patch.exposure;
    }
    return true;
  });
}

/** Removes one server from one `mcp.json`; false when that file does not define it. */
export function removeMcpServerConfig(path: string, name: string): boolean {
  if (!existsSync(path)) return false;
  let removed = false;
  editMcpServers(path, (servers) => {
    if (servers?.[name] === undefined) return false;
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- pi reads this file as a plain object, and removing an entry means removing its key.
    delete servers[name];
    removed = true;
    return true;
  });
  return removed;
}

/** Adds a server to an `mcp.json`, creating the file when missing; true when an entry was replaced. */
export function addMcpServerConfig(path: string, name: string, config: McpServerConfig): boolean {
  let replaced = false;
  editMcpServers(path, (servers, parsed) => {
    const target = servers ?? {};
    replaced = target[name] !== undefined;
    target[name] = config;
    parsed["mcpServers"] = target;
    return true;
  });
  return replaced;
}

/**
 * Reads an `mcp.json` (an empty config when missing), lets `edit` change its `mcpServers`, and
 * writes it back with its own indentation when `edit` says it changed something.
 */
function editMcpServers(path: string, edit: (servers: Record<string, unknown> | undefined, parsed: Record<string, unknown>) => boolean): void {
  const text = existsSync(path) ? stripBom(readFileSync(path, "utf8")) : undefined;
  const parsed = text === undefined ? {} : asRecord(parseMcpConfigText(path, text), path);
  const servers = isRecord(parsed["mcpServers"]) ? (parsed["mcpServers"]) : undefined;
  if (!edit(servers, parsed)) return;
  const indent = (text !== undefined ? /^([ \t]+)\S/m.exec(text)?.[1] : undefined) ?? "  ";
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(parsed, null, indent)}\n`, "utf8");
}

/**
 * Parses an `mcp.json` for a write, and says so when it is not JSON.
 *
 * A parse message quotes the source around the failure, and this file holds credentials, so the
 * engine's text is never repeated; only a digits-only position is kept. PI WEB's own config applies
 * the same rule (src/config.ts). A write that met this file refuses, which is what `McpConfigWriteError`
 * is for: the reader is told the file is broken, and nothing is written over it.
 */
function parseMcpConfigText(path: string, text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new McpConfigWriteError(`${path}: ${describeJsonParseFailure(error)}`);
  }
}

/**
 * The engine's own text is not repeated; a position is, because it is digits and it is what makes a
 * broken line findable. V8 states a character offset, a line and column, or neither.
 */
function describeJsonParseFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  const offset = /at position (\d+)/.exec(message)?.[1];
  if (offset !== undefined) return `the file is not valid JSON (character ${offset})`;
  const line = /line (\d+) column (\d+)/.exec(message);
  if (line?.[1] !== undefined && line[2] !== undefined) return `the file is not valid JSON (line ${line[1]}, column ${line[2]})`;
  return "the file is not valid JSON";
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value) || (value["mcpServers"] !== undefined && !isRecord(value["mcpServers"]))) {
    throw new McpConfigWriteError(`${path}: expected an object with an "mcpServers" object`);
  }
  return value;
}

/** A file PI WEB will not write, because what it holds is not the shape it must keep. */
export class McpConfigWriteError extends Error {
  override name = "McpConfigWriteError";
}

/**
 * A one-line reason that cannot carry a secret.
 *
 * A server's own message can quote a header, an env value, or a `!command` it was told to run, so
 * every value the configuration names is cut out of the text before it reaches an answer, a log,
 * or the panel.
 */
export function redactMcpText(text: string, secrets: readonly string[]): string {
  let redacted = text.replace(/\s+/g, " ").trim();
  for (const secret of secrets) {
    if (secret.length < 3) continue;
    redacted = redacted.split(secret).join("[redacted]");
  }
  return redacted.length > 400 ? `${redacted.slice(0, 400)}…` : redacted;
}

/**
 * A url with a credential taken out.
 *
 * A streamable-HTTP url can carry a token in its query, and a url can carry a user and a password
 * in front of the host. The panel identifies a server by the host and path it talks to, which is
 * what a reader needs and what a secret is not, so the credential goes and the address stays.
 */
export function redactMcpUrl(url: string): string {
  const withoutUserInfo = url.replace(/^(https?:\/\/)[^@/?#]*@/i, "$1[redacted]@");
  try {
    const parsed = new URL(withoutUserInfo);
    for (const key of [...parsed.searchParams.keys()]) {
      if (SECRET_QUERY_KEY.test(key)) parsed.searchParams.set(key, REDACTED);
    }
    return parsed.toString();
  } catch {
    return withoutUserInfo;
  }
}

const SECRET_QUERY_KEY = /token|secret|password|passwd|apikey|api_key|access_key|signature|sig|auth|code|credential|session|bearer/i;
const REDACTED = "[redacted]";

/** The values a config carries that must never be echoed: header values, env values, secrets. */
export function mcpSecretValues(config: McpServerConfig): string[] {
  const secrets: string[] = [];
  if ("headers" in config && isRecord(config.headers)) secrets.push(...Object.values(config.headers).filter(isString));
  if ("env" in config && isRecord(config.env)) secrets.push(...Object.values(config.env).filter(isString));
  if ("oauth" in config && isRecord(config.oauth)) {
    const clientSecret = config.oauth["clientSecret"];
    if (typeof clientSecret === "string") secrets.push(clientSecret);
  }
  if ("url" in config && typeof config.url === "string") {
    const parsed = new URL(config.url.replace(/^(https?:\/\/)[^@/?#]*@/i, "$1"), "http://invalid.invalid");
    for (const value of parsed.searchParams.values()) {
      if (value.length > 0) secrets.push(value);
    }
  }
  return secrets.filter((secret) => secret.length > 0);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
