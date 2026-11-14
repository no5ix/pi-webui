// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { PiMcpListResponse, PiMcpScope, PiMcpServerInfo, PiMcpWriteTarget, Project } from "../../api";
import { SettingsMcpPanel } from "./SettingsMcpPanel";
import type { SettingsMachineTarget } from "./settingsMachineTarget";

/**
 * The MCP panel's contract with the reader.
 *
 * Three promises the panel must keep, whatever the server sends:
 * - a configured server is shown whether it is on or off, because a server that is off is
 *   configured, not absent;
 * - a value the configuration keeps secret is never rendered, only its name;
 * - "configured" and "reachable" are separate lines, because turning a server on is not the same
 *   as proving it answers.
 */

const SECRET = "a-secret-value-that-must-never-render";
const remoteTarget: SettingsMachineTarget = { id: "lab-mac", name: "Lab Mac", kind: "remote" };

afterEach(() => {
  document.body.replaceChildren();
});

/**
 * A row as the service sends one.
 *
 * `targets` is what the machine offers to write, so the fixture derives it from the files the row
 * names - the same rule the server follows - and a test that wants a row without a target says so.
 */
function server(name: string, overrides: Partial<PiMcpServerInfo> = {}): PiMcpServerInfo {
  const row: PiMcpServerInfo = {
    name,
    scope: "global",
    transport: "stdio",
    configured: "enabled",
    configPath: "/pi/mcp.json",
    targets: [{ kind: "definition", scope: "global", configPath: "/pi/mcp.json" }],
    enabled: true,
    command: "mcp-files",
    envNames: ["FILES_TOKEN"],
    usesSecrets: true,
    probe: { state: "unprobed" },
    ...overrides,
  };
  return { ...row, targets: overrides.targets ?? writeTargetsFor(row.scope, row.configPath, row.overridePath) };
}

function writeTargetsFor(scope: PiMcpScope, configPath: string, overridePath: string | undefined): PiMcpWriteTarget[] {
  if (scope === "extension") return [];
  const definition: PiMcpWriteTarget = { kind: "definition", scope, configPath };
  return overridePath === undefined ? [definition] : [definition, { kind: "override", scope: "project", configPath: overridePath }];
}

const project: Project = { id: "p-1", name: "Work", path: "/work/project", createdAt: "2026-01-01T00:00:00.000Z" };

function response(servers: PiMcpServerInfo[], overrides: Partial<PiMcpListResponse> = {}): PiMcpListResponse {
  return {
    servers,
    errors: [],
    globalConfigPath: "/pi/mcp.json",
    projectTrusted: false,
    projectScopeRead: false,
    ...overrides,
  };
}

async function mount(configure: (panel: SettingsMcpPanel) => void = () => undefined): Promise<SettingsMcpPanel> {
  const panel = new SettingsMcpPanel();
  configure(panel);
  document.body.append(panel);
  await panel.updateComplete;
  return panel;
}

function panelText(panel: SettingsMcpPanel): string {
  const parts: string[] = [];
  visit(panel.shadowRoot);
  return parts.join(" ");

  function visit(root: ShadowRoot | null): void {
    if (root === null) return;
    parts.push(root.textContent);
    for (const child of Array.from(root.querySelectorAll<HTMLElement>("*"))) visit(child.shadowRoot);
  }
}

function cards(panel: SettingsMcpPanel): Element[] {
  return Array.from(panel.shadowRoot?.querySelectorAll(".server-card") ?? []);
}

function switches(panel: SettingsMcpPanel): HTMLInputElement[] {
  return Array.from(panel.shadowRoot?.querySelectorAll<HTMLInputElement>(".toggle input") ?? []);
}

function buttons(root: Element | ShadowRoot | null, label: string): HTMLButtonElement[] {
  if (root === null) return [];
  return Array.from(root.querySelectorAll<HTMLButtonElement>("button")).filter((button) => button.textContent.trim() === label);
}

function firstSwitch(panel: SettingsMcpPanel): HTMLInputElement {
  const input = switches(panel)[0];
  if (input === undefined) throw new Error("Expected the panel to offer a switch on the server row");
  return input;
}

function projectSelect(panel: SettingsMcpPanel): HTMLSelectElement {
  const select = panel.shadowRoot?.querySelector<HTMLSelectElement>("select#mcp-project") ?? null;
  if (select === null) throw new Error("Expected the panel to offer the project scope");
  return select;
}

function flip(input: HTMLInputElement, checked: boolean): void {
  input.checked = checked;
  input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
}

describe("settings-mcp-panel", () => {
  it("shows project MCP servers above global servers when a project is selected", async () => {
    const panel = await mount((element) => {
      element.mcpResponse = response([
        server("global-files"),
        server("project-search", { scope: "project", configPath: "/work/project/.pi/mcp.json" }),
      ], { projectPath: "/work/project", projectConfigPath: "/work/project/.pi/mcp.json", projectTrusted: true, projectScopeRead: true });
      element.projects = [project];
      element.projectSelection = "p-1";
    });
    const text = panelText(panel);
    expect(text.indexOf("Project MCP servers")).toBeLessThan(text.indexOf("Global MCP servers"));
    expect(text.indexOf("project-search")).toBeLessThan(text.indexOf("global-files"));
  });

  it("shows a server pi has, on and off, with the file the answer came from", async () => {
    const panel = await mount((element) => {
      element.mcpResponse = response([
        server("files"),
        server("search", { transport: "http", url: "https://example.test/mcp", headerNames: ["Authorization"], enabled: false, configured: "disabled" }),
      ]);
    });

    const text = panelText(panel);
    expect(cards(panel)).toHaveLength(2);
    expect(text).toContain("files");
    expect(text).toContain("search");
    expect(text).toContain("Global config:");
    expect(text).toContain("/pi/mcp.json");
    expect(text).toContain("Config file:");
    expect(text).toContain("stdio command");
    expect(text).toContain("HTTP");
    expect(text).toContain("Off");
  });

  it("names the secrets a config carries and renders none of their values", async () => {
    const panel = await mount((element) => {
      element.mcpResponse = response([
        server("files", { envNames: ["FILES_TOKEN", "FILES_SECRET"] }),
        server("search", { transport: "http", url: "https://example.test/mcp", headerNames: ["Authorization"] }),
      ]);
    });

    const text = panelText(panel);
    expect(text).toContain("FILES_TOKEN");
    expect(text).toContain("Authorization");
    expect(text).toContain("never");
    expect(text).not.toContain(SECRET);
  });

  it("keeps configuration and connection two separate statements", async () => {
    const panel = await mount((element) => {
      element.mcpResponse = response([
        server("files", { probe: { state: "reachable", serverName: "files-server", serverVersion: "1.4.0" } }),
        server("search", { enabled: false, configured: "disabled", probe: { state: "needs-auth", message: "The server answered 401; sign in through pi's /mcp manager." } }),
        server("idle"),
      ]);
    });

    const text = panelText(panel);
    const cardsByText = cards(panel).map((card) => card.textContent);
    expect(cardsByText.some((entry) => entry.includes("Reachable - files-server 1.4.0"))).toBe(true);
    expect(cardsByText.some((entry) => entry.includes("Unprobed - no probe has been run for this server."))).toBe(true);
    expect(text).toContain("Reachable");
    expect(text).toContain("Needs sign-in");
    expect(text).toContain("files-server 1.4.0");
    expect(text).toContain("401");
    expect(text).toContain("no probe has been run");
  });

  it("says when the project scope was not read, instead of showing an empty list as the truth", async () => {
    const loaded = await mount((element) => {
      element.mcpResponse = response([], { projectPath: "/work/project", projectTrusted: false, projectScopeRead: false });
    });
    expect(panelText(loaded)).toContain("not read");

    const unread = await mount((element) => {
      element.targetMachine = remoteTarget;
    });
    expect(panelText(unread)).toContain("not loaded");

    const refreshing = await mount((element) => {
      element.mcpResponse = response([]);
      element.loading = true;
    });
    expect(panelText(refreshing)).toContain("Refreshing");
  });

  it("carries a config file pi refused to read as an error, not as an empty list", async () => {
    const panel = await mount((element) => {
      element.mcpResponse = response([], { errors: ["/pi/mcp.json: Expected an object with an \"mcpServers\" object"] });
    });

    const text = panelText(panel);
    expect(text).toContain("MCP config error");
    expect(text).toContain("mcpServers");
    expect(text).toContain("this list is not known");
    expect(text).not.toContain("No MCP server is configured on");
  });

  it("says no server is configured only when every config file was read", async () => {
    const panel = await mount((element) => {
      element.mcpResponse = response([]);
    });

    const text = panelText(panel);
    expect(text).toContain("No MCP server is configured on");
    expect(text).not.toContain("not known");
  });

  it("writes the project's override, and names it, when a project is the scope being managed", async () => {
    const targets: PiMcpWriteTarget[] = [];
    const panel = await mount((element) => {
      element.mcpResponse = response([server("files", { overridePath: "/work/project/.pi/mcp.json", targets: [{ kind: "definition", scope: "global", configPath: "/pi/mcp.json" }, { kind: "override", scope: "project", configPath: "/work/project/.pi/mcp.json" }] })], { projectPath: "/work/project", projectConfigPath: "/work/project/.pi/mcp.json", projectTrusted: true, projectScopeRead: true });
      element.projects = [project];
      element.projectSelection = "p-1";
      element.onToggleServer = (_server: PiMcpServerInfo, target: PiMcpWriteTarget) => { targets.push(target); };
    });

    flip(firstSwitch(panel), false);
    await panel.updateComplete;

    expect(targets).toEqual([{ kind: "override", scope: "project", configPath: "/work/project/.pi/mcp.json" }]);
    const text = panelText(panel);
    expect(text).toContain("Overridden for this project: /work/project/.pi/mcp.json");
    expect(text).toContain("This switch writes the project's override in /work/project/.pi/mcp.json.");
  });

  it("writes the global definition when no project is the scope, and says so on the row", async () => {
    const targets: PiMcpWriteTarget[] = [];
    const panel = await mount((element) => {
      element.mcpResponse = response([server("files")]);
      element.projects = [project];
      element.onToggleServer = (_server: PiMcpServerInfo, target: PiMcpWriteTarget) => { targets.push(target); };
    });

    flip(firstSwitch(panel), false);
    await panel.updateComplete;

    expect(targets).toEqual([{ kind: "definition", scope: "global", configPath: "/pi/mcp.json" }]);
    expect(panelText(panel)).toContain("This switch writes the global definition in /pi/mcp.json.");
  });

  it("offers the override's removal and the definition's removal as two acts, each naming the file it opens", async () => {
    const removed: PiMcpWriteTarget[] = [];
    const panel = await mount((element) => {
      element.mcpResponse = response([server("files", { overridePath: "/work/project/.pi/mcp.json", targets: [{ kind: "definition", scope: "global", configPath: "/pi/mcp.json" }, { kind: "override", scope: "project", configPath: "/work/project/.pi/mcp.json" }] })], { projectPath: "/work/project", projectConfigPath: "/work/project/.pi/mcp.json", projectTrusted: true, projectScopeRead: true });
      element.projects = [project];
      element.projectSelection = "p-1";
      element.onRemoveServer = (_server: PiMcpServerInfo, target: PiMcpWriteTarget) => { removed.push(target); };
    });

    const removalButtons = buttons(panel.shadowRoot, "Remove project override").concat(buttons(panel.shadowRoot, "Remove definition"));
    expect(removalButtons.map((button) => (button.textContent || "").trim())).toEqual(["Remove project override", "Remove definition"]);

    buttons(panel.shadowRoot, "Remove project override")[0]?.click();
    await panel.updateComplete;
    const armed = panelText(panel);
    expect(armed).toContain("Remove the project override of files from /work/project/.pi/mcp.json?");

    buttons(panel.shadowRoot, "Confirm remove")[0]?.click();
    await panel.updateComplete;
    expect(removed).toEqual([{ kind: "override", scope: "project", configPath: "/work/project/.pi/mcp.json" }]);
  });

  it("offers only the definition's removal for a global server with no project override", async () => {
    const panel = await mount((element) => {
      element.mcpResponse = response([server("files", { targets: [{ kind: "definition", scope: "global", configPath: "/pi/mcp.json" }, { kind: "override", scope: "project", configPath: "/work/project/.pi/mcp.json" }] })], { projectPath: "/work/project", projectConfigPath: "/work/project/.pi/mcp.json", projectTrusted: true, projectScopeRead: true });
      element.projects = [project];
      element.projectSelection = "p-1";
    });

    const labels = Array.from(panel.shadowRoot?.querySelectorAll("button") ?? []).filter((button) => (button.textContent || "").startsWith("Remove")).map((button) => (button.textContent || "").trim());
    expect(labels).toEqual(["Remove definition"]);
    expect(panelText(panel)).toContain("No project override: this project follows the global answer");
  });

  it("offers the projects this machine has, with no project as a real choice, and the machine's own projects on a remote machine", async () => {
    const chosen: (string | undefined)[] = [];
    const panel = await mount((element) => {
      element.mcpResponse = response([server("files")]);
      element.projects = [project];
      element.onSelectProject = (projectId: string | undefined) => { chosen.push(projectId); };
    });

    const select = projectSelect(panel);
    const options = Array.from(select.options).map((option) => option.textContent.trim());
    expect(options[0]).toContain("No project");
    expect(options).toContain("Work");

    select.value = "p-1";
    select.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    await panel.updateComplete;
    expect(chosen).toEqual(["p-1"]);

    select.value = "";
    select.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    await panel.updateComplete;
    expect(chosen).toEqual(["p-1", undefined]);
  });

  it("says a project list that did not load did not load, and never that the machine has no projects", async () => {
    const failed = await mount((element) => {
      element.mcpResponse = response([server("files")]);
      element.projectsError = "The projects of Lab Mac did not load: gateway unreachable";
    });
    expect(panelText(failed)).toContain("did not load: gateway unreachable");
    expect(panelText(failed)).not.toContain("has no projects");

    const empty = await mount((element) => {
      element.mcpResponse = response([server("files")]);
      element.projects = [];
    });
    expect(panelText(empty)).toContain("has no projects");
  });

  it("turns a server off with the switch, naming the server and its scope", async () => {
    const onToggleServer = vi.fn<(server: PiMcpServerInfo, target: PiMcpWriteTarget, enabled: boolean) => void>();
    const panel = await mount((element) => {
      element.mcpResponse = response([server("files"), server("search", { scope: "project", configPath: "/work/project/.pi/mcp.json" })]);
      element.onToggleServer = onToggleServer;
    });

    const searchSwitch = switches(panel)[1];
    if (searchSwitch === undefined) throw new Error("Expected a switch on the second server row");
    flip(searchSwitch, false);

    expect(onToggleServer).toHaveBeenCalledWith(
      expect.objectContaining({ name: "search", scope: "project" }),
      { kind: "definition", scope: "project", configPath: "/work/project/.pi/mcp.json" },
      false,
    );
  });

  it("probes one server, and only that one", async () => {
    const onTestServer = vi.fn<(server: PiMcpServerInfo) => void>();
    const panel = await mount((element) => {
      element.mcpResponse = response([server("files"), server("search")]);
      element.onTestServer = onTestServer;
    });

    const card = cards(panel)[1];
    if (card === undefined) throw new Error("Expected a second server card");
    const test = buttons(card, "Test Connection")[0];
    if (test === undefined) throw new Error("Expected a Test Connection button");
    test.click();

    expect(onTestServer).toHaveBeenCalledWith(expect.objectContaining({ name: "search" }));
  });

  it("asks before it removes, and names the file the entry leaves", async () => {
    const onRemoveServer = vi.fn<(server: PiMcpServerInfo, target: PiMcpWriteTarget) => void>();
    const panel = await mount((element) => {
      element.mcpResponse = response([server("files", { configPath: "/work/project/.pi/mcp.json", scope: "project" })]);
      element.onRemoveServer = onRemoveServer;
    });

    const first = buttons(panel.shadowRoot, "Remove definition")[0];
    if (first === undefined) throw new Error("Expected a Remove definition button");
    first.click();
    await panel.updateComplete;

    const confirm = buttons(panel.shadowRoot, "Confirm remove")[0];
    expect(panelText(panel)).toContain("Remove the definition of files from /work/project/.pi/mcp.json?");
    expect(onRemoveServer).not.toHaveBeenCalled();
    if (confirm === undefined) throw new Error("Expected a confirmation step");
    confirm.click();

    expect(onRemoveServer).toHaveBeenCalledWith(expect.objectContaining({ name: "files", scope: "project" }), { kind: "definition", scope: "project", configPath: "/work/project/.pi/mcp.json" });
  });

  it("refuses to edit a server an extension registered, which pi owns", async () => {
    const panel = await mount((element) => {
      element.mcpResponse = response([server("builtin", { scope: "extension", configPath: "extension" })]);
    });

    const text = panelText(panel);
    expect(text).toContain("Registered by an extension");
    expect(switches(panel)[0]?.disabled).toBe(true);
    expect(buttons(panel.shadowRoot, "Remove")[0]?.disabled).toBe(true);
  });

  it("shows the project override that answers for a global server", async () => {
    const panel = await mount((element) => {
      element.mcpResponse = response([server("files", { enabled: false, configured: "disabled", overridePath: "/work/project/.pi/mcp.json", overrideOnly: true, scope: "global" })], { projectPath: "/work/project", projectConfigPath: "/work/project/.pi/mcp.json", projectTrusted: true, projectScopeRead: true });
    });

    const text = panelText(panel);
    expect(text).toContain("overrides a global server");
    expect(text).toContain("Project config:");
  });

  it("reports a load failure on the panel that asked for the load", async () => {
    const panel = await mount((element) => {
      element.targetMachine = remoteTarget;
      element.mcpResponse = response([]);
      element.error = "Failed to load MCP servers from Lab Mac: 502 Bad Gateway.";
    });

    expect(panelText(panel)).toContain("502 Bad Gateway");
    expect(panelText(panel)).toContain("Lab Mac");
  });
});
