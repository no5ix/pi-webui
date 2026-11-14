import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addMcpServerConfig,
  McpConfigWriteError,
  globalMcpConfigPath,
  loadMcpConfig,
  mcpNamespace,
  mcpSecretValues,
  projectMcpConfigPath,
  redactMcpText,
  redactMcpUrl,
  removeMcpServerConfig,
  updateMcpServerConfig,
  validateMcpServerConfig,
} from "./mcpConfig";

/**
 * PI WEB's copy of pi's MCP configuration rules.
 *
 * These tests are the contract that lets the copy exist: every rule here is pi's, and a change to
 * one of them means pi's format moved and this module has to move with it. Reading a server pi
 * would not read, or writing a file pi would refuse, is how a settings panel breaks a runtime it
 * does not own.
 */

let root: string;
let agentDir: string;
let projectPath: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pi-web-mcp-config-"));
  agentDir = join(root, "agent");
  projectPath = join(root, "project");
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(join(projectPath, ".pi"), { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeGlobal(json: unknown): string {
  const path = globalMcpConfigPath(agentDir);
  writeFileSync(path, typeof json === "string" ? json : `${JSON.stringify(json, null, 2)}\n`, "utf8");
  return path;
}

function writeProject(json: unknown): string {
  const path = projectMcpConfigPath(projectPath);
  writeFileSync(path, typeof json === "string" ? json : `${JSON.stringify(json, null, 2)}\n`, "utf8");
  return path;
}

describe("a file that is not JSON", () => {
  it("names the file and the position, and never the file's own text", () => {
    writeGlobal(`{ "mcpServers": { "files": { "env": { "TOKEN": "bearer-secret-value" } }, } }`);

    const loaded = loadMcpConfig({ agentDir, cwd: projectPath, projectTrusted: false });

    expect(loaded.servers).toEqual([]);
    expect(loaded.errors).toHaveLength(1);
    expect(loaded.errors[0]).toContain(globalMcpConfigPath(agentDir));
    expect(loaded.errors[0]).toContain("not valid JSON");
    expect(loaded.errors.join(" ")).not.toContain("bearer-secret-value");
    expect(loaded.errors.join(" ")).not.toContain("TOKEN");
  });

  it("refuses to write into it, and leaves the file byte for byte", () => {
    const broken = `{ "mcpServers": { "files": { "command": "mcp-files" }, } }`;
    const path = writeGlobal(broken);

    expect(() => addMcpServerConfig(path, "extra", { command: "mcp-extra" })).toThrow(McpConfigWriteError);

    expect(readFileSync(path, "utf8")).toBe(broken);
  });
});

function readTrusted() {
  return loadMcpConfig({ agentDir, cwd: projectPath, projectTrusted: true });
}

/**
 * What a write left on disk, read the way pi reads it: a plain object whose `mcpServers` maps names
 * to entries. A file that is not that shape fails the check that asked for it, instead of reading
 * through an `any` that answers anything.
 */
function writtenConfig(path: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isRecord(parsed)) throw new Error(`${path} does not hold an object`);
  return parsed;
}

function writtenServers(path: string): Record<string, unknown> {
  const servers: unknown = writtenConfig(path)["mcpServers"];
  if (!isRecord(servers)) throw new Error(`${path} does not define "mcpServers"`);
  return servers;
}

function writtenServer(path: string, name: string): unknown {
  return writtenServers(path)[name];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const stdio = { command: "mcp-files", args: ["--root", "/srv"] };

describe("reading pi's MCP configuration", () => {
  it("reads the global file and treats a server without enabled as enabled", () => {
    writeGlobal({ mcpServers: { files: stdio } });

    const loaded = loadMcpConfig({ agentDir, cwd: projectPath, projectTrusted: false });

    expect(loaded.errors).toEqual([]);
    expect(loaded.servers).toHaveLength(1);
    expect(loaded.servers[0]).toMatchObject({ name: "files", scope: "global", source: globalMcpConfigPath(agentDir) });
    expect(loaded.servers[0]?.config).toMatchObject(stdio);
    expect(loaded.servers[0]?.config.enabled).toBeUndefined();
  });

  it("keeps a disabled server in the list, because it is configured, not absent", () => {
    writeGlobal({ mcpServers: { files: { ...stdio, enabled: false } } });

    const loaded = loadMcpConfig({ agentDir, cwd: projectPath, projectTrusted: false });

    expect(loaded.servers[0]?.config.enabled).toBe(false);
  });

  it("reads a project file only for a trusted project", () => {
    writeProject({ mcpServers: { search: { url: "https://example.test/mcp" } } });

    expect(loadMcpConfig({ agentDir, cwd: projectPath, projectTrusted: false }).servers).toEqual([]);
    expect(loadMcpConfig({ agentDir, cwd: projectPath, projectTrusted: false }).projectConfig).toBeUndefined();

    const trusted = readTrusted();
    expect(trusted.servers.map((entry) => entry.name)).toEqual(["search"]);
    expect(trusted.projectConfig).toBe(projectMcpConfigPath(projectPath));
  });

  it("lets a project entry override only the settings pi allows an override to set", () => {
    writeGlobal({ mcpServers: { files: { ...stdio, exposure: "deferred" } } });
    writeProject({ mcpServers: { files: { enabled: false } } });

    const loaded = readTrusted();

    expect(loaded.errors).toEqual([]);
    expect(loaded.servers).toHaveLength(1);
    expect(loaded.servers[0]).toMatchObject({ name: "files", scope: "global", override: projectMcpConfigPath(projectPath) });
    expect(loaded.servers[0]?.config).toMatchObject({ command: "mcp-files", exposure: "deferred", enabled: false });
  });

  it("refuses an override that sets a key pi does not allow an override to set, and one with no global server to answer", () => {
    writeProject({ mcpServers: { lone: { enabled: false } } });
    expect(readTrusted().errors[0]).toContain("needs \"command\" or \"url\"");

    writeGlobal({ mcpServers: { files: stdio } });
    writeProject({ mcpServers: { files: { enabled: false, timeout: 5 } } });
    expect(readTrusted().errors[0]).toContain("can only set");
  });

  it("lets a project entry that carries a command replace the global definition, as pi does", () => {
    writeGlobal({ mcpServers: { files: stdio } });
    writeProject({ mcpServers: { files: { command: "project-files" } } });

    const loaded = readTrusted();

    expect(loaded.errors).toEqual([]);
    expect(loaded.servers).toHaveLength(1);
    expect(loaded.servers[0]).toMatchObject({ name: "files", scope: "project", source: projectMcpConfigPath(projectPath) });
    expect(loaded.servers[0]?.config).toMatchObject({ command: "project-files" });
  });

  it("resolves the exposure alias pi accepts", () => {
    writeGlobal({ mcpServers: { files: { ...stdio, exposure: "codemode-deferred", toolExposure: { read: "codemode-deferred" } } } });

    const loaded = loadMcpConfig({ agentDir, cwd: projectPath, projectTrusted: false });

    expect(loaded.servers[0]?.config.exposure).toBe("codemode");
    expect(loaded.servers[0]?.config.toolExposure).toEqual({ read: "codemode" });
  });

  it("refuses two servers that would share one tool namespace", () => {
    writeGlobal({ mcpServers: { "my_server": stdio, "my-server": stdio } });

    const loaded = loadMcpConfig({ agentDir, cwd: projectPath, projectTrusted: false });

    expect(mcpNamespace("my_server")).toBe(mcpNamespace("my-server"));
    expect(loaded.servers.map((entry) => entry.name)).toEqual(["my_server"]);
    expect(loaded.errors[0]).toContain("conflicts with");
  });

  it("refuses the legacy SSE transport, an unparseable url, a bad name, and a bad exposure", () => {
    expect(validateMcpServerConfig("files", { type: "sse", url: "https://example.test/sse" })).toContain("legacy SSE");
    expect(validateMcpServerConfig("files", { url: "ftp://example.test/mcp" })).toContain("http or https");
    expect(validateMcpServerConfig("bad name", stdio)).toContain("invalid server name");
    expect(validateMcpServerConfig("files", { ...stdio, exposure: "sometimes" })).toContain("exposure must be one of");
    expect(validateMcpServerConfig("files", { ...stdio, toolExposure: { read: "sometimes" } })).toContain("toolExposure");
    expect(validateMcpServerConfig("files", { ...stdio, enabled: "yes" })).toContain("enabled must be a boolean");
    expect(validateMcpServerConfig("files", { ...stdio, timeout: 0 })).toContain("positive number");
    expect(validateMcpServerConfig("files", {})).toContain("needs either \"command\"");
  });

  it("keeps an auth provider on https and loopback only, and oauth on a loopback redirect", () => {
    expect(validateMcpServerConfig("files", { url: "http://example.test/mcp", auth: { provider: "pi" } })).toContain("https URL");
    expect(validateMcpServerConfig("files", { url: "http://localhost:3118/mcp", auth: { provider: "pi" } })).toBeTypeOf("object");
    expect(validateMcpServerConfig("files", { url: "https://example.test/mcp", oauth: { redirectUri: "https://example.test/cb" } })).toContain("loopback");
    expect(validateMcpServerConfig("files", { url: "https://example.test/mcp", oauth: { clientSecret: 7 } })).toContain("oauth.clientSecret");
  });

  it("accepts pi's streamable-http spelling of the http transport, with the entry it was given", () => {
    const config = validateMcpServerConfig("search", { type: "streamable-http", url: "https://example.test/mcp" });

    expect(typeof config).toBe("object");
    expect(config).toMatchObject({ type: "streamable-http", url: "https://example.test/mcp" });
  });

  it("keeps the keys an auth provider carries of its own on an https url, and still refuses auth off loopback", () => {
    const auth = { provider: "pi", scopes: ["mcp:tools"] };

    const accepted = validateMcpServerConfig("search", { url: "https://example.test/mcp", auth });

    expect(typeof accepted).toBe("object");
    expect(accepted).toMatchObject({ url: "https://example.test/mcp", auth });
    expect(validateMcpServerConfig("search", { url: "http://example.test/mcp", auth })).toContain("auth requires an https URL");
  });

  it("reports a file it cannot parse instead of answering an empty list", () => {
    writeGlobal("{ not json");

    const loaded = loadMcpConfig({ agentDir, cwd: projectPath, projectTrusted: false });

    expect(loaded.servers).toEqual([]);
    expect(loaded.errors[0]).toContain("mcp.json");
  });

  it("reports a file whose mcpServers is not an object", () => {
    writeGlobal({ mcpServers: [] });

    expect(loadMcpConfig({ agentDir, cwd: projectPath, projectTrusted: false }).errors[0]).toContain("mcpServers");
  });
});

describe("writing pi's MCP configuration", () => {
  it("writes enabled: false and removes the key again, because true is pi's default", () => {
    const path = writeGlobal({ mcpServers: { files: stdio } });

    updateMcpServerConfig(path, "files", { enabled: false });
    expect(writtenServer(path, "files")).toEqual({ ...stdio, enabled: false });

    updateMcpServerConfig(path, "files", { enabled: true });
    expect(writtenServer(path, "files")).toEqual(stdio);
  });

  it("keeps the defaults an override entry has to state, and creates the entry on request", () => {
    writeGlobal({ mcpServers: { files: stdio } });
    const project = writeProject({});

    updateMcpServerConfig(project, "files", { enabled: false }, { override: true });
    expect(writtenServer(project, "files")).toEqual({ enabled: false });

    updateMcpServerConfig(project, "files", { enabled: true }, { override: true });
    expect(writtenServer(project, "files")).toEqual({ enabled: true });
  });

  it("leaves every other key, the file's indentation, and its trailing newline where they were", () => {
    const path = join(agentDir, "mcp.json");
    writeFileSync(path, '{\n    "mcpServers": {\n        "files": { "command": "mcp-files", "cwd": "~/srv" },\n        "search": { "url": "https://example.test/mcp" }\n    },\n    "autoEnableCodemode": true\n}\n', "utf8");

    updateMcpServerConfig(path, "files", { enabled: false, exposure: "direct" });

    const text = readFileSync(path, "utf8");
    expect(text).toContain("\n    \"mcpServers\"");
    expect(text.endsWith("\n")).toBe(true);
    const parsed = writtenConfig(path);
    const servers = writtenServers(path);
    expect(parsed["autoEnableCodemode"]).toBe(true);
    expect(servers["search"]).toEqual({ url: "https://example.test/mcp" });
    expect(servers["files"]).toEqual({ command: "mcp-files", cwd: "~/srv", enabled: false, exposure: "direct" });
  });

  it("drops a server from one file, and says when that file never had it", () => {
    const path = writeGlobal({ mcpServers: { files: stdio, search: { url: "https://example.test/mcp" } } });

    expect(removeMcpServerConfig(path, "files")).toBe(true);
    expect(writtenServers(path)).toEqual({ search: { url: "https://example.test/mcp" } });
    expect(removeMcpServerConfig(path, "files")).toBe(false);
    expect(removeMcpServerConfig(join(agentDir, "missing.json"), "files")).toBe(false);
  });

  it("adds a server, creating the file, and reports a replacement", () => {
    const path = join(agentDir, "mcp.json");

    expect(existsSync(path)).toBe(false);
    expect(addMcpServerConfig(path, "files", { ...stdio })).toBe(false);
    expect(writtenServer(path, "files")).toEqual(stdio);
    expect(addMcpServerConfig(path, "files", { ...stdio })).toBe(true);
  });

  it("refuses to write into a file that is not the shape it must keep", () => {
    const path = writeGlobal("[]");

    expect(() => { updateMcpServerConfig(path, "files", { enabled: false }); }).toThrow(/mcpServers/);
  });
});

describe("keeping secrets inside the machine", () => {
  it("collects the values a config carries that must never be echoed", () => {
    const secrets = mcpSecretValues({
      command: "srv",
      env: { TOKEN: "env-secret-value" },
      headers: { Authorization: "Bearer header-secret-value" },
      oauth: { clientSecret: "oauth-secret-value" },
    });

    expect(secrets).toEqual(["Bearer header-secret-value", "env-secret-value", "oauth-secret-value"]);
  });

  it("cuts every one of them out of a line of text, and bounds the line", () => {
    const text = "handshake failed for Authorization: Bearer header-secret-value with env TOKEN=env-secret-value and " + "x".repeat(600);

    const redacted = redactMcpText(text, mcpSecretValues({
      url: "https://example.test/mcp",
      headers: { Authorization: "Bearer header-secret-value" },
      env: { TOKEN: "env-secret-value" },
    }));

    expect(redacted).not.toContain("header-secret-value");
    expect(redacted).not.toContain("env-secret-value");
    expect(redacted).toContain("[redacted]");
    expect(redacted.length).toBeLessThanOrEqual(401);
  });

  it("keeps a credential out of a url the panel is shown, and out of the values a probe carries", () => {
    const query = redactMcpUrl("https://example.test/mcp?token=secret-in-query&path=%2Fa");
    expect(query).not.toContain("secret-in-query");
    expect(query).toContain("example.test/mcp");
    expect(query).toContain("path=");

    const userInfo = redactMcpUrl("https://user:password@example.test/mcp");
    expect(userInfo).not.toContain("password");
    expect(userInfo).toContain("example.test/mcp");

    expect(redactMcpUrl("https://example.test/mcp/servers/files")).toContain("/servers/files");
    expect(redactMcpUrl("not a url")).toBe("not a url");

    const secrets = mcpSecretValues({ url: "https://example.test/mcp?access_key=the-access-key" });
    expect(secrets).toContain("the-access-key");
  });

  it("collapses the newlines a server's own message can carry", () => {
    expect(redactMcpText("line one\nline two\ttabbed", [])).toBe("line one line two tabbed");
  });
});
