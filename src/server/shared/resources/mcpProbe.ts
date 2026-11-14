import { spawn } from "node:child_process";
import type { PiMcpProbe } from "../../../shared/apiTypes.js";
import { mcpSecretValues, redactMcpText, type McpHttpServerConfig, type McpServerConfig, type McpStdioServerConfig } from "./mcpConfig.js";

/**
 * "Test Connection", done without owning a connection.
 *
 * The probe speaks the same handshake pi speaks - one JSON-RPC `initialize`, then stop - and keeps
 * nothing: an stdio server is spawned for the probe and killed by the probe, and an HTTP server is
 * asked once. No session's connection is opened, closed, or reused, and no configuration is
 * written, so pressing the button cannot leave a second live server attached to a workspace.
 *
 * A config value that pi resolves by running a command (`!cmd`) is not resolved here on purpose:
 * a settings panel that runs commands from an untrusted config file would be a new way to execute
 * code. Such a server answers "not probed" and says why, which is honest and leaves pi to connect
 * it the way pi connects it.
 */

/** The protocol version the probe offers, the newest one pi's clients speak. */
export const MCP_PROBE_PROTOCOL_VERSION = "2025-06-18";
/** A probe is a question, not a session: a short answer window keeps the panel responsive. */
export const DEFAULT_MCP_PROBE_TIMEOUT_MS = 10_000;
export const MAX_MCP_PROBE_TIMEOUT_MS = 30_000;

export interface McpProbeRequest {
  name: string;
  config: McpServerConfig;
  /** Where a stdio server starts, pi's rule: relative paths resolve against the session directory. */
  cwd: string;
  timeoutMs?: number;
}

/** The part of `fetch` a probe uses, so the answer does not depend on which Response the runtime ships. */
export type McpProbeFetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ status: number; ok: boolean; text(): Promise<string> }>;

/**
 * The child process a probe needs, in the probe's own words.
 *
 * The probe never touches a ChildProcess: the adapter translates one into these six verbs, and a test
 * answers them with a plain object. That keeps the probe's only process dependency - start a server,
 * read its stdout, write one line, stop it - visible in one place.
 */
export interface McpProbeChild {
  /** Hands over each chunk of the server's stdout as text. */
  onStdout: (listener: (chunk: string) => void) => void;
  /** Hands over the exit code, or null when a signal ended the process. */
  onClose: (listener: (code: number | null) => void) => void;
  /** Hands over the reason the server could not be started, or died while answering. */
  onError: (listener: (reason: string) => void) => void;
  /** Writes one line to the server's stdin; the callback reports a write that failed. */
  writeLine: (line: string, onWritten: (error: string | undefined) => void) => void;
  /** True while the process is still there, so the probe knows what it has to stop. */
  isRunning: () => boolean;
  /** Sends a signal to the process. */
  kill: (signal: "SIGTERM" | "SIGKILL") => void;
}

/** Starts a stdio MCP server for one probe. */
export type McpProbeSpawn = (request: { command: string; args: readonly string[]; cwd: string; env: NodeJS.ProcessEnv }) => McpProbeChild;

export interface McpProbeDependencies {
  spawnChild?: McpProbeSpawn;
  fetch?: McpProbeFetch;
  env?: Readonly<NodeJS.ProcessEnv>;
}

/**
 * The adapter that speaks node's process API: the only place in the probe that does.
 *
 * It is where the process realities live, and the probe's promises are only kept if they are lived
 * here. The child starts as a process group and the signal goes to the group, because the commands
 * people configure are wrappers - `npx some-mcp`, `uvx some-mcp` - and killing only the wrapper
 * leaves the server behind, which would make "the probe leaves nothing behind" false. The child's
 * stderr is drained and dropped: a server that logs a lot at startup would otherwise fill the OS
 * pipe, block on its own write, and answer "unreachable" for a server that works fine in pi. And a
 * process that never started is not signalled - `exec` failed children report no pid and no exit
 * code, which is the state that would otherwise stall the probe for the length of its own patience.
 * And a failed `exec` is swallowed here: an unhandled `error` event on a ChildProcess kills the
 * process that spawned it, so the adapter owns the event and hands the reason to the probe.
 */
const SIGNALS_THE_PROCESS_GROUP = process.platform !== "win32";

export function spawnNodeProbeChild(request: { command: string; args: readonly string[]; cwd: string; env: NodeJS.ProcessEnv }): McpProbeChild {
  const child = spawn(request.command, [...request.args], { cwd: request.cwd, env: request.env, stdio: ["pipe", "pipe", "pipe"], detached: SIGNALS_THE_PROCESS_GROUP });
  child.stdin.on("error", () => undefined);
  child.stderr.resume();
  child.on("error", () => undefined);
  return {
    onStdout: (listener) => { child.stdout.on("data", (chunk: Buffer) => { listener(chunk.toString("utf8")); }); },
    onClose: (listener) => { child.on("close", (code) => { listener(code); }); },
    onError: (listener) => { child.on("error", (error) => { listener(errorMessage(error)); }); },
    writeLine: (line, onWritten) => { child.stdin.write(`${line}\n`, (error) => { onWritten(error === null || error === undefined ? undefined : errorMessage(error)); }); },
    isRunning: () => child.pid !== undefined && child.exitCode === null && child.signalCode === null,
    kill: (signal) => {
      if (child.pid === undefined) return;
      try {
        if (SIGNALS_THE_PROCESS_GROUP) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        // The group is already gone: signalling a dead process answers ESRCH, and that is the goal.
      }
    },
  };
}

/** Why a probe stopped, in a form that can be shown: never a secret, never a command's output. */
export async function probeMcpServer(request: McpProbeRequest, dependencies: McpProbeDependencies = {}): Promise<PiMcpProbe> {
  const timeoutMs = clampProbeTimeout(request.timeoutMs);
  const env = dependencies.env ?? process.env;
  const secrets = [...mcpSecretValues(request.config), ...resolvedReferenceValues(request.config, env)];
  const outcome = asHttpConfig(request.config) !== undefined
    ? await probeHttpServer(request, timeoutMs, dependencies)
    : await probeStdioServer(request, timeoutMs, dependencies);
  return {
    state: outcome.state,
    ...(outcome.message !== undefined ? { message: redactMcpText(outcome.message, secrets) } : {}),
    ...(outcome.serverName === undefined ? {} : { serverName: redactMcpText(outcome.serverName, secrets) }),
    ...(outcome.serverVersion === undefined ? {} : { serverVersion: redactMcpText(outcome.serverVersion, secrets) }),
    probedAt: new Date().toISOString(),
  };
}

function clampProbeTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined || !Number.isFinite(timeoutMs) || timeoutMs <= 0) return DEFAULT_MCP_PROBE_TIMEOUT_MS;
  return Math.min(timeoutMs, MAX_MCP_PROBE_TIMEOUT_MS);
}

function asStdioConfig(config: McpServerConfig): McpStdioServerConfig | undefined {
  return "command" in config && typeof config.command === "string" ? config : undefined;
}

/** The runtime's own `fetch`, narrowed to what a probe reads, so no Response type crosses the seam. */
async function browserFetch(url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }): Promise<{ status: number; ok: boolean; text(): Promise<string> }> {
  const response = await fetch(url, init);
  return { status: response.status, ok: response.ok, text: () => response.text() };
}

function asHttpConfig(config: McpServerConfig): McpHttpServerConfig | undefined {
  return "url" in config && typeof config.url === "string" ? config : undefined;
}

/**
 * One `initialize` over streamable HTTP, answered by the server's own handshake.
 *
 * A 401 is reported as a server that needs a sign-in, which is pi's own state for it and not a
 * failure to reach it. The response body is read for the server's name only; the request carries
 * the config's headers exactly as the server asked for them, and none of them is echoed back.
 */
async function probeHttpServer(
  request: McpProbeRequest,
  timeoutMs: number,
  dependencies: McpProbeDependencies,
): Promise<{ state: PiMcpProbe["state"]; message?: string; serverName?: string; serverVersion?: string }> {
  const config = asHttpConfig(request.config);
  if (config === undefined) return { state: "unreachable", message: "Server names no url." };
  const controller = new AbortController();
  const timer = setTimeout(() => { controller.abort(); }, timeoutMs);
  const send: McpProbeFetch = dependencies.fetch ?? browserFetch;
  try {
    const response = await send(config.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...Object.fromEntries(Object.entries(config.headers ?? {}).map(([key, value]) => [key, resolveEnvReference(value, dependencies.env ?? process.env)])),
      },
      body: JSON.stringify(initializeRequest()),
      signal: controller.signal,
    });
    if (response.status === 401 || response.status === 403) {
      return { state: "needs-auth", message: `The server answered ${String(response.status)}; sign in through pi's /mcp manager.` };
    }
    const text = await response.text();
    if (!response.ok) return { state: "unreachable", message: `The server answered ${String(response.status)}.` };
    const parsed = parseJsonOrEventStream(text);
    if (parsed === undefined) return { state: "unreachable", message: "The server answered without a JSON-RPC result." };
    return handshakeResult(parsed);
  } catch (error) {
    return { state: "unreachable", message: controller.signal.aborted ? `The server did not answer within ${String(Math.round(timeoutMs / 1000))} s.` : errorMessage(error) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One `initialize` over an stdio pipe, then the process is gone.
 *
 * The child is killed on every exit path, and the exit is waited for, so a probe does not leave a
 * server process behind. The server's stderr is not shown: it is the server's own text, which can
 * carry the env the configuration handed it.
 */
async function probeStdioServer(
  request: McpProbeRequest,
  timeoutMs: number,
  dependencies: McpProbeDependencies,
): Promise<{ state: PiMcpProbe["state"]; message?: string; serverName?: string; serverVersion?: string }> {
  const config = asStdioConfig(request.config);
  if (config === undefined) return { state: "unreachable", message: "Server names no command." };
  const env = dependencies.env ?? process.env;
  const commandReference = referencedCommandValue(config);
  if (commandReference !== undefined) {
    return { state: "unreachable", message: `Not probed: the config resolves ${commandReference} by running a command, which PI WEB does not run from a settings panel.` };
  }
  const spawnChild = dependencies.spawnChild ?? spawnNodeProbeChild;
  let child: McpProbeChild;
  try {
    child = spawnChild({
      command: config.command,
      args: config.args ?? [],
      cwd: config.cwd ?? request.cwd,
      env: { ...env, ...Object.fromEntries(Object.entries(config.env ?? {}).map(([key, value]) => [key, resolveEnvReference(value, env)])) },
    });
  } catch (error) {
    return { state: "unreachable", message: `Could not start the server: ${errorMessage(error)}` };
  }
  const settled = new Promise<{ state: PiMcpProbe["state"]; message?: string; serverName?: string; serverVersion?: string }>((resolve) => {
    let answered = false;
    const finish = (outcome: { state: PiMcpProbe["state"]; message?: string; serverName?: string; serverVersion?: string }) => {
      if (answered) return;
      answered = true;
      resolve(outcome);
    };
    const timer = setTimeout(() => { finish({ state: "unreachable", message: `The server did not answer the handshake within ${String(Math.round(timeoutMs / 1000))} s.` }); }, timeoutMs);
    let buffer = "";
    child.onStdout((chunk) => {
      buffer += chunk;
      for (const line of buffer.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("{")) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          continue;
        }
        if (!isHandshakeAnswer(parsed)) continue;
        clearTimeout(timer);
        finish(handshakeResult(parsed));
        return;
      }
    });
    child.onError((reason) => {
      clearTimeout(timer);
      finish({ state: "unreachable", message: `Could not start the server: ${reason}` });
    });
    child.onClose((code) => {
      clearTimeout(timer);
      finish({ state: "unreachable", message: `The server exited with ${String(code ?? "a signal")} before answering the handshake.` });
    });
    child.writeLine(JSON.stringify(initializeRequest()), (error) => {
      if (error !== undefined) {
        clearTimeout(timer);
        finish({ state: "unreachable", message: "Could not write the handshake to the server." });
      }
    });
  });
  const outcome = await settled;
  await stopChild(child);
  return outcome;
}

/** SIGTERM, then SIGKILL if the server is still there: the probe always leaves no process behind. */
async function stopChild(child: McpProbeChild): Promise<void> {
  if (!child.isRunning()) return;
  const exited = new Promise<void>((resolve) => {
    child.onClose(() => { resolve(); });
    const pat = setTimeout(() => { resolve(); }, 2_000);
    pat.unref();
  });
  child.kill("SIGTERM");
  await exited;
  if (child.isRunning()) child.kill("SIGKILL");
}

function initializeRequest(): { jsonrpc: "2.0"; id: number; method: string; params: unknown } {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: MCP_PROBE_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "pi-web-mcp-probe", version: "1" },
    },
  };
}

/** A line answers the handshake only when it carries a result or an error for it. */
function isHandshakeAnswer(parsed: unknown): boolean {
  if (!isRecordLike(parsed)) return false;
  return parsed["result"] !== undefined || parsed["error"] !== undefined;
}

function handshakeResult(parsed: unknown): { state: PiMcpProbe["state"]; message?: string; serverName?: string; serverVersion?: string } {
  if (!isRecordLike(parsed)) return { state: "unreachable", message: "The server answered without a JSON-RPC result." };
  const result = parsed["result"];
  if (isRecordLike(result)) {
    const info = result["serverInfo"];
    const serverInfo = isRecordLike(info) ? info : undefined;
    return {
      state: "reachable",
      ...(typeof serverInfo?.["name"] === "string" ? { serverName: serverInfo["name"] } : {}),
      ...(typeof serverInfo?.["version"] === "string" ? { serverVersion: serverInfo["version"] } : {}),
    };
  }
  const error = parsed["error"];
  const message = isRecordLike(error) && typeof error["message"] === "string" ? error["message"] : "The server refused the handshake.";
  return { state: "unreachable", message };
}

/**
 * The values the probe actually hands over, after pi's `${NAME}` resolution.
 *
 * A config that names `${GITHUB_TOKEN}` holds no secret; the process environment does, and the
 * resolved value is what the server sees. So the redaction list is built from the resolved text,
 * not only from the literal in the file: a server that echoes back what it was handed cannot then
 * put the value into the panel through a probe message.
 */
function resolvedReferenceValues(config: McpServerConfig, env: Readonly<NodeJS.ProcessEnv>): string[] {
  const values: string[] = [];
  const resolve = (value: string): string => resolveEnvReference(value, env);
  if ("env" in config && isRecordLike(config.env)) values.push(...Object.values(config.env).filter((entry) => typeof entry === "string").map(resolve));
  if ("headers" in config && isRecordLike(config.headers)) values.push(...Object.values(config.headers).filter((entry) => typeof entry === "string").map(resolve));
  if ("args" in config && Array.isArray(config.args)) values.push(...config.args.filter((entry) => typeof entry === "string").map(resolve));
  return values.filter((value) => value.length > 0);
}

/** A `${NAME}` reference is resolved from the process environment; a `!command` value is not run. */
function resolveEnvReference(value: string, env: Readonly<NodeJS.ProcessEnv>): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => env[name] ?? "");
}

function referencedCommandValue(config: McpServerConfig): string | undefined {
  const values: string[] = [];
  if ("env" in config && isRecordLike(config.env)) values.push(...Object.values(config.env).filter((entry) => typeof entry === "string"));
  if ("headers" in config && isRecordLike(config.headers)) values.push(...Object.values(config.headers).filter((entry) => typeof entry === "string"));
  if ("args" in config && Array.isArray(config.args)) values.push(...config.args.filter((entry) => typeof entry === "string"));
  return values.find((value) => value.trim().startsWith("!"));
}

function parseJsonOrEventStream(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed === "") return undefined;
  const direct = tryJson(trimmed);
  if (direct !== undefined) return direct;
  for (const line of trimmed.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const payload = tryJson(line.slice("data:".length).trim());
    if (payload !== undefined) return payload;
  }
  return undefined;
}

function tryJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
