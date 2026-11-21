import { describe, expect, it } from "vitest";
import type { PiMcpServerInfo, PiMcpWriteTarget } from "../api";
import {
  emptyMcpForm,
  mcpDraftFromForm,
  mcpFormFromServer,
  mcpFormProblem,
  mcpSaveRequestFromForm,
  parseArgumentLine,
  parseEnvLines,
  parseHeaderLines,
  secretNamesLine,
  type McpFormState,
} from "./mcpForm";

function server(overrides: Partial<PiMcpServerInfo> = {}): PiMcpServerInfo {
  return {
    name: "files",
    scope: "global",
    transport: "stdio",
    configured: "enabled",
    configPath: "/home/dev/.pi/agent/mcp.json",
    targets: [{ kind: "definition", scope: "global", configPath: "/home/dev/.pi/agent/mcp.json" }],
    enabled: true,
    ...overrides,
  };
}

function form(overrides: Partial<McpFormState> = {}): McpFormState {
  return { ...emptyMcpForm(), name: "search", ...overrides };
}

const globalTarget: PiMcpWriteTarget = { kind: "definition", scope: "global", configPath: "/home/dev/.pi/agent/mcp.json" };
const projectDefinitionTarget: PiMcpWriteTarget = { kind: "definition", scope: "project", configPath: "/work/repo/.pi/mcp.json" };
const projectOverrideTarget: PiMcpWriteTarget = { kind: "override", scope: "project", configPath: "/work/repo/.pi/mcp.json" };

describe("MCP form parsing", () => {
  it("starts a new server on the stdio transport, enabled, aimed at the global definition", () => {
    expect(emptyMcpForm()).toMatchObject({
      name: "", editing: false, target: "definition", projectScope: false, transport: "stdio",
      command: "", args: "", cwd: "", url: "", env: "", headers: "", timeout: "", exposure: "", enabled: true,
      existingEnvNames: [], existingHeaderNames: [],
    });
  });

  it("splits a command line into arguments the way a shell would", () => {
    expect(parseArgumentLine("-y @scope/pkg --root '/srv/a b'")).toEqual(["-y", "@scope/pkg", "--root", "/srv/a b"]);
    expect(parseArgumentLine("")).toEqual([]);
    expect(parseArgumentLine('"a b" "c d"')).toEqual(["a b", "c d"]);
  });

  it("splits NAME=value and Name: value lines, and drops the lines that have no separator", () => {
    expect(parseEnvLines("A=1\nB = two\nnovalue\n")).toEqual({ A: "1", B: "two" });
    expect(parseHeaderLines("Authorization: Bearer x\nX-Trace: t\nnovalue")).toEqual({ Authorization: "Bearer x", "X-Trace": "t" });
    expect(parseEnvLines("=empty-key")).toEqual({});
  });

  it("shows the secret names a saved map would look like", () => {
    expect(secretNamesLine(["Authorization", "API_TOKEN"])).toBe("Authorization, API_TOKEN");
    expect(secretNamesLine([])).toBe("");
  });
});

describe("MCP draft construction", () => {
  it("sends a stdio server as pi reads it, with the fields the form was given", () => {
    expect(mcpDraftFromForm(form({ command: "npx", args: "-y files-mcp", cwd: "/srv/data", env: "A=1\nB=2" }))).toEqual({
      enabled: true, type: "stdio", command: "npx", args: ["-y", "files-mcp"], cwd: "/srv/data", env: { A: "1", B: "2" },
    });
  });

  it("sends an HTTP server with its URL and headers", () => {
    expect(mcpDraftFromForm(form({ transport: "http", url: "https://mcp.example.com/mcp", headers: "Authorization: Bearer x" }))).toEqual({
      enabled: true, type: "http", url: "https://mcp.example.com/mcp", headers: { Authorization: "Bearer x" },
    });
  });

  it("leaves out what the person did not type, so the machine keeps what the file had", () => {
    const draft = mcpDraftFromForm(form({ transport: "http", url: "https://mcp.example.com/mcp" }));
    expect(draft).toEqual({ enabled: true, type: "http", url: "https://mcp.example.com/mcp" });
    expect("headers" in draft).toBe(false);
    expect("env" in draft).toBe(false);
    expect("timeout" in draft).toBe(false);
    expect("exposure" in draft).toBe(false);
  });

  it("sends timeout and exposure only when they were chosen", () => {
    expect(mcpDraftFromForm(form({ transport: "http", url: "https://a.example.com", timeout: "30", exposure: "direct" }))).toMatchObject({ timeout: 30, exposure: "direct" });
  });

  it("sends the disabled state when the switch is off", () => {
    expect(mcpDraftFromForm(form({ command: "npx", enabled: false }))).toMatchObject({ enabled: false });
  });
});

describe("MCP form validation", () => {
  it("refuses to send a server with no name, a name pi would not take, or no transport target", () => {
    expect(mcpFormProblem(form({ name: "  ", command: "npx" }))).toContain("name");
    expect(mcpFormProblem(form({ name: "files server", command: "npx" }))).toBeDefined();
    expect(mcpFormProblem(form({ command: "" }))).toContain("command");
    expect(mcpFormProblem(form({ transport: "http", url: "" }))).toContain("URL");
    expect(mcpFormProblem(form({ transport: "http", url: "mcp.example.com" }))).toContain("http://");
    expect(mcpFormProblem(form({ command: "npx", timeout: "0" }))).toContain("timeout");
    expect(mcpFormProblem(form({ command: "npx" }))).toBeUndefined();
  });
});

describe("MCP save request", () => {
  it("aims a global write at the machine's file and names no project", () => {
    expect(mcpSaveRequestFromForm(form({ command: "npx" }), "p-1")).toEqual({
      name: "search", config: { enabled: true, type: "stdio", command: "npx" }, target: "definition",
    });
  });

  it("names the project for a project file and for a project override", () => {
    expect(mcpSaveRequestFromForm(form({ command: "npx", projectScope: true }), "p-1")).toMatchObject({ target: "definition", projectId: "p-1" });
    expect(mcpSaveRequestFromForm(form({ command: "npx", target: "override", projectScope: true }), "p-1")).toMatchObject({ target: "override", projectId: "p-1" });
    expect(mcpSaveRequestFromForm(form({ command: "npx", projectScope: true }), undefined)).not.toHaveProperty("projectId");
  });
});

describe("MCP form prefill", () => {
  it("prefills an existing stdio server without inventing secret values", () => {
    const prefilled = mcpFormFromServer(server({ command: "npx", cwd: "/srv/data", envNames: ["API_TOKEN"], exposure: "direct", timeout: 45, enabled: false }), globalTarget);
    expect(prefilled).toMatchObject({
      name: "files", editing: true, target: "definition", projectScope: false, transport: "stdio",
      command: "npx", cwd: "/srv/data", exposure: "direct", timeout: "45", enabled: false, existingEnvNames: ["API_TOKEN"],
    });
    expect(prefilled.env).toBe("");
  });

  it("prefills an HTTP server's URL and leaves its header values out", () => {
    const prefilled = mcpFormFromServer(server({ transport: "http", url: "https://mcp.example.com/mcp", headerNames: ["Authorization"], oauthConfigured: true }), globalTarget);
    expect(prefilled.transport).toBe("http");
    expect(prefilled.url).toBe("https://mcp.example.com/mcp");
    expect(prefilled.headers).toBe("");
    expect(prefilled.existingHeaderNames).toEqual(["Authorization"]);
  });

  it("prefills a project override aimed at the override entry", () => {
    const override = server({ scope: "global", overridePath: "/repo/.pi/mcp.json", targets: [
      { kind: "definition", scope: "global", configPath: "/home/dev/.pi/agent/mcp.json" },
      { kind: "override", scope: "project", configPath: "/repo/.pi/mcp.json" },
    ] });
    expect(mcpFormFromServer(override, projectOverrideTarget)).toMatchObject({ target: "override", projectScope: true, editing: true });
  });

  it("round-trips a prefilled row: the plain fields repeat, the hidden ones stay out, and the server stays enabled", () => {
    const prefilled = mcpFormFromServer(server({ command: "npx", cwd: "/srv/data", envNames: ["API_TOKEN"], exposure: "deferred", timeout: 12 }), globalTarget);
    // The row carries no arguments and no secret values, so a save that leaves those fields empty sends
    // neither key and the machine keeps what the file had for both.
    expect(mcpDraftFromForm(prefilled)).toEqual({
      enabled: true, type: "stdio", command: "npx", cwd: "/srv/data", exposure: "deferred", timeout: 12,
    });
  });

  it("prefills an override-only row as enabled and aimed at the project's override", () => {
    const prefilled = mcpFormFromServer(server({ scope: "project", overrideOnly: true, enabled: false, exposure: "hidden" }), projectOverrideTarget);
    expect(prefilled).toMatchObject({ transport: "stdio", command: "", enabled: false, exposure: "hidden", target: "override", projectScope: true });
  });

  it("aims a project-defined row's edit at the project, so the save cannot land on the global file", () => {
    const prefilled = mcpFormFromServer(
      server({ scope: "project", configPath: "/work/repo/.pi/mcp.json", targets: [projectDefinitionTarget], command: "node" }),
      projectDefinitionTarget,
    );
    expect(prefilled).toMatchObject({ target: "definition", projectScope: true });
    expect(mcpSaveRequestFromForm(prefilled, "p-1")).toMatchObject({ name: "files", target: "definition", projectId: "p-1" });
  });

  it("writes an override with only the keys an override may set", () => {
    expect(mcpDraftFromForm(form({ target: "override", projectScope: true, command: "npx", url: "https://a.example.com", transport: "http", timeout: "30", exposure: "hidden" }))).toEqual({ enabled: true, exposure: "hidden" });
    expect(mcpFormProblem(form({ target: "override", projectScope: true, command: "", transport: "stdio" }))).toBeUndefined();
  });

  it("carries a description into a definition, and leaves the key out when the field is blank", () => {
    expect(mcpDraftFromForm(form({ command: "node", description: "  Reads the issue tracker  " }))).toMatchObject({ description: "Reads the issue tracker" });
    expect(mcpDraftFromForm(form({ command: "node", description: "   " })).description).toBeUndefined();
  });

  it("prefills the description the file already has, so an edit does not drop it", () => {
    expect(mcpFormFromServer(server({ description: "Fixture stdio server" }), globalTarget)).toMatchObject({ description: "Fixture stdio server" });
    expect(mcpSaveRequestFromForm(mcpFormFromServer(server({ description: "Fixture stdio server" }), globalTarget), undefined)).toMatchObject({ config: { description: "Fixture stdio server" } });
  });
});
