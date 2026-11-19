// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { PiMcpListResponse, PiMcpServerInfo, PiMcpSaveRequest, Project } from "../api";
import { McpSettingsPanel, type McpSettingsPanelProps } from "./McpSettingsPanel";

const globalFile = "/home/pi/.pi/agent/mcp.json";
const projectFile = "/srv/repo/.pi/mcp.json";
const project: Project = { id: "p-1", name: "repo", path: "/srv/repo", createdAt: "2026-01-01T00:00:00.000Z" };

function row(fields: Partial<PiMcpServerInfo>): PiMcpServerInfo {
  return {
    name: "files",
    scope: "global",
    transport: "stdio",
    configured: "enabled",
    enabled: true,
    configPath: globalFile,
    targets: [
      { kind: "definition", scope: "global", configPath: globalFile },
      { kind: "override", scope: "project", configPath: projectFile },
    ],
    command: "npx",
    envNames: ["API_TOKEN"],
    usesSecrets: true,
    ...fields,
  };
}

const list: PiMcpListResponse = {
  servers: [row({})],
  errors: [],
  globalConfigPath: globalFile,
  projectConfigPath: projectFile,
  projectPath: project.path,
  projectTrusted: true,
  projectScopeRead: true,
};

type FakePanelData = Omit<McpSettingsPanelProps["data"], "setMcpEnabled" | "testMcp" | "removeMcp" | "saveMcp"> & {
  setMcpEnabled: Mock<() => Promise<void>>;
  testMcp: Mock<() => Promise<void>>;
  removeMcp: Mock<() => Promise<void>>;
  saveMcp: Mock<(request: PiMcpSaveRequest) => Promise<void>>;
};

function panelData(fields: Partial<FakePanelData> = {}): FakePanelData {
  return {
    settings: { loading: false, mcp: list },
    selectedProject: project,
    setMcpEnabled: vi.fn(() => Promise.resolve()),
    testMcp: vi.fn(() => Promise.resolve()),
    removeMcp: vi.fn(() => Promise.resolve()),
    saveMcp: vi.fn(() => Promise.resolve()),
    ...fields,
  };
}

let container: HTMLDivElement;
let root: Root;

function button(text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find((element) => element.textContent.trim() === text);
  if (found === undefined) throw new Error(`The "${text}" button did not render.`);
  return found;
}

function field(label: string, scope: Element = container): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
  const labelElement = [...scope.querySelectorAll("label")].find((element) => element.textContent.trim().startsWith(label));
  const input = labelElement?.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input,select,textarea");
  if (input === null || input === undefined) throw new Error(`The "${label}" field did not render.`);
  return input;
}

function inputField(label: string, scope: HTMLElement): HTMLInputElement {
  const input = field(label, scope);
  if (!(input instanceof HTMLInputElement)) throw new Error(`The "${label}" field is not a text input.`);
  return input;
}

function selectField(label: string, scope: HTMLElement): HTMLSelectElement {
  const input = field(label, scope);
  if (!(input instanceof HTMLSelectElement)) throw new Error(`The "${label}" field is not a choice.`);
  return input;
}

function textAreaField(label: string, scope: HTMLElement): HTMLTextAreaElement {
  const input = field(label, scope);
  if (!(input instanceof HTMLTextAreaElement)) throw new Error(`The "${label}" field is not a multiline box.`);
  return input;
}

function type(input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string): void {
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function choose(selectElement: HTMLSelectElement, value: string): void {
  selectElement.value = value;
  selectElement.dispatchEvent(new Event("change", { bubbles: true }));
}

async function press(action: () => void): Promise<void> {
  await act(async () => {
    action();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function openForm(): Promise<HTMLElement> {
  await press(() => {
    button("Add server").click();
  });
  const form = container.querySelector("form");
  if (form === null) throw new Error("The MCP form did not render.");
  return form;
}

async function saveForm(form: HTMLElement): Promise<void> {
  await press(() => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
}

function savedRequest(data: FakePanelData): PiMcpSaveRequest {
  const calls = data.saveMcp.mock.calls;
  if (calls.length !== 1) throw new Error(`Expected one save, saw ${String(calls.length)}.`);
  const request = calls[0]?.[0];
  if (request === undefined) throw new Error("The save was called without a request.");
  return request;
}

describe("React MCP settings panel", () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    document.body.replaceChildren();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    vi.restoreAllMocks();
  });

  async function render(data: McpSettingsPanelProps["data"], run: McpSettingsPanelProps["run"] = (action) => action().then(() => undefined)): Promise<void> {
    await act(async () => {
      root.render(createElement(McpSettingsPanel, { data, busy: false, run }));
      await Promise.resolve();
    });
  }

  /** A runner that behaves like the dialog's: it catches the machine's refusal and reports it. */
  function runner(): { readonly run: McpSettingsPanelProps["run"]; readonly problems: string[] } {
    const problems: string[] = [];
    return {
      problems,
      run: async (action) => {
        try {
          await action();
        } catch (error) {
          problems.push(error instanceof Error ? error.message : String(error));
        }
      },
    };
  }

  it("shows each row with the file it came from and the names of its secrets", async () => {
    await render(panelData());
    const rows = [...container.querySelectorAll(".rw-setting-row")];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toContain("files");
    expect(rows[0]?.textContent).toContain(globalFile);
    expect(rows[0]?.textContent).toContain("secrets: API_TOKEN");
  });

  it("shows pi's own configuration problems for the files it read", async () => {
    await render(panelData({ settings: { loading: false, mcp: { ...list, errors: ["server \"x\" needs either \"command\" (stdio) or \"url\" (streamable HTTP)"] } } }));
    expect(container.querySelector(".rw-settings-notice")?.textContent).toContain("needs either \"command\"");
  });

  it("adds a stdio server to the scope the person chose, with pi's own config shape", async () => {
    const data = panelData();
    await render(data);
    const form = await openForm();
    expect(selectField("Write to", form).value).toBe("definition:true");
    type(field("Name", form), "search");
    type(field("Command", form), "npx");
    type(field("Arguments", form), "-y search-mcp");
    type(field("Environment variables", form), "API_TOKEN=secret");
    await saveForm(form);
    expect(savedRequest(data)).toEqual({
      name: "search",
      projectId: project.id,
      target: "definition",
      config: { enabled: true, type: "stdio", command: "npx", args: ["-y", "search-mcp"], env: { API_TOKEN: "secret" } },
    });
  });

  it("names the machine's global file, not the project, when the write is a global definition", async () => {
    const data = panelData();
    await render(data);
    const form = await openForm();
    choose(selectField("Write to", form), "definition:false");
    type(field("Name", form), "search");
    type(field("Command", form), "npx");
    await saveForm(form);
    const request = savedRequest(data);
    expect(request).toMatchObject({ name: "search", target: "definition" });
    expect(request.projectId).toBeUndefined();
  });

  it("refuses an incomplete form before the machine sees it", async () => {
    const data = panelData();
    await render(data);
    const form = await openForm();
    type(field("Name", form), "search");
    await saveForm(form);
    expect(container.querySelector("[role=alert]")?.textContent).toContain("command");
    expect(data.saveMcp).not.toHaveBeenCalled();
  });

  it("prefills an edit with the values the row carries and keeps a hidden secret out of the request", async () => {
    const data = panelData();
    await render(data);
    await press(() => {
      button("Edit").click();
    });
    const form = container.querySelector("form");
    if (form === null) throw new Error("The MCP edit form did not render.");
    const name = inputField("Name", form);
    expect(name.value).toBe("files");
    expect(name.disabled).toBe(true);
    expect(inputField("Command", form).value).toBe("npx");
    expect(textAreaField("Environment variables", form).value).toBe("");
    expect(form.textContent).toContain("API_TOKEN");
    // The row is the machine's global definition, so the edit opens on that file and says so.
    expect(selectField("Write to", form).value).toBe("definition:false");
    await saveForm(form);
    expect(savedRequest(data)).toEqual({
      name: "files",
      target: "definition",
      config: { enabled: true, type: "stdio", command: "npx" },
    });
  });

  it("keeps a project-defined row's edit inside the project that defines it", async () => {
    const data = panelData({
      settings: {
        loading: false,
        mcp: {
          ...list,
          servers: [row({ scope: "project", configPath: projectFile, targets: [{ kind: "definition", scope: "project", configPath: projectFile }] })],
        },
      },
    });
    await render(data);
    await press(() => {
      button("Edit").click();
    });
    const form = container.querySelector("form");
    if (form === null) throw new Error("The MCP edit form did not render.");
    expect(selectField("Write to", form).value).toBe("definition:true");
    type(field("Command", form), "node");
    await saveForm(form);
    expect(savedRequest(data)).toMatchObject({ name: "files", target: "definition", projectId: project.id });
  });

  it("writes an override with only the keys a project's override may set", async () => {
    const data = panelData();
    await render(data);
    await press(() => {
      button("Edit").click();
    });
    const form = container.querySelector("form");
    if (form === null) throw new Error("The MCP edit form did not render.");
    choose(selectField("Write to", form), "override:true");
    choose(selectField("Exposure", form), "hidden");
    expect(form.textContent).toContain("enabled switch and its exposure");
    await saveForm(form);
    expect(savedRequest(data)).toEqual({ name: "files", projectId: project.id, target: "override", config: { enabled: true, exposure: "hidden" } });
  });

  it("asks the machine to probe the row it was shown", async () => {
    const data = panelData();
    await render(data);
    await press(() => {
      button("Test").click();
    });
    expect(data.testMcp).toHaveBeenCalledWith(row({}));
  });

  it("removes the entry the row resolves to", async () => {
    const data = panelData();
    await render(data);
    await press(() => {
      button("Remove").click();
    });
    expect(data.removeMcp).toHaveBeenCalledWith(row({}));
  });

  it("refuses to act on a row with no writable target", async () => {
    const data = panelData({ settings: { loading: false, mcp: { ...list, servers: [row({ targets: [] })] } } });
    await render(data);
    expect(button("Remove").disabled).toBe(true);
    expect(button("Edit").disabled).toBe(true);
  });

  it("keeps the form open when the machine refuses a save, and hands the refusal to its owner", async () => {
    const data = panelData({ saveMcp: vi.fn(() => Promise.reject(new Error("MCP server \"search\" is defined in another project's file"))) });
    const { run, problems } = runner();
    await render(data, run);
    const form = await openForm();
    type(field("Name", form), "search");
    type(field("Command", form), "npx");
    await saveForm(form);
    expect(problems).toEqual(["MCP server \"search\" is defined in another project's file"]);
    expect(container.querySelector("form")).not.toBeNull();
  });

  it("sends no project when the page is answering for the machine alone", async () => {
    const data = panelData({ selectedProject: undefined });
    await render(data);
    const form = await openForm();
    type(field("Name", form), "search");
    type(field("Command", form), "npx");
    await saveForm(form);
    const request = savedRequest(data);
    expect(request.projectId).toBeUndefined();
    expect(selectField("Write to", form).value).toBe("definition:false");
  });
});
