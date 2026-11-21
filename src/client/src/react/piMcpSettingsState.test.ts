import { describe, expect, it } from "vitest";
import type { PiMcpListResponse, PiMcpServerInfo } from "../api";
import {
  MCP_MUTATION_DEADLINE_MS,
  idleMcpMutation,
  mcpMutationDeadlinePassed,
  mcpMutationGaveUpNotice,
  mcpMutationLocks,
  startMcpMutation,
  piMcpBusyLabel,
  piMcpConfigLocationLines,
  piMcpDiagnostics,
  piMcpEmptyNote,
  piMcpGlobalRows,
  piMcpGlobalSectionTitle,
  piMcpMetaLines,
  piMcpNotLoadedNote,
  piMcpMutationMessage,
  piMcpOverrideLine,
  piMcpProbeLabel,
  piMcpProjectRows,
  piMcpProjectSectionNote,
  piMcpProjectSectionState,
  piMcpProjectSectionTitle,
  piMcpRowTestId,
  piMcpScopeNote,
  piMcpScopeProjectName,
  piMcpScopeWriteNote,
  piMcpSecretNames,
  piMcpSecretsLine,
  piMcpSecurityLines,
  piMcpStatusLabel,
  piMcpStatusTone,
  piMcpTrustNote,
  type PiMcpProjectSectionState,
} from "./settings/piMcpSettingsState";

const globalFile = "/home/dev/.pi/agent/mcp.json";
const projectFile = "/srv/repo/mcp.json";
const overrideFile = "/srv/repo/.pi/mcp.json";

function server(overrides: Partial<PiMcpServerInfo> = {}): PiMcpServerInfo {
  return {
    name: "files",
    scope: "global",
    transport: "stdio",
    configured: "enabled",
    configPath: globalFile,
    targets: [{ kind: "definition", scope: "global", configPath: globalFile }],
    enabled: true,
    command: "npx",
    description: "Filesystem access",
    ...overrides,
  };
}

function response(overrides: Partial<PiMcpListResponse> = {}): PiMcpListResponse {
  return {
    servers: [],
    errors: [],
    globalConfigPath: globalFile,
    projectConfigPath: projectFile,
    projectPath: "/srv/repo",
    projectTrusted: true,
    projectScopeRead: true,
    ...overrides,
  };
}

describe("MCP scope rules", () => {
  it("splits a machine's rows from a project's, and keeps a package's server in the machine's list", () => {
    const rows = [
      server({}),
      server({ name: "repo", scope: "project", configPath: projectFile, targets: [{ kind: "definition", scope: "project", configPath: projectFile }] }),
      server({ name: "bundled", scope: "extension" }),
    ];
    expect(piMcpGlobalRows(rows).map(entry => entry.name)).toEqual(["files", "bundled"]);
    expect(piMcpProjectRows(rows).map(entry => entry.name)).toEqual(["repo"]);
  });

  it("ids a row by the scope and name pi answered, so two scopes listing one name are two rows", () => {
    expect(piMcpRowTestId(server({}))).toBe("mcp-row-global-files");
    expect(piMcpRowTestId(server({ scope: "project" }))).toBe("mcp-row-project-files");
  });

  it("names the scope a write goes to, and the project the page's selector chose", () => {
    const projects = [{ id: "p1", name: "repo", path: "/srv/repo", rootPath: "/srv/repo", projectDir: "/srv/repo/.pi", trusted: true }];
    expect(piMcpScopeProjectName(projects, undefined, "p1")).toBe("repo");
    expect(piMcpScopeProjectName(projects, { id: "other", name: "other" }, "missing")).toBe("");
    expect(piMcpScopeProjectName(undefined, { id: "p1", name: "repo" }, "p1")).toBe("repo");
    expect(piMcpScopeProjectName(undefined, undefined, undefined)).toBe("");
  });
});

describe("MCP rows", () => {
  it("states a row's configured state, and keeps a broken definition apart from a disabled one", () => {
    expect(piMcpStatusLabel(server({}))).toBe("enabled");
    expect(piMcpStatusLabel(server({ enabled: false }))).toBe("disabled");
    expect(piMcpStatusLabel(server({ configured: "invalid", enabled: false }))).toBe("invalid definition");
    expect(piMcpStatusTone(server({}))).toBe("on");
    expect(piMcpStatusTone(server({ enabled: false }))).toBe("off");
    expect(piMcpStatusTone(server({ configured: "invalid" }))).toBe("warning");
  });

  it("shows the entry's own fields and the file it came from", () => {
    const lines = piMcpMetaLines(server({ cwd: "/srv/data", exposure: "deferred", timeout: 30 }));
    expect(lines).toContain("Filesystem access");
    expect(lines).toContain("command: npx");
    expect(lines).toContain("cwd: /srv/data");
    expect(lines).toContain("exposure: deferred");
    expect(lines).toContain("timeout: 30s");
    expect(lines).toContain(`file: ${globalFile}`);
  });

  it("shows a URL for an HTTP server, and the secret names its headers and variables carry", () => {
    const lines = piMcpMetaLines(server({ transport: "http", url: "https://mcp.example.com/mcp", headerNames: ["Authorization"] }));
    expect(lines).toContain("url: https://mcp.example.com/mcp");
    expect(lines).toContain("secrets: Authorization — values hidden");
    const secretCommand = server({ cwd: "/srv/data" });
    delete secretCommand.command;
    expect(piMcpMetaLines(secretCommand)).toContain("command: hidden");
  });

  it("names the machine credential a server asks for, which only global config may do", () => {
    const lines = piMcpMetaLines(server({ authProvider: "pi", oauthConfigured: true }));
    expect(lines).toContain("uses the pi provider credential");
    expect(lines).toContain("OAuth configured");
  });

  it("lists secret names and never a value, and says a row uses secrets it cannot name", () => {
    expect(piMcpSecretNames(server({ headerNames: ["Authorization"], envNames: ["API_TOKEN", "BASE_URL"] })))
      .toEqual(["Authorization", "API_TOKEN", "BASE_URL"]);
    expect(piMcpSecretsLine(server({ envNames: ["API_TOKEN"] }))).toBe("secrets: API_TOKEN — values hidden");
    expect(piMcpSecretsLine(server({ usesSecrets: true }))).toBe("secrets: values hidden");
    expect(piMcpSecretsLine(server({}))).toBeUndefined();
  });

  it("names the file a project's override of a global server lives in", () => {
    expect(piMcpOverrideLine(server({ overridePath: overrideFile })))
      .toBe(`this project overrides it (${overrideFile})`);
    expect(piMcpOverrideLine(server({ overrideOnly: true, overridePath: overrideFile, scope: "project" })))
      .toBe(`overrides a global server (${overrideFile})`);
    expect(piMcpOverrideLine(server({}))).toBeUndefined();
  });

  it("explains a definition pi refused, and reports every probe state in its own words", () => {
    expect(piMcpDiagnostics(server({ configured: "invalid" }))[0]).toContain("needs either a command or a url");
    expect(piMcpDiagnostics(server({}))).toEqual([]);
    expect(piMcpDiagnostics(server({ probe: { state: "unprobed" } })).join(" ")).toContain("not tested");
    expect(piMcpDiagnostics(server({ probe: { state: "reachable", serverName: "fs", serverVersion: "1.2.0", probedAt: "20:11" } })).join(" "))
      .toContain("reachable · fs 1.2.0 · probed 20:11");
    expect(piMcpDiagnostics(server({ probe: { state: "unreachable", message: "connection refused" } })).join(" "))
      .toContain("not reachable · connection refused");
    const auth = piMcpDiagnostics(server({ probe: { state: "needs-auth" } })).join(" ");
    expect(auth).toContain("needs authentication");
    expect(auth).toContain("credential PI WEB does not have");
    expect(piMcpProbeLabel("unprobed")).toBe("not tested");
    expect(piMcpProbeLabel("reachable")).toBe("reachable");
    expect(piMcpProbeLabel("unreachable")).toBe("not reachable");
    expect(piMcpProbeLabel("needs-auth")).toBe("needs authentication");
  });
});

describe("MCP scope answers", () => {
  it("names the files an answer came from, and says when a project's file was not read", () => {
    expect(piMcpConfigLocationLines(response(), "Workstation", "repo")).toEqual([
      "Machine: Workstation",
      `Global config: ${globalFile}`,
      `Project config: ${projectFile}`,
      "Project: repo",
    ]);
    expect(piMcpConfigLocationLines(response({ projectScopeRead: false }), "Workstation")).toContain("Project config: not read");
    const noProjectFile = response();
    delete noProjectFile.projectConfigPath;
    expect(piMcpConfigLocationLines(noProjectFile, "Workstation"))
      .toContain("Project config: this project has no mcp.json yet");
  });

  it("states whether pi will load a project's servers, and stays quiet when no project was read", () => {
    expect(piMcpTrustNote(response(), "repo")).toContain("is trusted, so pi loads its MCP servers");
    expect(piMcpTrustNote(response({ projectTrusted: false }), "repo")).toContain("keeps its servers off");
    expect(piMcpTrustNote(response(), undefined)).toBeUndefined();
    expect(piMcpTrustNote(response({ projectScopeRead: false }), "repo")).toBeUndefined();
  });

  it("states the security rules the page is built on", () => {
    const lines = piMcpSecurityLines();
    expect(lines).toHaveLength(3);
    expect(lines.join(" ")).toContain("never their values");
    expect(lines.join(" ")).toContain("changes nothing in the config");
    expect(lines.join(" ")).toContain("never changes the global file");
  });

  it("says which file a write opens, by the page's scope", () => {
    expect(piMcpScopeWriteNote(undefined, "Workstation")).toContain("global config, and a write goes to that file");
    expect(piMcpScopeWriteNote("p1", "Workstation")).toContain("this project's file");
  });

  it("counts each section's rows and names the file behind it", () => {
    expect(piMcpScopeNote("global", 1, "repo", "Workstation")).toContain("1 server from Workstation's global mcp.json");
    expect(piMcpScopeNote("global", 2, "repo", "Workstation")).toContain("2 servers");
    expect(piMcpScopeNote("global", 0, "repo", "Workstation")).toContain("No global servers");
    expect(piMcpScopeNote("project", 1, "repo", "Workstation")).toContain("1 server defined by repo");
    expect(piMcpScopeNote("project", 0, "repo", "Workstation")).toContain("No project servers");
  });

  it("names the two sections so a reader always knows which scope is which", () => {
    expect(piMcpProjectSectionTitle("repo", "rows")).toBe("Project MCP servers — repo");
    expect(piMcpProjectSectionTitle("", "rows")).toBe("Project MCP servers");
    expect(piMcpProjectSectionTitle("repo", "no-project")).toBe("Project MCP servers");
    expect(piMcpGlobalSectionTitle()).toBe("Global MCP servers");
  });

  it("classifies every project-section state, and answers each with its own sentence", () => {
    const states: [PiMcpProjectSectionState, Parameters<typeof piMcpProjectSectionState>[0], PiMcpProjectSectionState][] = [
      ["no-project", { projectId: undefined, response: response(), rowCount: 0 }, "no-project"],
      ["unread", { projectId: undefined, response: undefined, rowCount: 0 }, "no-project"],
      ["not-read", { projectId: "p1", response: response({ projectScopeRead: false }), rowCount: 0 }, "not-read"],
      ["empty", { projectId: "p1", response: response(), rowCount: 0 }, "empty"],
      ["rows", { projectId: "p1", response: response(), rowCount: 2 }, "rows"],
    ];
    for (const [, input, expected] of states) {
      expect(piMcpProjectSectionState(input)).toBe(expected);
    }
    expect(piMcpProjectSectionState({ projectId: "p1", response: undefined, rowCount: 0 })).toBe("unread");

    expect(piMcpProjectSectionNote("no-project", "repo", "Workstation")).toContain("global config only");
    expect(piMcpProjectSectionNote("not-read", "repo", "Workstation")).toContain("is not an empty file");
    expect(piMcpProjectSectionNote("unread", "repo", "Workstation")).toContain("Choose the project to read");
    expect(piMcpProjectSectionNote("empty", "repo", "Workstation")).toContain("repo defines no MCP servers");
    expect(piMcpProjectSectionNote("empty", "", "Workstation")).toContain("The selected project defines no MCP servers");
    expect(piMcpProjectSectionNote("rows", "repo", "Workstation")).toContain("repo's servers");
  });

  it("answers an empty section with the file that is empty", () => {
    expect(piMcpEmptyNote("global")).toBe("No MCP servers in the machine's global file.");
    expect(piMcpEmptyNote("project", "repo")).toContain("this project's file (repo)");
  });

  it("names the work in flight and what a finished write did to a running session", () => {
    expect(piMcpBusyLabel("reload")).toBe("Loading the servers pi configured");
    expect(piMcpBusyLabel("save", server({}))).toBe("Saving “files”");
    expect(piMcpBusyLabel("test")).toBe("Testing the servers");
    expect(piMcpMutationMessage("test", server({ probe: { state: "reachable" } }))).toContain("Tested “files”: reachable");
    expect(piMcpMutationMessage("test", server({}))).toContain("no answer");
    expect(piMcpMutationMessage("remove", server({}))).toContain(`“files” is gone from ${globalFile}`);
    expect(piMcpMutationMessage("remove", server({}))).toContain("until it reloads");
    expect(piMcpMutationMessage("enable", server({}), false)).toContain("is disabled");
    expect(piMcpMutationMessage("save", server({}))).toContain("is saved in");
  });
});

describe("MCP list presence", () => {
  it("names the unread list as unread, not as empty", () => {
    expect(piMcpNotLoadedNote()).toContain("not been read");
    expect(piMcpEmptyNote("global", "Site")).not.toContain("not been read");
  });
});

/**
 * A mutation gets a bound, and the page tells the truth at the bound.
 *
 * The MCP page locks its controls while a mutation runs, so a machine that stops answering used to keep
 * the page locked forever. The bound is the page's, not the machine's: a test that answers is untouched,
 * a test that does not is reported as an answer that never came, and a write says what it may have done.
 */
describe("MCP mutation bound", () => {
  const now = 1_000_000;

  it("runs a mutation against one named bound", () => {
    const running = startMcpMutation("test", "Testing “files”", now);
    expect(running.deadlineAt).toBe(now + MCP_MUTATION_DEADLINE_MS);
    expect(mcpMutationLocks(running)).toBe(true);
    expect(mcpMutationDeadlinePassed(running, now + MCP_MUTATION_DEADLINE_MS - 1)).toBe(false);
    expect(mcpMutationDeadlinePassed(running, now + MCP_MUTATION_DEADLINE_MS)).toBe(true);
  });

  it("unlocks the page when the mutation is over", () => {
    expect(mcpMutationLocks(idleMcpMutation())).toBe(false);
    expect(mcpMutationLocks({ kind: "gaveUp", action: "test", label: "Testing “files”", waitedMs: MCP_MUTATION_DEADLINE_MS })).toBe(false);
    expect(mcpMutationDeadlinePassed(idleMcpMutation(), now + MCP_MUTATION_DEADLINE_MS * 2)).toBe(false);
  });

  it("says a connection test changed nothing and names the retry", () => {
    const notice = mcpMutationGaveUpNotice({ kind: "gaveUp", action: "test", label: "Testing “files”", waitedMs: MCP_MUTATION_DEADLINE_MS });
    expect(notice).toContain("Testing “files” did not answer within 20 seconds");
    expect(notice).toContain("A connection test changes nothing");
    expect(notice).toContain("Press Test connection again");
  });

  it("says a write may have landed and points at the reload", () => {
    const save = mcpMutationGaveUpNotice({ kind: "gaveUp", action: "save", label: "Saving “files”", waitedMs: MCP_MUTATION_DEADLINE_MS });
    expect(save).toContain("Saving “files” did not answer within 20 seconds");
    expect(save).toContain("may have saved the entry");
    expect(save).toContain("Reload reads the config files again");
    expect(save).not.toContain("A connection test changes nothing");
    expect(mcpMutationGaveUpNotice({ kind: "gaveUp", action: "remove", label: "Removing “files”", waitedMs: MCP_MUTATION_DEADLINE_MS })).toContain("may have removed the entry");
    expect(mcpMutationGaveUpNotice({ kind: "gaveUp", action: "enable", label: "Updating “files”", waitedMs: MCP_MUTATION_DEADLINE_MS })).toContain("may have changed the entry");
  });
});
