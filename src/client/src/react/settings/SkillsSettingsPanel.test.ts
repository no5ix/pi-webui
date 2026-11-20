import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PiSkillInfo, PiSkillSetEnabledResponse, PiSkillsResponse, Project } from "../../api";
import type { SkillsSettingsPanelProps } from "./SkillsSettingsPanel";
import { SkillsSettingsPanel } from "./SkillsSettingsPanel";

// @vitest-environment happy-dom

const globalSkillFile = "/home/dev/.pi/agent/skills/reviews/review/SKILL.md";
const projectSkillFile = "/srv/repo/.pi/skills/notes/SKILL.md";
const globalSettings = "/home/dev/.pi/agent/settings.json";
const projectSettings = "/srv/repo/.pi/settings.json";

const project: Project = { id: "p1", name: "repo", path: "/srv/repo", createdAt: "2026-01-01T00:00:00.000Z" };

function skill(overrides: Partial<PiSkillInfo> = {}): PiSkillInfo {
  return {
    id: `global:${globalSkillFile}`,
    name: "review",
    description: "Review a pull request",
    filePath: globalSkillFile,
    baseDir: "/home/dev/.pi/agent/skills/reviews/review",
    scope: "global",
    origin: "agent",
    source: "user",
    preference: "enabled",
    answeredBy: "global",
    enabled: true,
    validation: "valid",
    ...overrides,
  };
}

function skillsResponse(overrides: Partial<PiSkillsResponse> = {}): PiSkillsResponse {
  return {
    skills: [skill({})],
    diagnostics: [],
    scopes: [
      { scope: "global", skillsDir: "/home/dev/.pi/agent/skills", configPath: globalSettings },
      { scope: "project", skillsDir: "/srv/repo/.pi/skills", configPath: projectSettings, projectId: "p1", projectTrusted: true },
    ],
    ...overrides,
  };
}

function answerFor(row: PiSkillInfo, requiresReload = true): PiSkillSetEnabledResponse {
  return { skills: [row], diagnostics: [], scopes: [], requiresReload };
}

describe("React Skills settings panel", () => {
  let container: HTMLDivElement;
  let root: Root;

  const render = async (props: Partial<SkillsSettingsPanelProps> = {}) => {
    await act(async () => {
      root.render(createElement(SkillsSettingsPanel, {
        skills: skillsResponse(),
        busy: false,
        machineLabel: "Workstation",
        projectName: project.name,
        projectScope: { projects: [project], projectId: project.id, onSelect: vi.fn() },
        onReload: vi.fn(),
        setEnabled: (row) => Promise.resolve(answerFor(row)),
        ...props,
      }));
      await Promise.resolve();
    });
  };

  const press = async (fn: () => void) => {
    await act(async () => {
      fn();
      await Promise.resolve();
    });
  };

  function button(label: string): HTMLButtonElement {
    const found = [...container.querySelectorAll("button")].find(node => node.textContent.includes(label));
    if (found === undefined) throw new Error(`The "${label}" button did not render.`);
    return found;
  }

  function toggle(row: Element): HTMLInputElement {
    const input = row.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (input === null) throw new Error("The row has no switch.");
    return input;
  }

  const rows = (testIdPrefix: string) => [...container.querySelectorAll(`[data-test-id^="${testIdPrefix}"]`)];

  const card = (testIdPrefix: string): Element => {
    const found = container.querySelector(`[data-test-id^="${testIdPrefix}"]`);
    if (found === null) throw new Error(`The ${testIdPrefix} row did not render.`);
    return found;
  };

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

  it("lists the machine's skills and the project's skills in sections that name their scope", async () => {
    await render({
      skills: skillsResponse({ skills: [skill({}), skill({ name: "notes", scope: "project", origin: "project", source: "project", filePath: projectSkillFile, baseDir: "/srv/repo/.pi/skills/notes", id: `project:${projectSkillFile}`, answeredBy: "project" })] }),
    });
    const titles = [...container.querySelectorAll(".rw-settings-section h4")].map(node => node.textContent);
    expect(titles).toContain("Project skills");
    expect(titles).toContain("Global skills");
    expect(rows("react-skills-row-project-")).toHaveLength(1);
    expect(rows("react-skills-row-global-")).toHaveLength(1);
    const projectRow = card("react-skills-row-project-");
    expect(projectRow.textContent).toContain(projectSkillFile);
    expect(projectRow.textContent).toContain("directory: /srv/repo/.pi/skills/notes");
    expect(projectRow.textContent).toContain("source: project");
    expect(projectRow.textContent).toContain("saved in project settings");
    const globalRow = card("react-skills-row-global-");
    expect(globalRow.textContent).toContain("source: user (global)");
    expect(globalRow.textContent).toContain("saved in global settings");
  });

  it("lists the directories pi searched and the settings file a switch writes", async () => {
    await render();
    const help = [...container.querySelectorAll(".rw-settings-help")].map(node => node.textContent).join("\n");
    expect(help).toContain("Global skills: /home/dev/.pi/agent/skills · settings: /home/dev/.pi/agent/settings.json");
    expect(help).toContain("Project skills: /srv/repo/.pi/skills · settings: /srv/repo/.pi/settings.json");
    expect(container.textContent).toContain("Skills are instructions pi is told to follow");
    expect(container.textContent).toContain("/reload");
  });

  it("writes a project row's switch as a project preference, and carries pi's reload note", async () => {
    const projectRow = skill({ name: "notes", scope: "project", origin: "project", source: "project", filePath: projectSkillFile, baseDir: "/srv/repo/.pi/skills/notes", id: `project:${projectSkillFile}`, answeredBy: "project", enabled: false, preference: "disabled" });
    const setEnabled = vi.fn(() => Promise.resolve(answerFor(projectRow)));
    await render({ skills: skillsResponse({ skills: [projectRow] }), setEnabled });
    const project = card("react-skills-row-project-");
    expect(project.textContent).toContain("Off");
    await press(() => { toggle(project).click(); });
    expect(setEnabled).toHaveBeenCalledWith(projectRow, true);
    expect(container.textContent).toContain("Project skills saved — enabled. Reload running sessions to apply it.");
  });

  it("writes a global row's switch as a machine preference", async () => {
    const setEnabled = vi.fn(() => Promise.resolve(answerFor(skill({}), false)));
    await render({ setEnabled });
    await press(() => { toggle(card("react-skills-row-global-")).click(); });
    expect(setEnabled).toHaveBeenCalledWith(skill({}), false);
    expect(container.textContent).toContain("Global skills saved — disabled.");
  });

  it("keeps a package's skill off this page's reach and says where to turn it on", async () => {
    const row = skill({ ownerPackageDisabled: true, packageSource: "npm:toolkit" });
    const setEnabled = vi.fn(() => Promise.resolve(answerFor(row)));
    await render({ skills: skillsResponse({ skills: [row] }), setEnabled });
    const cardRow = card("react-skills-row-global-");
    const input = toggle(cardRow);
    expect(input.disabled).toBe(true);
    expect(cardRow.textContent).toContain("Supplied by npm:toolkit that is turned off");
    const label = input.closest("label");
    expect(label?.title).toContain("enable it in the package settings, not in the skill settings");
  });

  it("shows a definition pi refused, a skill a stronger source shadows, and a name answered in both scopes", async () => {
    const shadowed = skill({ shadowed: true });
    const fixed = skill({ name: "review", scope: "project", origin: "project", id: `project:${projectSkillFile}`, filePath: projectSkillFile, baseDir: "/srv/repo/.pi/skills/notes" });
    await render({ skills: skillsResponse({ skills: [shadowed, fixed] }) });
    const cards = [...container.querySelectorAll(".rw-settings-card")];
    expect(cards.map(card => card.textContent).join(" ")).toContain("a stronger source is the one pi keeps");
    expect(cards.map(card => card.textContent).join(" ")).toContain('The name "review" is also answered for the project scope');
  });

  it("shows a validation problem as the file to open", async () => {
    await render({ skills: skillsResponse({ skills: [skill({ validation: "warning", validationMessage: "name does not match the directory" })] }) });
    expect(container.querySelector(".rw-settings-card-diagnostic")?.textContent)
      .toBe(`Validation warning: name does not match the directory — edit ${globalSkillFile}`);
  });

  it("reports pi's diagnostics and the skill files it could not read, so a short list is not silently short", async () => {
    await render({
      skills: skillsResponse({
        diagnostics: [{ message: "no skills directory", path: "/srv/repo/.pi/skills" }],
        unreadablePaths: [{ message: "permission denied", path: "/home/dev/.pi/agent/skills/secret/SKILL.md" }],
      }),
    });
    const alerts = [...container.querySelectorAll(".rw-settings-notice")].map(node => node.textContent).join("\n");
    expect(alerts).toContain("/srv/repo/.pi/skills — no skills directory");
    expect(alerts).toContain("/home/dev/.pi/agent/skills/secret/SKILL.md — permission denied");
  });

  it("says that a page with no project reads no project skills, and offers the project selector", async () => {
    const onSelect = vi.fn();
    await render({
      skills: skillsResponse({ skills: [skill({})] }),
      projectScope: { projects: [project], projectId: undefined, onSelect },
    });
    expect(container.textContent).toContain("No project is selected, so project skills are not read");
    const select = container.querySelector<HTMLSelectElement>(".rw-settings-scope select");
    if (select === null) throw new Error("The project selector did not render.");
    expect(select.value).toBe("");
    await press(() => {
      select.value = "p1";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onSelect).toHaveBeenCalledWith("p1");
  });

  it("answers a project with no skills, and a machine with none, in their own words", async () => {
    await render({ skills: skillsResponse({ skills: [] }) });
    expect(container.textContent).toContain("This project has no skills");
    expect(container.textContent).toContain("No skills were returned for this machine");
  });

  it("reloads the page's answer when asked", async () => {
    const onReload = vi.fn();
    await render({ onReload });
    await press(() => { button("Reload").click(); });
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it("keeps the row on screen and reports the refusal when the machine says no", async () => {
    await render({ setEnabled: () => Promise.reject(new Error("project is not trusted")) });
    await press(() => { toggle(card("react-skills-row-global-")).click(); });
    expect(container.querySelector(".rw-settings-notice.is-danger")?.textContent).toContain("project is not trusted");
    expect(rows("react-skills-row-global-")).toHaveLength(1);
  });

  it("blocks every control while a write is in flight, and names the row that is working", async () => {
    let release: () => void = () => { throw new Error("the operation never started"); };
    const onReload = vi.fn();
    await render({
      setEnabled: () => new Promise<PiSkillSetEnabledResponse>(resolve => {
        release = () => { resolve(answerFor(skill({}))); };
      }),
      onReload,
    });
    await press(() => { toggle(card("react-skills-row-global-")).click(); });
    expect(container.textContent).toContain("Disabling review — skill controls are disabled while it runs");
    expect(toggle(card("react-skills-row-global-")).disabled).toBe(true);
    await press(() => { release(); });
    expect(toggle(card("react-skills-row-global-")).disabled).toBe(false);
  });
});
