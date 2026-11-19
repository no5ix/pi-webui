import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isRecord } from "../../shared/unknownValues.js";
import type { PiMcpProbe } from "../../shared/apiTypes.js";
import { globalMcpConfigPath, projectMcpConfigPath, type McpServerConfig, type McpServerConfigPatch } from "../shared/resources/mcpConfig.js";
import {
  DefaultPiMcpService,
  fileMcpConfigPort,
  PiMcpRequestError,
  PiMcpServerErrorNotFound,
  type McpProbePort,
} from "./piMcpService";
import { SettingsProjectError, type SettingsProjectResolver } from "../shared/resources/settingsProjectResolver.js";

/**
 * The MCP panel's service, on real files in a temporary machine.
 *
 * The service writes pi's files, so the tests read them back: a claim that a server is off, that a
 * project override was made, or that a removal restored the global server, is only worth anything
 * if the file says so. The probe is the one seam that is faked, because a test must not start a
 * process or reach a network.
 */

const SECRET = "super-secret-token-value";

let root: string;
let agentDir: string;
let projectPath: string;
let probe: McpProbePort;
let projects: SettingsProjectResolver;

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(path: string): Record<string, unknown> {
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isRecord(value)) throw new Error(`Expected the MCP config file to be an object: ${path}`);
  return value;
}

function serversIn(path: string): Record<string, unknown> {
  const servers = readJson(path)["mcpServers"];
  if (!isRecord(servers)) throw new Error(`Expected an "mcpServers" object in ${path}`);
  return servers;
}

function service(): DefaultPiMcpService {
  return new DefaultPiMcpService(fileMcpConfigPort(agentDir), probe, projects);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pi-web-mcp-service-"));
  agentDir = join(root, "agent");
  projectPath = join(root, "project");
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(join(projectPath, ".pi"), { recursive: true });
  probe = { probe: vi.fn(() => Promise.resolve({ state: "reachable", serverName: "files-server" } satisfies PiMcpProbe)) };
  projects = {
    requireProjectPath: (projectId: string): Promise<string> => {
      if (projectId !== "p-1") throw new SettingsProjectError(404, `Project ${projectId} was not found`);
      return Promise.resolve(projectPath);
    },
    isProjectTrusted: () => true,
  };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("listing MCP servers", () => {
  it("reports the global servers, and keeps every secret in the file", async () => {
    writeJson(globalMcpConfigPath(agentDir), {
      mcpServers: {
        files: { command: "mcp-files", args: ["mcp-remote", `https://example.test/mcp?token=${SECRET}`], env: { TOKEN: SECRET } },
        search: { url: "https://example.test/mcp", headers: { Authorization: `Bearer ${SECRET}` }, enabled: false },
      },
    });

    const listed = await service().list({});

    expect(listed.errors).toEqual([]);
    expect(listed.servers).toHaveLength(2);
    expect(listed.servers[0]).toMatchObject({ name: "files", scope: "global", transport: "stdio", configured: "enabled", enabled: true, command: "mcp-files", envNames: ["TOKEN"], usesSecrets: true, probe: { state: "unprobed" } });
    expect(listed.servers[1]).toMatchObject({ name: "search", transport: "http", configured: "disabled", enabled: false, headerNames: ["Authorization"] });
    expect(listed.servers[0]).not.toHaveProperty("args");
    expect(JSON.stringify(listed)).not.toContain(SECRET);
    expect(listed.projectScopeRead).toBe(false);
  });

  it("leaves an untrusted project's servers out of the list, and says the project scope was not read", async () => {
    writeJson(globalMcpConfigPath(agentDir), { mcpServers: { files: { command: "mcp-files" } } });
    writeJson(projectMcpConfigPath(projectPath), { mcpServers: { "project-server": { command: "sh", args: ["-c", "curl https://example.test"] } } });
    projects = { ...projects, isProjectTrusted: () => false };

    const listed = await service().list({ projectId: "p-1" });

    expect(listed.servers.map((server) => server.name)).toEqual(["files"]);
    expect(listed.projectTrusted).toBe(false);
    expect(listed.projectScopeRead).toBe(false);
    expect(listed.projectConfigPath).toBeUndefined();
  });

  it("refuses to connect, change, or remove anything while the project is not trusted, and never spawns", async () => {
    writeJson(globalMcpConfigPath(agentDir), { mcpServers: { files: { command: "mcp-files" } } });
    writeJson(projectMcpConfigPath(projectPath), { mcpServers: { "project-server": { command: "sh", args: ["-c", "true"] } } });
    projects = { ...projects, isProjectTrusted: () => false };

    await expect(service().test({ name: "project-server", projectId: "p-1" })).rejects.toThrow("not trusted");
    await expect(service().setEnabled({ name: "project-server", target: "definition", projectId: "p-1", enabled: true })).rejects.toThrow("not trusted");
    await expect(service().remove({ name: "project-server", target: "definition", projectId: "p-1" })).rejects.toThrow("not trusted");

    expect(probe.probe).not.toHaveBeenCalled();
    expect(existsSync(projectMcpConfigPath(projectPath))).toBe(true);
  });

  it("says a broken mcp.json is not valid JSON, and does not repeat what the file contains", async () => {
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(globalMcpConfigPath(agentDir), `{ "mcpServers": { "files": { "headers": { "Authorization": "Bearer ${SECRET}" } }, } }`, "utf8");

    const listed = await service().list({});

    expect(listed.servers).toEqual([]);
    expect(listed.errors).toHaveLength(1);
    expect(listed.errors[0]).toContain(globalMcpConfigPath(agentDir));
    expect(listed.errors[0]).toContain("not valid JSON");
    expect(listed.errors[0]).not.toContain(SECRET);
  });

  it("refuses to write into a file it cannot parse, and leaves the file alone", async () => {
    const path = globalMcpConfigPath(agentDir);
    mkdirSync(agentDir, { recursive: true });
    const broken = `{ "mcpServers": { "files": { "command": "mcp-files" }, } }`;
    writeFileSync(path, broken, "utf8");

    await expect(service().setEnabled({ name: "files", target: "definition", enabled: false })).rejects.toThrow(/not valid JSON|No MCP server/);

    expect(readFileSync(path, "utf8")).toBe(broken);
  });

  it("reads a trusted project's file alongside the global one", async () => {
    writeJson(globalMcpConfigPath(agentDir), { mcpServers: { files: { command: "mcp-files" } } });
    writeJson(projectMcpConfigPath(projectPath), { mcpServers: { files: { enabled: false }, search: { url: "https://example.test/mcp" } } });

    const listed = await service().list({ projectId: "p-1" });

    expect(listed.projectScopeRead).toBe(true);
    expect(listed.projectPath).toBe(projectPath);
    expect(listed.servers.find((entry) => entry.name === "files")).toMatchObject({ enabled: false, scope: "global", overridePath: projectMcpConfigPath(projectPath), overrideOnly: true });
    expect(listed.servers.find((entry) => entry.name === "search")).toMatchObject({ scope: "project", configPath: projectMcpConfigPath(projectPath) });
  });

  it("carries a file it cannot parse as an error, not as an empty list", async () => {
    writeFileSync(globalMcpConfigPath(agentDir), "{ mcpServers: ", "utf8");

    const listed = await service().list({});

    expect(listed.servers).toEqual([]);
    expect(listed.errors[0]).toContain("mcp.json");
  });

  it("refuses a project the machine does not know", async () => {
    await expect(service().list({ projectId: "p-9" })).rejects.toBeInstanceOf(SettingsProjectError);
  });
});

describe("changing an MCP server", () => {
  beforeEach(() => {
    writeJson(globalMcpConfigPath(agentDir), { mcpServers: { files: { command: "mcp-files", env: { TOKEN: SECRET } } } });
  });

  it("turns a global server off in the global file, and says a reload is needed", async () => {
    const response = await service().setEnabled({ name: "files", target: "definition", enabled: false });

    expect(serversIn(globalMcpConfigPath(agentDir))["files"]).toEqual({ command: "mcp-files", env: { TOKEN: SECRET }, enabled: false });
    expect(response).toMatchObject({ action: "set-enabled", name: "files", enabled: false, requiresReload: true });
    expect(response.servers.find((entry) => entry.name === "files")?.enabled).toBe(false);
  });

  it("turns it back on by removing the key, which is pi's default", async () => {
    await service().setEnabled({ name: "files", target: "definition", enabled: false });
    const response = await service().setEnabled({ name: "files", target: "definition", enabled: true });

    expect(serversIn(globalMcpConfigPath(agentDir))["files"]).toEqual({ command: "mcp-files", env: { TOKEN: SECRET } });
    expect(response.servers.find((entry) => entry.name === "files")?.enabled).toBe(true);
  });

  it("turns a global server off for one project by writing that project's override, never the global file", async () => {
    const globalBefore = readFileSync(globalMcpConfigPath(agentDir), "utf8");

    const response = await service().setEnabled({ name: "files", target: "override", projectId: "p-1", enabled: false });

    expect(readFileSync(globalMcpConfigPath(agentDir), "utf8")).toBe(globalBefore);
    expect(serversIn(projectMcpConfigPath(projectPath))["files"]).toEqual({ enabled: false });
    expect(response.servers.find((entry) => entry.name === "files")).toMatchObject({ enabled: false, overridePath: projectMcpConfigPath(projectPath) });
  });

  it("refuses to write a global change for a server only the project defines", async () => {
    writeJson(projectMcpConfigPath(projectPath), { mcpServers: { local: { command: "mcp-local" } } });

    await expect(service().setEnabled({ name: "local", target: "definition", scope: "global", enabled: false, projectId: "p-1" })).rejects.toBeInstanceOf(PiMcpRequestError);
    expect(serversIn(globalMcpConfigPath(agentDir))).toEqual({ files: { command: "mcp-files", env: { TOKEN: SECRET } } });
  });

  it("removes a server from the file that defines it, and restores the global server when that file was an override", async () => {
    writeJson(projectMcpConfigPath(projectPath), { mcpServers: { files: { enabled: false } } });

    const response = await service().remove({ name: "files", target: "override", projectId: "p-1" });

    expect(serversIn(projectMcpConfigPath(projectPath))).toEqual({});
    expect(response.removed).toBe(true);
    expect(response.requiresReload).toBe(true);
    const restored = response.servers.find((entry) => entry.name === "files");
    expect(restored?.enabled).toBe(true);
    expect(restored).not.toHaveProperty("overridePath");
  });

  it("says a removal did nothing when the file the named scope owns has no such server", async () => {
    const response = await service().remove({ name: "files", target: "override", projectId: "p-1" });

    expect(response.removed).toBe(false);
    expect(serversIn(globalMcpConfigPath(agentDir))).toHaveProperty("files");
    expect(existsSync(projectMcpConfigPath(projectPath))).toBe(false);
  });

  it("answers a server that is not configured with a 404-shaped problem", async () => {
    await expect(service().setEnabled({ name: "gone", target: "definition", enabled: false })).rejects.toBeInstanceOf(PiMcpServerErrorNotFound);
  });

  it("refuses to edit a server an extension registered, which pi owns", async () => {
    await expect(service().setEnabled({ name: "files", target: "definition", scope: "extension", enabled: false })).rejects.toBeInstanceOf(PiMcpRequestError);
    await expect(service().remove({ name: "files", target: "definition", scope: "extension" })).rejects.toBeInstanceOf(PiMcpRequestError);
  });
});

describe("testing a connection", () => {
  it("probes the server pi would connect, and writes nothing", async () => {
    writeJson(globalMcpConfigPath(agentDir), { mcpServers: { files: { command: "mcp-files", timeout: 4 } } });
    const before = readFileSync(globalMcpConfigPath(agentDir), "utf8");

    const response = await service().test({ name: "files" });

    expect(probe.probe).toHaveBeenCalledWith("files", { command: "mcp-files", timeout: 4 }, process.cwd(), 4);
    expect(readFileSync(globalMcpConfigPath(agentDir), "utf8")).toBe(before);
    expect(response).toMatchObject({ action: "test", name: "files", requiresReload: false, probe: { state: "reachable", serverName: "files-server" } });
  });

  it("probes a project server in the project's own directory", async () => {
    writeJson(projectMcpConfigPath(projectPath), { mcpServers: { local: { command: "mcp-local" } } });

    await service().test({ name: "local", projectId: "p-1" });

    expect(probe.probe).toHaveBeenCalledWith("local", { command: "mcp-local" }, projectPath, undefined);
  });

  it("answers a probe of a server that is not configured with a 404-shaped problem", async () => {
    await expect(service().test({ name: "gone" })).rejects.toBeInstanceOf(PiMcpServerErrorNotFound);
    expect(probe.probe).not.toHaveBeenCalled();
  });

  it("puts the probe's answer on the row the reader tested, not only at the top of the answer", async () => {
    writeJson(globalMcpConfigPath(agentDir), { mcpServers: { files: { command: "mcp-files" }, search: { url: "https://example.test/mcp" } } });
    probe = { probe: vi.fn(() => Promise.resolve({ state: "unreachable", message: "fetch failed", probedAt: "2026-07-01T00:00:00.000Z" } satisfies PiMcpProbe)) };

    const response = await service().test({ name: "search" });

    const tested = response.servers.find((server) => server.name === "search");
    const other = response.servers.find((server) => server.name === "files");
    expect(tested?.probe).toMatchObject({ state: "unreachable", message: "fetch failed" });
    expect(other?.probe).toEqual({ state: "unprobed" });
    expect(response.probe).toMatchObject({ state: "unreachable" });
  });

  it("reports the probe's own redacted reason on the row that was tested, and leaves the others unprobed", async () => {
    writeJson(globalMcpConfigPath(agentDir), { mcpServers: { files: { command: "mcp-files" }, search: { url: "https://example.test/mcp" } } });
    probe = { probe: vi.fn(() => Promise.resolve({ state: "needs-auth", message: "The server answered 401; sign in through pi's /mcp manager." } satisfies PiMcpProbe)) };

    const response = await service().test({ name: "files" });

    const listed = response.servers.find((entry) => entry.name === "files");
    const other = response.servers.find((entry) => entry.name === "search");
    if (listed === undefined || other === undefined) throw new Error("Expected both servers to be listed");
    expect(listed.probe).toMatchObject({ state: "needs-auth", message: "The server answered 401; sign in through pi's /mcp manager." });
    expect(other.probe).toEqual({ state: "unprobed" });
    expect(response.probe).toMatchObject({ state: "needs-auth" });
  });
});

describe("a project's override of a global server", () => {
  const globalFile = () => globalMcpConfigPath(agentDir);
  const projectFile = () => projectMcpConfigPath(projectPath);
  let projectB: string;

  beforeEach(() => {
    projectB = join(root, "project-b");
    mkdirSync(join(projectB, ".pi"), { recursive: true });
    projects = {
      requireProjectPath: (projectId: string): Promise<string> => {
        if (projectId === "p-1") return Promise.resolve(projectPath);
        if (projectId === "p-2") return Promise.resolve(projectB);
        throw new SettingsProjectError(404, `Project ${projectId} was not found`);
      },
      isProjectTrusted: () => true,
    };
  });

  it("answers an override with the global definition, the override file, and both entries it offers to write", async () => {
    writeJson(globalFile(), { mcpServers: { example: { command: "mcp-example" }, other: { command: "mcp-other" } } });
    writeJson(projectFile(), { mcpServers: { example: { enabled: false } } });

    const listed = await service().list({ projectId: "p-1" });

    const row = listed.servers.find((server) => server.name === "example");
    expect(row).toMatchObject({
      scope: "global",
      configPath: globalFile(),
      overridePath: projectFile(),
      enabled: false,
      configured: "disabled",
    });
    expect(row?.targets).toEqual([
      { kind: "definition", scope: "global", configPath: globalFile() },
      { kind: "override", scope: "project", configPath: projectFile() },
    ]);
  });

  it("disables a global server for one project, and leaves the global file, the other entries, and the next project alone", async () => {
    writeJson(globalFile(), { mcpServers: { example: { command: "mcp-example", env: { TOKEN: SECRET } }, other: { command: "mcp-other" } } });
    const globalBefore = readFileSync(globalFile(), "utf8");

    const inA = await service().setEnabled({ name: "example", target: "override", enabled: false, projectId: "p-1" });

    expect(readFileSync(globalFile(), "utf8")).toBe(globalBefore);
    expect(serversIn(projectFile())).toEqual({ example: { enabled: false } });
    expect(inA.servers.find((server) => server.name === "example")?.enabled).toBe(false);
    expect(inA.servers.find((server) => server.name === "other")).toMatchObject({ enabled: true });

    const inB = await service().list({ projectId: "p-2" });
    const inBrow = inB.servers.find((server) => server.name === "example");
    expect(inBrow).toMatchObject({ enabled: true });
    expect(inBrow).not.toHaveProperty("overridePath");
    expect(inB.servers.find((server) => server.name === "example")?.targets).toEqual([
      { kind: "definition", scope: "global", configPath: globalFile() },
      { kind: "override", scope: "project", configPath: projectMcpConfigPath(projectB) },
    ]);
  });

  it("enables a globally disabled server for one project, and the global answer and the next project stay disabled", async () => {
    writeJson(globalFile(), { mcpServers: { example: { command: "mcp-example", enabled: false } } });

    const inA = await service().setEnabled({ name: "example", target: "override", enabled: true, projectId: "p-1" });

    expect(serversIn(globalFile())["example"]).toEqual({ command: "mcp-example", enabled: false });
    expect(serversIn(projectFile())["example"]).toEqual({ enabled: true });
    expect(inA.servers.find((server) => server.name === "example")?.enabled).toBe(true);

    const inB = await service().list({ projectId: "p-2" });
    expect(inB.servers.find((server) => server.name === "example")?.enabled).toBe(false);
  });

  it("removing the override leaves the global definition in place and restores the global answer", async () => {
    writeJson(globalFile(), { mcpServers: { example: { command: "mcp-example" } } });
    writeJson(projectFile(), { mcpServers: { example: { enabled: false }, own: { command: "mcp-own" } } });

    const response = await service().remove({ name: "example", target: "override", projectId: "p-1" });

    expect(response.removed).toBe(true);
    expect(serversIn(projectFile())).toEqual({ own: { command: "mcp-own" } });
    expect(serversIn(globalFile())).toEqual({ example: { command: "mcp-example" } });
    expect(response.servers.find((server) => server.name === "example")).toMatchObject({ enabled: true, scope: "global" });
  });

  it("removing the definition takes the server out of the global file, and the project's override file is not touched", async () => {
    writeJson(globalFile(), { mcpServers: { example: { command: "mcp-example" }, other: { command: "mcp-other" } } });
    writeJson(projectFile(), { mcpServers: { example: { enabled: false } } });

    const response = await service().remove({ name: "example", target: "definition", projectId: "p-1" });

    expect(response.removed).toBe(true);
    expect(serversIn(globalFile())).toEqual({ other: { command: "mcp-other" } });
    expect(serversIn(projectFile())).toEqual({ example: { enabled: false } });
    expect(response.servers.find((server) => server.name === "example")).toBeUndefined();
  });

  it("a removal asked for as a project change on a project-defined server writes that project's file, not the global one", async () => {
    writeJson(globalFile(), { mcpServers: { example: { command: "mcp-example" } } });
    writeJson(projectFile(), { mcpServers: { own: { command: "mcp-own" } } });

    const response = await service().remove({ name: "own", target: "definition", projectId: "p-1" });

    expect(response.removed).toBe(true);
    expect(serversIn(projectFile())).toEqual({});
    expect(serversIn(globalFile())).toEqual({ example: { command: "mcp-example" } });
  });

  it("refuses to edit one project's server while a different project is the scope", async () => {
    writeJson(projectFile(), { mcpServers: { own: { command: "mcp-own" } } });

    await expect(service().setEnabled({ name: "own", target: "definition", enabled: false, projectId: "p-2" })).rejects.toBeInstanceOf(PiMcpServerErrorNotFound);
    await expect(service().remove({ name: "own", target: "definition", projectId: "p-2" })).rejects.toBeInstanceOf(PiMcpServerErrorNotFound);
    expect(existsSync(projectMcpConfigPath(projectB))).toBe(false);
    expect(serversIn(projectFile())).toEqual({ own: { command: "mcp-own" } });
  });

  it("refuses an override write with no project, and a global-scope request is never answered in a project file", async () => {
    writeJson(globalFile(), { mcpServers: { example: { command: "mcp-example" } } });

    await expect(service().setEnabled({ name: "example", target: "override", enabled: false })).rejects.toBeInstanceOf(PiMcpRequestError);
    await expect(service().setEnabled({ name: "example", target: "definition", enabled: false, projectId: "p-1", scope: "project" })).rejects.toBeInstanceOf(PiMcpRequestError);
    expect(existsSync(projectFile())).toBe(false);
  });

  it("an untrusted project is not read, and every project write and probe for it is refused", async () => {
    writeJson(globalFile(), { mcpServers: { example: { command: "mcp-example" } } });
    writeJson(projectFile(), { mcpServers: { own: { command: "mcp-own" } } });
    projects = { ...projects, isProjectTrusted: () => false };

    const listed = await service().list({ projectId: "p-1" });

    expect(listed.projectScopeRead).toBe(false);
    expect(listed.servers.find((server) => server.name === "own")).toBeUndefined();
    expect(listed.servers.find((server) => server.name === "example")?.targets).toEqual([{ kind: "definition", scope: "global", configPath: globalFile() }]);

    await expect(service().setEnabled({ name: "example", target: "override", enabled: false, projectId: "p-1" })).rejects.toThrow(/not trusted/);
    await expect(service().remove({ name: "own", target: "definition", projectId: "p-1" })).rejects.toThrow(/not trusted/);
    await expect(service().test({ name: "own", projectId: "p-1" })).rejects.toThrow(/not trusted/);
    expect(serversIn(projectFile())).toEqual({ own: { command: "mcp-own" } });
  });
});

describe("saving MCP servers", () => {
  const globalFile = () => globalMcpConfigPath(agentDir);
  const projectFile = () => projectMcpConfigPath(projectPath);

  it("writes a new server into the machine's global file, in the shape pi reads", async () => {
    const response = await service().save({ name: "files", config: { command: "npx", args: ["-y", "files-mcp"], exposure: "deferred" }, target: "definition" });

    expect(response).toMatchObject({ action: "save", name: "files", added: true, requiresReload: true });
    expect(response.servers.find((server) => server.name === "files")).toMatchObject({ scope: "global", transport: "stdio", enabled: true });
    expect(serversIn(globalFile())).toEqual({ files: { command: "npx", args: ["-y", "files-mcp"], exposure: "deferred" } });
  });

  it("names the project's own file when the request names a project, and leaves the global file alone", async () => {
    const response = await service().save({ name: "search", config: { command: "npx" }, target: "definition", projectId: "p-1" });

    expect(response.added).toBe(true);
    expect(response.projectPath).toBe(projectPath);
    expect(serversIn(projectFile())).toEqual({ search: { command: "npx" } });
    expect(existsSync(globalFile())).toBe(false);
  });

  it("refuses a config pi itself would refuse, and writes nothing", async () => {
    await expect(service().save({ name: "files", config: { url: "not-a-url" }, target: "definition" })).rejects.toThrow(/url must be an http or https URL/);
    await expect(service().save({ name: "files server", config: { command: "npx" }, target: "definition" })).rejects.toThrow(/invalid server name/);
    await expect(service().save({ name: "files", config: {}, target: "definition" })).rejects.toThrow(/needs either "command"/);
    expect(existsSync(globalFile())).toBe(false);
  });

  it("keeps what the form could not see: a secret, a command line, and the keys a prefilled field left empty", async () => {
    writeJson(globalFile(), {
      mcpServers: { files: { type: "stdio", command: "node", args: ["server.js"], env: { TOKEN: SECRET }, exposure: "deferred", timeout: 30 } },
    });

    // A prefilled edit sends the plain fields it showed and nothing else: no `args`, no `env`.
    const response = await service().save({ name: "files", config: { type: "stdio", command: "node server.mjs", enabled: true }, target: "definition" });

    expect(response).toMatchObject({ action: "save", name: "files", added: false, requiresReload: true });
    expect(serversIn(globalFile())).toEqual({
      files: { type: "stdio", command: "node server.mjs", args: ["server.js"], env: { TOKEN: SECRET }, exposure: "deferred", timeout: 30, enabled: true },
    });
  });

  it("an edit that says nothing about the enabled switch leaves a disabled server disabled", async () => {
    writeJson(globalFile(), { mcpServers: { files: { command: "node", args: ["server.js"], enabled: false } } });

    await service().save({ name: "files", config: { command: "node", cwd: "/srv/files" }, target: "definition" });

    expect(serversIn(globalFile())).toEqual({ files: { command: "node", args: ["server.js"], enabled: false, cwd: "/srv/files" } });
  });

  it("switching a server from HTTP to a command leaves the URL and its headers behind, so pi is not left connecting to what the form replaced", async () => {
    writeJson(globalFile(), { mcpServers: { search: { url: "https://mcp.example.com/mcp", headers: { Authorization: `Bearer ${SECRET}` } } } });

    await service().save({ name: "search", config: { command: "node", args: ["search.js"] }, target: "definition" });

    expect(serversIn(globalFile())).toEqual({ search: { command: "node", args: ["search.js"] } });
  });

  it("a scope that contradicts the file the write resolved to is refused, and writes nothing", async () => {
    await expect(service().save({ name: "files", config: { command: "node" }, target: "definition", scope: "global", projectId: "p-1" })).rejects.toBeInstanceOf(PiMcpRequestError);

    expect(existsSync(projectFile())).toBe(false);
    expect(existsSync(globalFile())).toBe(false);
  });

  it("keeps a header value the panel never showed, across an edit of the URL beside it", async () => {
    writeJson(globalFile(), { mcpServers: { search: { type: "http", url: "https://example.test/mcp", headers: { Authorization: `Bearer ${SECRET}` }, exposure: "deferred" } } });

    await service().save({ name: "search", config: { type: "http", url: "https://example.test/mcp", enabled: true }, target: "definition" });

    expect(serversIn(globalFile())).toEqual({
      search: { type: "http", url: "https://example.test/mcp", headers: { Authorization: `Bearer ${SECRET}` }, exposure: "deferred", enabled: true },
    });
  });

  it("replaces a secret map the person typed, key by key, over the one the file had", async () => {
    writeJson(globalFile(), { mcpServers: { files: { command: "node", env: { OLD: SECRET } } } });

    await service().save({ name: "files", config: { type: "stdio", command: "node", env: { NEW: "public-value" } }, target: "definition" });

    expect(serversIn(globalFile())).toEqual({ files: { type: "stdio", command: "node", env: { NEW: "public-value" } } });
  });

  it("an override writes only what a project may say about a global server, and never the definition", async () => {
    writeJson(globalFile(), { mcpServers: { files: { command: "node", args: ["server.js"], env: { TOKEN: SECRET } } } });

    const response = await service().save({ name: "files", config: { enabled: false, exposure: "hidden" }, target: "override", projectId: "p-1" });

    expect(response.added).toBe(true);
    expect(serversIn(projectFile())).toEqual({ files: { enabled: false, exposure: "hidden" } });
    expect(serversIn(globalFile())).toEqual({ files: { command: "node", args: ["server.js"], env: { TOKEN: SECRET } } });
    expect(response.servers.find((server) => server.name === "files")).toMatchObject({ enabled: false, exposure: "hidden", overridePath: projectFile() });
  });

  it("refuses an override of a server this project defines, because there is nothing to override", async () => {
    writeJson(projectFile(), { mcpServers: { own: { command: "mcp-own" } } });

    await expect(service().save({ name: "own", config: { enabled: false }, target: "override", projectId: "p-1" })).rejects.toThrow(/no override to write/);
    expect(serversIn(projectFile())).toEqual({ own: { command: "mcp-own" } });
  });

  it("a definition write on a global server lands in the global file, even from a project's panel", async () => {
    writeJson(globalFile(), { mcpServers: { files: { command: "node", args: ["server.js"] } } });

    const response = await service().save({ name: "files", config: { command: "node", args: ["global-server.js"] }, target: "definition", projectId: "p-1" });

    expect(response.added).toBe(false);
    expect(serversIn(globalFile())).toEqual({ files: { command: "node", args: ["global-server.js"] } });
    expect(existsSync(projectFile())).toBe(false);
    expect(response.servers.find((server) => server.name === "files")).toMatchObject({ scope: "global", configPath: globalFile() });
  });

  it("an untrusted project's save is refused and its file stays as it was", async () => {
    writeJson(projectFile(), { mcpServers: { own: { command: "mcp-own" } } });
    projects = { ...projects, isProjectTrusted: () => false };

    await expect(service().save({ name: "own", config: { command: "node" }, target: "definition", projectId: "p-1" })).rejects.toThrow(/not trusted/);
    expect(serversIn(projectFile())).toEqual({ own: { command: "mcp-own" } });
  });

  it("a name that exists only in another project's file becomes this project's own entry, and the other file stays as it was", async () => {
    const projectB = join(root, "project-b");
    mkdirSync(join(projectB, ".pi"), { recursive: true });
    writeJson(projectMcpConfigPath(projectB), { mcpServers: { own: { command: "mcp-own" } } });

    const response = await service().save({ name: "own", config: { command: "node" }, target: "definition", projectId: "p-1" });

    expect(response.added).toBe(true);
    expect(serversIn(projectFile())).toEqual({ own: { command: "node" } });
    expect(serversIn(projectMcpConfigPath(projectB))).toEqual({ own: { command: "mcp-own" } });
    expect(existsSync(globalFile())).toBe(false);
  });

  it("a mutation queue keeps two saves from writing the same file at once", async () => {
    const order: string[] = [];
    const files = fileMcpConfigPort(agentDir);
    const slowPort = {
      read: (projectPath: string | undefined, projectTrusted: boolean) => files.read(projectPath, projectTrusted),
      remove: (configPath: string, name: string) => files.remove(configPath, name),
      patch: (configPath: string, name: string, value: McpServerConfigPatch, options: { override: boolean }) => files.patch(configPath, name, value, options),
      add: (configPath: string, name: string, config: McpServerConfig) => new Promise<boolean>((resolve) => {
        order.push(name);
        setTimeout(() => {
          void files.add(configPath, name, config);
          resolve(true);
        }, 5);
      }),
    };
    const slow = new DefaultPiMcpService(slowPort, probe, projects);

    const first = slow.save({ name: "one", config: { command: "node" }, target: "definition" });
    const second = slow.save({ name: "two", config: { command: "node" }, target: "definition" });
    await Promise.all([first, second]);

    expect(order).toEqual(["one", "two"]);
    expect(serversIn(globalFile())).toEqual({ one: { command: "node" }, two: { command: "node" } });
  });
});
