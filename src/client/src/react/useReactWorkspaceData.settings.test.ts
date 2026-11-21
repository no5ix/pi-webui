// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CORE_MATERIAL_DARK_THEME_ID } from "../nativeDarkTheme";
import { ReactSettingsDialog } from "./ReactSettingsDialog";
import type { ReactSettingsDialogProps } from "./ReactSettingsDialog";
import { useReactWorkspaceData, type ReactWorkspaceData } from "./useReactWorkspaceData";

const appliedThemeStub: ReactSettingsDialogProps["theme"] = {
  preference: { themeId: CORE_MATERIAL_DARK_THEME_ID, auto: false },
  choices: [{ id: CORE_MATERIAL_DARK_THEME_ID, name: "Material Dark (native)", colorScheme: "dark", description: "Built-in.", source: "native" }],
  failure: undefined,
  select: () => true,
  setAuto: () => undefined,
};


const STAMP = "2026-01-01T00:00:00.000Z";
const autoToc = { id: "prj-auto-toc", name: "auto-toc", path: "/repo/auto-toc", createdAt: STAMP };
const saytype = { id: "prj-saytype", name: "saytypetypetype", path: "/repo/saytype", createdAt: STAMP };

const skillOf = (name: string) => ({
  id: `sk1:p:${name}`,
  name,
  description: `the ${name} skill`,
  filePath: `/repo/.pi/skills/${name}/SKILL.md`,
  baseDir: "/repo/.pi/skills",
  scope: "project",
  origin: "project",
  source: "project",
  preference: "default",
  enabled: true,
  validation: "valid",
});

interface Scenario {
  projectsByMachine: Record<string, unknown[]>;
  skillsByProject: Record<string, unknown[]>;
  /** The list the server answers a skill write with: pi re-reads the scope the write touched. */
  enabledSkillsAnswer: unknown[];
  failSkills: boolean;
  hangSkillsFor: (url: string) => boolean;
}

interface Harness {
  readonly data: () => ReactWorkspaceData;
  readonly calls: (fragment: string) => string[];
  readonly text: () => string;
  readonly page: (name: string) => Promise<void>;
  readonly selectSettingsProject: (projectId: string) => Promise<void>;
  readonly selectMachine: (machineId: string) => Promise<void>;
  readonly reload: () => Promise<void>;
  readonly resolveHangedSkills: () => Promise<void>;
  readonly toggleSkill: (testId: string, on: boolean) => Promise<void>;
  readonly open: (value: boolean) => Promise<void>;
  readonly unmount: () => Promise<void>;
}

/**
 * The real data hook over a stubbed API, drawn through the real Settings dialog.
 *
 * The Settings pages are only correct as a whole: the hook owns the scope, the reads and the ledger,
 * and the dialog draws what the scope answered. Rendering both is what shows a scope that never
 * answers, an answer that lands under the wrong heading, and a hook that cannot render at all.
 */
async function settingsHarness(scenario: Scenario, open = true): Promise<Harness> {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const requests: string[] = [];
  const hangResolvers: (() => void)[] = [];

  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof URL ? input.href : typeof input === "string" ? input : input.url;
    requests.push(`${init?.method ?? "GET"} ${url}`);
    const query = new URL(url, "http://localhost").searchParams;
    const machineId = /\/api\/machines\/([^/]+)/.exec(url)?.[1] ?? "local";
    let body: unknown = {};
    let status = 200;
    if (url.endsWith("/api/machines") || url.includes("/api/machines?")) {
      body = { machines: [local(), lab()] };
    } else if (url.includes("/projects")) {
      body = scenario.projectsByMachine[machineId] ?? [];
    } else if (url.includes("/pi-skills")) {
      if (url.includes("/pi-skills/set-enabled")) {
        body = { skills: scenario.enabledSkillsAnswer, diagnostics: [], scopes: [], requiresReload: true };
        return Promise.resolve(json(body));
      }
      if (scenario.hangSkillsFor(url)) {
        const hung = { skills: scenario.skillsByProject[query.get("projectId") ?? ""] ?? [], diagnostics: [], scopes: [] };
        return new Promise<Response>(resolve => {
          hangResolvers.push(() => { resolve(json(hung)); });
        });
      }
      if (scenario.failSkills) status = 500;
      body = status === 200 ? { skills: scenario.skillsByProject[query.get("projectId") ?? ""] ?? [], diagnostics: [], scopes: [] } : { error: "skills directory is unreadable" };
    } else if (url.includes("/pi-mcp")) {
      body = { servers: [], errors: [], globalConfigPath: "/u/.pi/mcp.json", projectTrusted: true, projectScopeRead: true };
    } else if (url.includes("/pi-packages")) {
      body = { packages: [] };
    } else if (url.includes("/plugins")) {
      body = { plugins: [] };
    } else if (url.includes("/config")) {
      body = { path: "/etc/pi-web/config.json", exists: true, config: { host: "127.0.0.1", port: 8505 }, effectiveConfig: {}, envOverrides: {} };
    }
    return Promise.resolve(json(body, status));
  });
  vi.stubGlobal("fetch", fetchMock);

  let latest: ReactWorkspaceData | undefined;
  let setOpen: (open: boolean) => void = () => undefined;
  function Probe() {
    const [openNow, setOpenNow] = useState(open);
    setOpen = setOpenNow;
    latest = useReactWorkspaceData();
    return createElement(ReactSettingsDialog, { data: latest, open: openNow, onClose: () => { setOpenNow(false); }, theme: appliedThemeStub });
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(createElement(Probe));
    await Promise.resolve();
  });
  await flush();

  const click = async (element: Element | null | undefined) => {
    await act(async () => {
      element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
  };
  const pick = async (selector: string, value: string) => {
    const select = container.querySelector<HTMLSelectElement>(selector);
    await act(async () => {
      if (select === null) throw new Error(`no select for ${selector}`);
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });
  };

  return {
    data: () => {
      if (latest === undefined) throw new Error("the hook never rendered");
      return latest;
    },
    toggleSkill: async (testId, on) => {
      const input = container.querySelector<HTMLInputElement>(`[data-test-id="${testId}"] .rw-settings-toggle input`);
      if (input === null) throw new Error(`no toggle for ${testId}`);
      if (input.disabled) throw new Error(`the toggle for ${testId} is disabled`);
      await act(async () => {
        input.click();
        for (let index = 0; index < 8; index += 1) await Promise.resolve();
      });
      void on;
    },
    calls: fragment => requests.filter(call => call.includes(fragment)),
    text: () => container.textContent.replace(/\s+/g, " "),
    page: async name => {
      const button = [...container.querySelectorAll<HTMLButtonElement>(".rw-settings-nav button")].find(item => item.textContent === name);
      await click(button);
    },
    selectSettingsProject: async projectId => {
      await pick(".rw-settings-scope select", projectId);
    },
    selectMachine: async machineId => {
      await pick(".rw-settings-content select", machineId);
    },
    reload: async () => {
      const button = container.querySelector<HTMLButtonElement>(".rw-settings-page-heading button");
      await click(button);
    },
    resolveHangedSkills: async () => {
      await act(async () => {
        for (const resolve of hangResolvers.splice(0)) resolve();
        await Promise.resolve();
      });
    },
    open: async (value: boolean) => {
      await act(async () => {
        setOpen(value);
        await Promise.resolve();
      });
      await flush();
    },
    unmount: async () => {
      await act(async () => {
        root.unmount();
        await Promise.resolve();
      });
      document.body.replaceChildren();
    },
  };
}

function local() {
  return { id: "local", name: "This machine", kind: "local", createdAt: STAMP, updatedAt: STAMP };
}

function lab() {
  return { id: "lab", name: "Lab Mac", kind: "remote", baseUrl: "https://lab.example", status: "online", createdAt: STAMP, updatedAt: STAMP };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function flush(): Promise<void> {
  return act(async () => {
    for (let turn = 0; turn < 8; turn += 1) await new Promise(resolve => setTimeout(resolve, 0));
  });
}

function scenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    projectsByMachine: { local: [autoToc], lab: [saytype] },
    skillsByProject: { "": [{ ...skillOf("machine-wide") }], "prj-auto-toc": [skillOf("release-notes")], "prj-saytype": [skillOf("lab-only")] },
    enabledSkillsAnswer: [],
    failSkills: false,
    hangSkillsFor: () => false,
    ...overrides,
  };
}

describe("React Settings data", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    document.body.replaceChildren();
  });

  it("renders the hook, so a settings read is reachable at all", async () => {
    const harness = await settingsHarness(scenario());
    expect(harness.data().settingsScopeKey).toBe(JSON.stringify(["local", undefined]));
    await harness.unmount();
  });

  it("reads the scope when Settings opens, and not one read before", async () => {
    const harness = await settingsHarness(scenario(), false);
    expect(harness.calls("pi-skills")).toEqual([]);
    expect(harness.calls("api/machines/local/config")).toEqual([]);

    await harness.open(true);

    expect(harness.calls("pi-skills")).toEqual(["GET http://localhost:3000/api/machines/local/pi-skills"]);
    await harness.page("Skills");
    expect(harness.text()).toContain("machine-wide");
    expect(harness.text()).not.toContain("Loading settings");
    await harness.unmount();
  });

  it("answers the Skills page from the project the page selects", async () => {
    const harness = await settingsHarness(scenario());
    await harness.page("Skills");
    await harness.selectSettingsProject(autoToc.id);
    await flush();
    expect(harness.calls("pi-skills").some(call => call.includes(`projectId=${autoToc.id}`))).toBe(true);
    expect(harness.text()).toContain("release-notes");
    expect(harness.text()).not.toContain("Loading settings");
    expect(harness.text()).not.toContain("have not been read yet");
    expect(harness.data().settings.loading).toBe(false);
    await harness.unmount();
  });

  it("keeps the read on the scope a machine switch moves to, and drops a project that machine does not have", async () => {
    const harness = await settingsHarness(scenario());
    await harness.page("Skills");
    await harness.selectSettingsProject(autoToc.id);
    await flush();
    expect(harness.data().settingsProjectId).toBe(autoToc.id);

    await harness.page("Machines");
    await harness.selectMachine("lab");
    await flush();

    const labSkillsReads = harness.calls("machines/lab/pi-skills");
    expect(labSkillsReads.length).toBeGreaterThan(0);
    expect(labSkillsReads.every(call => !call.includes("projectId"))).toBe(true);
    expect(harness.data().settingsProjectId).toBeUndefined();
    expect(harness.data().settings.skills).toBeDefined();
    expect(harness.data().settings.scopeKey).toBe(harness.data().settingsScopeKey);
    await harness.page("Skills");
    expect(harness.text()).toContain("machine-wide");
    expect(harness.text()).not.toContain("release-notes");
    await harness.unmount();
  });

  it("drops a late answer for a scope that has left the screen", async () => {
    const harness = await settingsHarness(scenario({ hangSkillsFor: url => url.includes(`projectId=${autoToc.id}`) }));
    await harness.page("Skills");
    await harness.selectSettingsProject(autoToc.id);
    await flush();

    await harness.page("Machines");
    await harness.selectMachine("lab");
    await flush();
    await harness.resolveHangedSkills();
    await harness.page("Skills");

    expect(harness.text()).not.toContain("release-notes");
    expect(harness.text()).toContain("machine-wide");
    await harness.unmount();
  });

  it("names a failed read as a failure and stops loading", async () => {
    const harness = await settingsHarness(scenario({ failSkills: true }));
    await harness.page("Skills");
    await flush();
    expect(harness.text()).not.toContain("Loading settings");
    expect(harness.data().settings.loading).toBe(false);
    expect(harness.data().settings.skills).toBeUndefined();
    expect(harness.text()).toContain("have not been read yet");
    expect(harness.text()).toMatch(/skills/i);
    expect(harness.text()).toMatch(/unreadable|Failed|failed|refused|not responding|error/i);
    await harness.unmount();
  });

  it("reads a scope once: opening, a machine switch and a project switch each read their own scope", async () => {
    const harness = await settingsHarness(scenario());
    expect(harness.calls("pi-skills")).toEqual(["GET http://localhost:3000/api/machines/local/pi-skills"]);
    await harness.page("Skills");
    await harness.selectSettingsProject(autoToc.id);
    await flush();
    expect(harness.calls(`pi-skills?projectId=${autoToc.id}`).length).toBe(1);

    await harness.page("Machines");
    await harness.selectMachine("lab");
    await flush();

    expect(harness.calls("machines/lab/pi-skills")).toEqual(["GET http://localhost:3000/api/machines/lab/pi-skills"]);
    expect(harness.calls("pi-skills").filter(call => call.includes("/lab/") && call.includes("projectId"))).toEqual([]);
    await harness.unmount();
  });

  it("re-reads the scope when the page reloads it", async () => {
    const harness = await settingsHarness(scenario());
    await harness.page("Skills");
    await flush();
    const before = harness.calls("pi-skills").length;
    await harness.reload();
    await flush();
    expect(harness.calls("pi-skills").length).toBeGreaterThan(before);
    expect(harness.text()).not.toContain("Loading settings");
    await harness.unmount();
  });

  it("keeps a project's skill rows when a global skill is written under that project scope", async () => {
    const machineWide = { ...skillOf("machine-wide"), id: "sk1:g:machine-wide", scope: "global", origin: "agent", source: "local" };
    const harness = await settingsHarness(scenario({
      skillsByProject: { "": [machineWide], "prj-auto-toc": [machineWide, skillOf("release-notes")], "prj-saytype": [] },
      enabledSkillsAnswer: [{ ...machineWide, enabled: false }],
    }));
    await harness.page("Skills");
    await harness.selectSettingsProject(autoToc.id);
    await flush();
    expect(harness.text()).toContain("release-notes");

    await harness.toggleSkill("react-skills-row-global-sk1:g:machine-wide", false);
    await flush();

    const rows = harness.data().settings.skills?.skills ?? [];
    expect(rows.some(row => row.scope === "project" && row.name === "release-notes")).toBe(true);
    expect(harness.text()).toContain("release-notes");
    expect(harness.data().settings.loading, "a single-list refresh drains its own read").toBe(false);
    expect(harness.text()).not.toContain("Loading settings");
    expect(harness.calls("pi-skills/set-enabled").length).toBe(1);
    expect(harness.calls(`pi-skills?projectId=${autoToc.id}`).length).toBe(2);
    expect(harness.text()).toContain("Skill saved");
    await harness.unmount();
  });
});
