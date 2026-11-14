import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isRecord } from "../../shared/unknownValues.js";
import type { PiMcpProbe } from "../../shared/apiTypes.js";
import { globalMcpConfigPath, projectMcpConfigPath } from "../shared/resources/mcpConfig.js";
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

    await expect(service().test({ name: "project-server", scope: "project", projectId: "p-1" })).rejects.toThrow("not trusted");
    await expect(service().setEnabled({ name: "project-server", scope: "project", projectId: "p-1", enabled: true })).rejects.toThrow("not trusted");
    await expect(service().remove({ name: "project-server", scope: "project", projectId: "p-1" })).rejects.toThrow("not trusted");

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

    await expect(service().setEnabled({ name: "files", scope: "global", enabled: false })).rejects.toThrow(/not valid JSON|No MCP server/);

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
    const response = await service().setEnabled({ name: "files", scope: "global", enabled: false });

    expect(serversIn(globalMcpConfigPath(agentDir))["files"]).toEqual({ command: "mcp-files", env: { TOKEN: SECRET }, enabled: false });
    expect(response).toMatchObject({ action: "set-enabled", name: "files", enabled: false, requiresReload: true });
    expect(response.servers.find((entry) => entry.name === "files")?.enabled).toBe(false);
  });

  it("turns it back on by removing the key, which is pi's default", async () => {
    await service().setEnabled({ name: "files", scope: "global", enabled: false });
    const response = await service().setEnabled({ name: "files", scope: "global", enabled: true });

    expect(serversIn(globalMcpConfigPath(agentDir))["files"]).toEqual({ command: "mcp-files", env: { TOKEN: SECRET } });
    expect(response.servers.find((entry) => entry.name === "files")?.enabled).toBe(true);
  });

  it("turns a global server off for one project by writing that project's override, never the global file", async () => {
    const globalBefore = readFileSync(globalMcpConfigPath(agentDir), "utf8");

    const response = await service().setEnabled({ name: "files", scope: "project", projectId: "p-1", enabled: false });

    expect(readFileSync(globalMcpConfigPath(agentDir), "utf8")).toBe(globalBefore);
    expect(serversIn(projectMcpConfigPath(projectPath))["files"]).toEqual({ enabled: false });
    expect(response.servers.find((entry) => entry.name === "files")).toMatchObject({ enabled: false, overridePath: projectMcpConfigPath(projectPath) });
  });

  it("refuses to write a global change for a server only the project defines", async () => {
    writeJson(projectMcpConfigPath(projectPath), { mcpServers: { local: { command: "mcp-local" } } });

    await expect(service().setEnabled({ name: "local", scope: "global", enabled: false, projectId: "p-1" })).rejects.toBeInstanceOf(PiMcpRequestError);
    expect(serversIn(globalMcpConfigPath(agentDir))).toEqual({ files: { command: "mcp-files", env: { TOKEN: SECRET } } });
  });

  it("removes a server from the file that defines it, and restores the global server when that file was an override", async () => {
    writeJson(projectMcpConfigPath(projectPath), { mcpServers: { files: { enabled: false } } });

    const response = await service().remove({ name: "files", scope: "project", projectId: "p-1" });

    expect(serversIn(projectMcpConfigPath(projectPath))).toEqual({});
    expect(response.removed).toBe(true);
    expect(response.requiresReload).toBe(true);
    const restored = response.servers.find((entry) => entry.name === "files");
    expect(restored?.enabled).toBe(true);
    expect(restored).not.toHaveProperty("overridePath");
  });

  it("says a removal did nothing when the file the named scope owns has no such server", async () => {
    const response = await service().remove({ name: "files", scope: "project", projectId: "p-1" });

    expect(response.removed).toBe(false);
    expect(serversIn(globalMcpConfigPath(agentDir))).toHaveProperty("files");
    expect(existsSync(projectMcpConfigPath(projectPath))).toBe(false);
  });

  it("answers a server that is not configured with a 404-shaped problem", async () => {
    await expect(service().setEnabled({ name: "gone", scope: "global", enabled: false })).rejects.toBeInstanceOf(PiMcpServerErrorNotFound);
  });

  it("refuses to edit a server an extension registered, which pi owns", async () => {
    await expect(service().setEnabled({ name: "files", scope: "extension", enabled: false })).rejects.toBeInstanceOf(PiMcpRequestError);
    await expect(service().remove({ name: "files", scope: "extension" })).rejects.toBeInstanceOf(PiMcpRequestError);
  });
});

describe("testing a connection", () => {
  it("probes the server pi would connect, and writes nothing", async () => {
    writeJson(globalMcpConfigPath(agentDir), { mcpServers: { files: { command: "mcp-files", timeout: 4 } } });
    const before = readFileSync(globalMcpConfigPath(agentDir), "utf8");

    const response = await service().test({ name: "files", scope: "global" });

    expect(probe.probe).toHaveBeenCalledWith("files", { command: "mcp-files", timeout: 4 }, process.cwd(), 4);
    expect(readFileSync(globalMcpConfigPath(agentDir), "utf8")).toBe(before);
    expect(response).toMatchObject({ action: "test", name: "files", requiresReload: false, probe: { state: "reachable", serverName: "files-server" } });
  });

  it("probes a project server in the project's own directory", async () => {
    writeJson(projectMcpConfigPath(projectPath), { mcpServers: { local: { command: "mcp-local" } } });

    await service().test({ name: "local", scope: "project", projectId: "p-1" });

    expect(probe.probe).toHaveBeenCalledWith("local", { command: "mcp-local" }, projectPath, undefined);
  });

  it("answers a probe of a server that is not configured with a 404-shaped problem", async () => {
    await expect(service().test({ name: "gone", scope: "global" })).rejects.toBeInstanceOf(PiMcpServerErrorNotFound);
    expect(probe.probe).not.toHaveBeenCalled();
  });

  it("puts the probe's answer on the row the reader tested, not only at the top of the answer", async () => {
    writeJson(globalMcpConfigPath(agentDir), { mcpServers: { files: { command: "mcp-files" }, search: { url: "https://example.test/mcp" } } });
    probe = { probe: vi.fn(() => Promise.resolve({ state: "unreachable", message: "fetch failed", probedAt: "2026-07-01T00:00:00.000Z" } satisfies PiMcpProbe)) };

    const response = await service().test({ name: "search", scope: "global" });

    const tested = response.servers.find((server) => server.name === "search");
    const other = response.servers.find((server) => server.name === "files");
    expect(tested?.probe).toMatchObject({ state: "unreachable", message: "fetch failed" });
    expect(other?.probe).toEqual({ state: "unprobed" });
    expect(response.probe).toMatchObject({ state: "unreachable" });
  });

  it("reports the probe's own redacted reason on the row that was tested, and leaves the others unprobed", async () => {
    writeJson(globalMcpConfigPath(agentDir), { mcpServers: { files: { command: "mcp-files" }, search: { url: "https://example.test/mcp" } } });
    probe = { probe: vi.fn(() => Promise.resolve({ state: "needs-auth", message: "The server answered 401; sign in through pi's /mcp manager." } satisfies PiMcpProbe)) };

    const response = await service().test({ name: "files", scope: "global" });

    const listed = response.servers.find((entry) => entry.name === "files");
    const other = response.servers.find((entry) => entry.name === "search");
    if (listed === undefined || other === undefined) throw new Error("Expected both servers to be listed");
    expect(listed.probe).toMatchObject({ state: "needs-auth", message: "The server answered 401; sign in through pi's /mcp manager." });
    expect(other.probe).toEqual({ state: "unprobed" });
    expect(response.probe).toMatchObject({ state: "needs-auth" });
  });
});
