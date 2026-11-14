// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configApi, piMcpApi, piPackagesApi, piSkillsApi, pluginsApi } from "../api";
import { settleRenderedDialog } from "./modalSurfaceTestSupport";
import { SettingsDialog } from "./SettingsDialog";
import { configResponse, mcpListResponse, mcpServerInfo, pluginsResponse, skillInfo, skillsResponse } from "./SettingsDialog.testSupport";
import type { Machine, PiMcpListResponse, PiPackagesResponse, PiSkillsResponse } from "../api";

/**
 * The rows of the machine a reader left are never the rows of the machine they entered.
 *
 * Every resource panel is a list of things with live controls on one machine. While a newly selected
 * machine is still answering, the panel must hold nothing: a row left from the machine that was
 * offers a real action - turn a skill off, remove a server, uninstall a package - against a resource
 * the machine now selected has never reported.
 */

const labMac = remoteMachine("lab-mac");
const deskMac = remoteMachine("desk-mac");

type Section = "skills" | "mcp" | "packages";

function remoteMachine(id: string): Machine {
  return { id, name: `The ${id} machine`, kind: "remote", baseUrl: `https://${id}.example.test`, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
}

function pending<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/**
 * Each machine answers for itself: the machine selected at open answers at once, and the machine a
 * reader switches to answers only when the test resolves it. A read is answered by the machine id the
 * client sent, the way the real routes are, so a panel can never be handed another machine's rows.
 */
function stubSkills(pendingForDesk: Promise<PiSkillsResponse>): void {
  const rows = skillsResponse([skillInfo("pdf")]);
  vi.spyOn(piSkillsApi, "list").mockImplementation((_projectId, machineId) => (machineId === deskMac.id ? pendingForDesk : Promise.resolve(rows)));
}

function stubMcp(pendingForDesk: Promise<PiMcpListResponse>): void {
  const rows = mcpListResponse([mcpServerInfo("files")]);
  vi.spyOn(piMcpApi, "list").mockImplementation((_projectId, machineId) => (machineId === deskMac.id ? pendingForDesk : Promise.resolve(rows)));
}

function stubPackages(pendingForDesk: Promise<PiPackagesResponse>): void {
  const rows: PiPackagesResponse = { packages: [{ source: "npm:@acme/tools", scope: "user", filtered: false, installedPath: "/tmp/pi-tools", disabled: false, enabled: true }] };
  vi.spyOn(piPackagesApi, "packages").mockImplementation((machineId) => (machineId === deskMac.id ? pendingForDesk : Promise.resolve(rows)));
}

/**
 * Stubs the section's read for the machine question, and hands back the way to answer the machine a
 * reader switched to. Each branch answers in its own response type, so no cast is needed anywhere.
 */
function stubSection(section: Section): { resolveDesk: () => void } {
  if (section === "skills") {
    const desk = pending<PiSkillsResponse>();
    stubSkills(desk.promise);
    return { resolveDesk: () => { desk.resolve(skillsResponse([])); } };
  }
  if (section === "mcp") {
    const desk = pending<PiMcpListResponse>();
    stubMcp(desk.promise);
    return { resolveDesk: () => { desk.resolve(mcpListResponse([])); } };
  }
  const desk = pending<PiPackagesResponse>();
  stubPackages(desk.promise);
  return { resolveDesk: () => { desk.resolve({ packages: [] }); } };
}

beforeEach(() => {
  vi.spyOn(configApi, "config").mockResolvedValue(configResponse({}));
  vi.spyOn(pluginsApi, "plugins").mockResolvedValue(pluginsResponse([]));
  vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(new Response("{}", { status: 200, headers: { "content-type": "application/json" } })));
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
  localStorage.clear();
});

async function open(section: Section): Promise<SettingsDialog> {
  const dialog = new SettingsDialog();
  dialog.section = section;
  dialog.machines = [labMac, deskMac];
  dialog.machine = labMac;
  document.body.append(dialog);
  await settleRenderedDialog(dialog);
  await flushLoads();
  return dialog;
}

function renderedDialog(): SettingsDialog {
  const dialog = document.querySelector<SettingsDialog>("settings-dialog");
  if (dialog === null) throw new Error("Expected the settings dialog to be mounted");
  return dialog;
}

/** The panels answer a read in a microtask chain, so a settled render is not yet the answered render. */
async function flushLoads(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await renderedDialog().updateComplete;
  await new Promise((resolve) => setTimeout(resolve, 0));
  await renderedDialog().updateComplete;
}

function panelText(section: Section): string {
  return panel(section).textContent;
}

function mcpRemoveControl(): HTMLButtonElement {
  const control = panel("mcp").querySelector<HTMLButtonElement>(".server-list button.danger");
  if (control === null) throw new Error("Expected a Remove control on the machine's server row");
  return control;
}

function panel(section: Section): ShadowRoot {
  const tag = { skills: "settings-skills-panel", mcp: "settings-mcp-panel", packages: "settings-packages-panel" }[section];
  const panelElement = renderedDialog().shadowRoot?.querySelector(tag);
  if (panelElement === null || panelElement === undefined) throw new Error(`Expected the ${tag} to be mounted`);
  const root = panelElement.shadowRoot;
  if (root === null) throw new Error("Expected the panel to render inside its own shadow root");
  return root;
}

/**
 * The controls on the rows themselves, not the panel's own chrome (an install field is always
 * there). A row left from another machine is dangerous exactly here: its switch, Update, Remove,
 * Test, and confirm controls act on a resource the machine now selected never reported.
 */
function liveControls(section: Section): Element[] {
  const list = { skills: ".skill-list", mcp: ".server-list", packages: ".package-list" }[section];
  const root = panel(section);
  const controls = Array.from(root.querySelectorAll(`${list} input, ${list} button, ${list} select`));
  const rows = Array.from(root.querySelectorAll(`${list} .skill-main, ${list} .server-card, ${list} .package-main`));
  expect(rows, "a row is visible on the panel").toBeDefined();
  return controls.filter((control) => !control.hasAttribute("disabled"));
}

function rowTags(section: Section): Element[] {
  const list = { skills: ".skill-list", mcp: ".server-list", packages: ".package-list" }[section];
  const row = { skills: ".skill-main", mcp: ".server-card", packages: ".package-main" }[section];
  return Array.from(panel(section).querySelectorAll(`${list} ${row}`));
}

describe.each<Section>(["skills", "mcp", "packages"])("the %s panel across a machine switch", (section) => {
  it("offers the selected machine's rows", async () => {
    const { resolveDesk } = stubSection(section);
    resolveDesk();

    await open(section);

    expect(liveControls(section).length).toBeGreaterThan(0);
  });

  it("holds nothing while the machine a reader switched to is still answering", async () => {
    const { resolveDesk } = stubSection(section);

    const dialog = await open(section);
    expect(liveControls(section).length).toBeGreaterThan(0);

    expect(rowTags(section).length).toBe(1);

    dialog.machine = deskMac;
    await settleRenderedDialog(dialog);

    expect(rowTags(section)).toEqual([]);
    expect(liveControls(section)).toEqual([]);

    resolveDesk();
    await flushLoads();
    expect(liveControls(section)).toEqual([]);
  });
});

describe("the MCP removal confirmation across a machine switch", () => {
  /**
   * The two-press guard is a promise about one machine. The panel element is reused when the reader
   * switches, and both machines answer a server with the same name in the same scope, so a guard that
   * is not keyed by the target hands the second press to the machine that was never confirmed.
   */
  it("does not carry a confirmation armed on the machine a reader left", async () => {
    const desk = pending<PiMcpListResponse>();
    vi.spyOn(piMcpApi, "list").mockImplementation((_projectId, machineId) => (machineId === deskMac.id ? desk.promise : Promise.resolve(mcpListResponse([mcpServerInfo("files")]))));
    const removed: string[] = [];
    const remove = vi.spyOn(piMcpApi, "remove").mockImplementation((request) => {
      removed.push(request.name);
      return Promise.resolve({ ...mcpListResponse([mcpServerInfo("files")]), action: "remove", name: request.name, removed: true, requiresReload: true });
    });

    const dialog = await open("mcp");
    mcpRemoveControl().click();
    await settleRenderedDialog(dialog);
    expect(panelText("mcp")).toContain("Confirm remove");

    dialog.machine = deskMac;
    await settleRenderedDialog(dialog);
    desk.resolve(mcpListResponse([mcpServerInfo("files")]));
    await flushLoads();

    expect(panelText("mcp")).not.toContain("Confirm remove");
    mcpRemoveControl().click();
    await settleRenderedDialog(dialog);

    expect(panelText("mcp")).toContain("Confirm remove");
    expect(removed).toEqual([]);
    expect(remove).not.toHaveBeenCalled();
  });
});
