// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configApi, piMcpApi, piPackagesApi, piSkillsApi, pluginsApi, projectsApi } from "../api";
import { requiredElement, settleRenderedDialog } from "./modalSurfaceTestSupport";
import { SettingsDialog } from "./SettingsDialog";
import { configResponse, mcpListResponse, mcpServerInfo, pluginsResponse, settingsProject, skillInfo, skillsResponse, stubProjectsApi } from "./SettingsDialog.testSupport";
import type { SettingsSkillsPanel } from "./settings/SettingsSkillsPanel";
import type { SettingsMcpPanel } from "./settings/SettingsMcpPanel";
import type { Machine, PiMcpServerInfo, PiSkillInfo } from "../api";

/**
 * The Skills and MCP sections, wired through the dialog that owns them.
 *
 * The panels are tested on their own; what lives here is the promise a reader cares about: the
 * section is in the list, opening it shows that machine's answer, and switching machines asks the
 * machine that is selected - never the one whose rows are already on the screen.
 */
const labMac: Machine = {
  id: "lab-mac",
  name: "Lab Mac",
  kind: "remote",
  baseUrl: "https://lab.example.test",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => {
  vi.spyOn(configApi, "config").mockResolvedValue(configResponse({}));
  vi.spyOn(pluginsApi, "plugins").mockResolvedValue(pluginsResponse([]));
  vi.spyOn(piPackagesApi, "packages").mockResolvedValue({ packages: [] });
  vi.spyOn(piSkillsApi, "list").mockResolvedValue(skillsResponse([skillInfo("pdf")]));
  vi.spyOn(piMcpApi, "list").mockResolvedValue(mcpListResponse([mcpServerInfo("files")]));
  vi.spyOn(piSkillsApi, "setEnabled").mockResolvedValue({ ...skillsResponse([skillInfo("pdf")]), requiresReload: true });
  vi.spyOn(piMcpApi, "test").mockResolvedValue({ ...mcpListResponse([mcpServerInfo("files")]), action: "test", name: "files", probe: { state: "reachable" }, requiresReload: false });
  vi.spyOn(piMcpApi, "remove").mockResolvedValue({ ...mcpListResponse([mcpServerInfo("files")]), action: "remove", name: "files", removed: true, requiresReload: true });
  vi.spyOn(piMcpApi, "setEnabled").mockResolvedValue({ ...mcpListResponse([mcpServerInfo("files")]), action: "set-enabled", name: "files", enabled: false, requiresReload: true });
  stubProjectsApi([settingsProject()]);
  vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } })));
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
  localStorage.clear();
});

async function open(section: "skills" | "mcp", machine?: Machine): Promise<SettingsDialog> {
  const dialog = new SettingsDialog();
  dialog.section = section;
  dialog.machines = machine === undefined ? [] : [machine];
  dialog.machine = machine;
  document.body.append(dialog);
  await settleRenderedDialog(dialog);
  return dialog;
}

function navLabels(dialog: SettingsDialog): string[] {
  const nav = requiredElement(dialog.shadowRoot?.querySelector<HTMLElement>(".settings-nav"), "settings nav");
  return Array.from(nav.querySelectorAll("button")).map((button) => button.textContent.trim());
}

function dialogText(dialog: SettingsDialog): string {
  const parts: string[] = [];
  visit(dialog.shadowRoot);
  return parts.join(" ");

  function visit(root: ShadowRoot | null): void {
    if (root === null) return;
    parts.push(root.textContent);
    for (const child of Array.from(root.querySelectorAll<HTMLElement>("*"))) visit(child.shadowRoot);
  }
}

function panelTag(dialog: SettingsDialog): string {
  const tags = ["settings-skills-panel", "settings-mcp-panel", "settings-packages-panel", "settings-plugins-panel", "settings-general-panel"];
  const found = tags.filter((tag) => dialog.shadowRoot?.querySelector(tag) !== null);
  const [tag] = found;
  if (found.length !== 1 || tag === undefined) throw new Error(`Expected exactly one settings panel, found ${found.join(", ") || "none"}`);
  return tag;
}

/**
 * The panel the dialog renders, typed as the element the dialog wires.
 *
 * The dialog hands a panel the machine's answer and the write handlers as element properties, so
 * these checks read them off the panel element itself: a panel that never received the machine's
 * answer, or never got wired to the machine that is selected, fails on the missing property.
 */
function skillsPanel(dialog: SettingsDialog): SettingsSkillsPanel {
  return requiredElement(dialog.shadowRoot?.querySelector<SettingsSkillsPanel>("settings-skills-panel"), "skills panel");
}

function mcpPanel(dialog: SettingsDialog): SettingsMcpPanel {
  return requiredElement(dialog.shadowRoot?.querySelector<SettingsMcpPanel>("settings-mcp-panel"), "mcp panel");
}

describe("the Skills and MCP sections", () => {
  it("offers Skills and MCP Servers in the section list", async () => {
    const dialog = await open("skills");

    expect(navLabels(dialog).some((label) => label.includes("Skills"))).toBe(true);
    expect(navLabels(dialog).some((label) => label.includes("MCP Servers"))).toBe(true);
  });

  it("opens the Skills panel on the skills the machine reported", async () => {
    const dialog = await open("skills");

    expect(panelTag(dialog)).toBe("settings-skills-panel");
    expect(skillsPanel(dialog).skillsResponse?.skills.map((entry: PiSkillInfo) => entry.name)).toEqual(["pdf"]);
    expect(skillsPanel(dialog).projects.map((project) => project.id)).toEqual(["p-1"]);
    expect(skillsPanel(dialog).projectSelection).toBeUndefined();
  });

  it("opens the MCP panel on the servers the machine reported", async () => {
    const dialog = await open("mcp");

    expect(panelTag(dialog)).toBe("settings-mcp-panel");
    expect(mcpPanel(dialog).mcpResponse?.servers.map((entry: PiMcpServerInfo) => entry.name)).toEqual(["files"]);
  });

  it("asks the machine that is selected, by its id", async () => {
    await open("skills", labMac);
    await open("mcp", labMac);

    expect(piSkillsApi.list).toHaveBeenCalledWith(undefined, "lab-mac");
    expect(piMcpApi.list).toHaveBeenCalledWith(undefined, "lab-mac");
  });

  it("asks the local gateway when no machine is selected", async () => {
    await open("skills");
    await open("mcp");

    const skillsTargets = vi.mocked(piSkillsApi.list).mock.calls.map((call) => call[1]);
    const mcpTargets = vi.mocked(piMcpApi.list).mock.calls.map((call) => call[1]);
    expect(skillsTargets.length).toBeGreaterThan(0);
    expect(mcpTargets.length).toBeGreaterThan(0);
    expect(new Set(skillsTargets)).toEqual(new Set(["local"]));
    expect(new Set(mcpTargets)).toEqual(new Set(["local"]));
  });

  it("loads project skills and writes a global skill preference as a project override", async () => {
    const projectSkills = skillsResponse(
      [skillInfo("pdf", { scope: "global", enabled: true })],
      [
        { scope: "global", skillsDir: "/pi/skills", configPath: "/config/pi-web/config.json" },
        { scope: "project", skillsDir: "/work/project/.pi/skills", configPath: "/work/project/.pi-web/config.json", projectId: "p-1", projectPath: "/work/project", projectTrusted: true },
      ],
    );
    vi.mocked(piSkillsApi.list).mockImplementation((projectId) => Promise.resolve(projectId === "p-1" ? projectSkills : skillsResponse([skillInfo("pdf")])));
    vi.mocked(piSkillsApi.setEnabled).mockResolvedValue({ ...projectSkills, requiresReload: true });
    const dialog = await open("skills", labMac);
    const panel = skillsPanel(dialog);
    if (panel.onSelectProject === undefined || panel.onToggleSkill === undefined) throw new Error("Expected the Skills project selector and toggle to be wired");

    await panel.onSelectProject("p-1");
    await settleRenderedDialog(dialog);
    expect(piSkillsApi.list).toHaveBeenLastCalledWith("p-1", "lab-mac");
    expect(skillsPanel(dialog).skillsResponse?.scopes[1]?.projectId).toBe("p-1");

    await skillsPanel(dialog).onToggleSkill?.(skillInfo("pdf"), false);
    await settleRenderedDialog(dialog);
    expect(piSkillsApi.setEnabled).toHaveBeenCalledWith({ name: "pdf", scope: "project", projectId: "p-1", enabled: false }, "lab-mac");
    expect(piSkillsApi.list).toHaveBeenLastCalledWith("p-1", "lab-mac");
  });

  it("switches a skill through the machine that is selected, and redraws from that machine's answer", async () => {
    // A machine answers its own list from the file the write just changed, and the dialog verifies the
    // switch through that read. The stub carries the state the write produced, so the redraw assertion
    // measures the panel redrawing from the machine rather than from the write's own echo.
    const machine: { skills: PiSkillInfo[] } = { skills: [skillInfo("pdf")] };
    vi.mocked(piSkillsApi.list).mockImplementation(() => Promise.resolve(skillsResponse(machine.skills)));
    vi.mocked(piSkillsApi.setEnabled).mockImplementation((request) => {
      machine.skills = [skillInfo(request.name, { enabled: request.enabled, preference: request.enabled ? "enabled" : "disabled" })];
      return Promise.resolve({ ...skillsResponse(machine.skills), requiresReload: true });
    });
    const dialog = await open("skills", labMac);
    const panel = skillsPanel(dialog);
    if (panel.onToggleSkill === undefined) throw new Error("Expected the skills panel to be wired to the dialog");

    await panel.onToggleSkill(skillInfo("pdf"), false);
    await settleRenderedDialog(dialog);

    expect(piSkillsApi.setEnabled).toHaveBeenCalledWith({ name: "pdf", scope: "global", enabled: false }, "lab-mac");
    const redrawn = skillsPanel(dialog).skillsResponse;
    expect(redrawn?.skills[0]?.enabled).toBe(false);
  });

  it("probes and removes an MCP server through the machine that is selected", async () => {
    vi.mocked(piMcpApi.test).mockResolvedValue({ ...mcpListResponse([mcpServerInfo("files")]), action: "test", name: "files", probe: { state: "reachable" }, requiresReload: false });
    vi.mocked(piMcpApi.remove).mockResolvedValue({ ...mcpListResponse([]), action: "remove", name: "files", removed: true, requiresReload: true });

    const dialog = await open("mcp", labMac);
    const panel = mcpPanel(dialog);
    if (panel.onTestServer === undefined || panel.onRemoveServer === undefined) throw new Error("Expected the MCP panel to be wired to the dialog");

    const row = mcpServerInfo("files");
    const definition = row.targets[0];
    if (definition === undefined) throw new Error("Expected the fixture row to name the entry it writes");
    await panel.onTestServer(row);
    await panel.onRemoveServer(row, definition);
    await settleRenderedDialog(dialog);

    expect(piMcpApi.test).toHaveBeenCalledWith({ name: "files" }, "lab-mac");
    expect(piMcpApi.remove).toHaveBeenCalledWith({ name: "files", target: "definition", scope: "global" }, "lab-mac");
    const redrawn = mcpPanel(dialog).mcpResponse;
    expect(redrawn?.servers).toEqual([]);
    expect(dialogText(dialog)).toContain("was removed");
  });

  it("reads the global scope until a project is chosen, then reads the scope of the project it chose", async () => {
    const dialog = await open("mcp", labMac);
    const panel = mcpPanel(dialog);
    if (panel.onSelectProject === undefined) throw new Error("Expected the MCP panel to be wired to the dialog");

    expect(piMcpApi.list).toHaveBeenLastCalledWith(undefined, "lab-mac");
    expect(panel.projects.map((project) => project.id)).toEqual(["p-1"]);
    expect(panel.projectSelection).toBeUndefined();

    void panel.onSelectProject("p-1");
    await settleRenderedDialog(dialog);

    expect(piMcpApi.list).toHaveBeenLastCalledWith("p-1", "lab-mac");
    expect(mcpPanel(dialog).projectSelection).toBe("p-1");
  });

  it("writes a project's override of a global server with the project, the entry, and the answer's project", async () => {
    const row = mcpServerInfo("files", {
      enabled: true,
      overridePath: "/work/project/.pi/mcp.json",
      targets: [
        { kind: "definition", scope: "global", configPath: "/pi/mcp.json" },
        { kind: "override", scope: "project", configPath: "/work/project/.pi/mcp.json" },
      ],
    });
    vi.mocked(piMcpApi.list).mockResolvedValue(mcpListResponse([row], {
      projectPath: "/work/project",
      projectConfigPath: "/work/project/.pi/mcp.json",
      projectTrusted: true,
      projectScopeRead: true,
    }));

    const dialog = await open("mcp", labMac);
    void mcpPanel(dialog).onSelectProject?.("p-1");
    await settleRenderedDialog(dialog);

    const shown = mcpPanel(dialog).mcpResponse;
    const shownRow = shown?.servers.find((server) => server.name === "files");
    const override = shownRow?.targets.find((target) => target.kind === "override");
    if (shownRow === undefined || override === undefined) throw new Error("Expected the answer to offer the project's override");

    const toggle = mcpPanel(dialog).onToggleServer;
    if (toggle === undefined) throw new Error("Expected the MCP panel to be wired to the dialog");
    await toggle(shownRow, override, false);
    await settleRenderedDialog(dialog);

    expect(piMcpApi.setEnabled).toHaveBeenLastCalledWith(
      { name: "files", target: "override", scope: "project", projectId: "p-1", enabled: false },
      "lab-mac",
    );
  });

  it("says a project that is not trusted, and stops the panel offering to write into it", async () => {
    vi.mocked(piMcpApi.list).mockResolvedValue(mcpListResponse([mcpServerInfo("files")], {
      projectPath: "/work/project",
      projectConfigPath: "/work/project/.pi/mcp.json",
      projectTrusted: false,
      projectScopeRead: false,
    }));

    const dialog = await open("mcp", labMac);
    void mcpPanel(dialog).onSelectProject?.("p-1");
    await settleRenderedDialog(dialog);

    const text = dialogText(dialog);
    expect(text).toContain("Project scope not read");
    expect(text).toContain("not trusted");
    expect(text).not.toContain("Remove project override");
  });

  it("says the projects that did not load, and keeps the rows it has for the scope it read", async () => {
    vi.spyOn(projectsApi, "projects").mockRejectedValue(new Error("Remote machine unavailable"));

    const dialog = await open("mcp", labMac);
    await settleRenderedDialog(dialog);

    expect(mcpPanel(dialog).projectsError).toContain("did not load");
    expect(dialogText(dialog)).toContain("did not load");
    expect(mcpPanel(dialog).mcpResponse?.servers.map((server) => server.name)).toEqual(["files"]);
  });

  it("says on the panel which machine a failed read came from", async () => {
    vi.mocked(piMcpApi.list).mockRejectedValue(new Error("Remote machine unavailable"));
    vi.mocked(piSkillsApi.list).mockRejectedValue(new Error("Remote machine unavailable"));

    const skills = await open("skills", labMac);
    const mcp = await open("mcp", labMac);

    expect(dialogText(skills)).toContain("Failed to load skills from Lab Mac");
    expect(dialogText(mcp)).toContain("Failed to load MCP servers from Lab Mac");
  });
});
