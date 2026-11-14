// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { PiSkillInfo, PiSkillsResponse } from "../../api";
import { SettingsSkillsPanel } from "./SettingsSkillsPanel";
import type { SettingsMachineTarget } from "./settingsMachineTarget";

const remoteTarget: SettingsMachineTarget = { id: "lab-mac", name: "Lab Mac", kind: "remote" };

afterEach(() => {
  document.body.replaceChildren();
});

function skill(name: string, overrides: Partial<PiSkillInfo> = {}): PiSkillInfo {
  return {
    name,
    description: `What ${name} does`,
    filePath: `/pi/skills/${name}/SKILL.md`,
    baseDir: `/pi/skills/${name}`,
    scope: "global",
    origin: "agent",
    source: "user",
    preference: "default",
    enabled: true,
    validation: "valid",
    ...overrides,
  };
}

async function mount(configure: (panel: SettingsSkillsPanel) => void = () => undefined): Promise<SettingsSkillsPanel> {
  const panel = new SettingsSkillsPanel();
  configure(panel);
  document.body.append(panel);
  await panel.updateComplete;
  return panel;
}

function panelText(panel: SettingsSkillsPanel): string {
  const parts: string[] = [];
  visit(panel.shadowRoot);
  return parts.join(" ");

  function visit(root: ShadowRoot | null): void {
    if (root === null) return;
    parts.push(root.textContent);
    for (const child of Array.from(root.querySelectorAll<HTMLElement>("*"))) visit(child.shadowRoot);
  }
}

/**
 * One recorded skill toggle.
 *
 * A row whose switch was never routed fails here with the index that is missing, instead of the
 * assertions quietly reading `undefined` and passing on the shape of nothing.
 */
function recordedToggle(toggle: { mock: { calls: [PiSkillInfo, boolean][] } }, index: number): [PiSkillInfo, boolean] {
  const call = toggle.mock.calls[index];
  if (call === undefined) throw new Error(`Expected recorded skill toggle ${String(index)}`);
  return call;
}

function switches(panel: SettingsSkillsPanel): HTMLInputElement[] {
  return Array.from(panel.shadowRoot?.querySelectorAll<HTMLInputElement>(".toggle input") ?? []);
}

function flip(input: HTMLInputElement, checked: boolean): void {
  input.checked = checked;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("settings-skills-panel", () => {
  it("says the list is not loaded, and never that the machine has no skills, when no response arrived", async () => {
    const panel = await mount((element) => {
      element.targetMachine = remoteTarget;
      element.error = "Failed to load skills from Lab Mac (remote machine): Could not reach Lab Mac · trying again…";
    });

    const text = panelText(panel);
    expect(text).toContain("Skill list not loaded yet for Lab Mac (remote machine) · trying again…");
    expect(text).toContain("Could not reach Lab Mac");
    expect(text).not.toContain("No skills are configured");
    expect(switches(panel)).toHaveLength(0);
  });

  it("lists every skill with its scope, origin, paths, saved preference and what Pi loaded", async () => {
    const response: PiSkillsResponse = {
      skills: [
        skill("commit"),
        skill("deploy", { scope: "project", origin: "package", source: "npm:@acme/tools", packageSource: "npm:@acme/tools", filePath: "/pkg/skills/deploy/SKILL.md", baseDir: "/pkg/skills/deploy" }),
      ],
      diagnostics: [],
      scopes: [
        { scope: "global", skillsDir: "/pi/skills", configPath: "/config/pi-web/config.json" },
        { scope: "project", skillsDir: "/repo/.pi/skills", configPath: "/repo/.pi-web/config.json", projectId: "p 1", projectPath: "/repo", projectTrusted: true },
      ],
    };
    const panel = await mount((element) => {
      element.skillsResponse = response;
    });

    const text = panelText(panel);
    expect(text).toContain("Global skills");
    expect(text).toContain("Project skills");
    expect(text).toContain("commit");
    expect(text).toContain("Pi skill folder");
    expect(text).toContain("/pi/skills/commit/SKILL.md");
    expect(text).toContain("No saved preference: Pi decides");
    expect(text).toContain("In the list Pi is given");
    expect(text).toContain("Pi package");
    expect(text).toContain("Supplied by Pi package: npm:@acme/tools");
    expect(text).toContain("Skills directory: /repo/.pi/skills");
    expect(text).toContain("Saved preference: /repo/.pi-web/config.json");
    expect(text).toContain("Project scope read from /repo.");
    expect(text.indexOf("Project skills")).toBeLessThan(text.indexOf("Global skills"));
    expect(switches(panel)).toHaveLength(2);
  });

  it("names the package that keeps a skill out of the list, and Pi's own diagnostic", async () => {
    const panel = await mount((element) => {
      element.skillsResponse = {
        skills: [skill("deploy", { enabled: false, preference: "default", origin: "package", source: "npm:@acme/tools", packageSource: "npm:@acme/tools", ownerPackageDisabled: true }), skill("shadowed", { shadowed: true, validation: "warning", validationMessage: "Front matter is missing a name" })],
        diagnostics: [{ message: "Skill path collided", path: "/pi/skills/notes" }],
        scopes: [{ scope: "global", skillsDir: "/pi/skills", configPath: "/config/pi-web/config.json" }],
      };
    });

    const text = panelText(panel);
    expect(text).toContain("Off because its Pi package npm:@acme/tools is turned off");
    expect(text).toContain("A skill named shadowed from a stronger source is the one Pi uses");
    expect(text).toContain("Front matter is missing a name");
    expect(text).toContain("Skill path collided");
    expect(text).toContain("Not in the list Pi is given");
  });

  it("renders the project selector visibly before the skill response is available", async () => {
    const onSelectProject = vi.fn<(projectId: string | undefined) => void>();
    const panel = await mount((element) => {
      element.projects = [{ id: "p-1", name: "Work", path: "/work", createdAt: "2026-01-01T00:00:00.000Z" }];
      element.projectSelection = "p-1";
      element.onSelectProject = onSelectProject;
      element.loading = true;
    });

    const selector = panel.shadowRoot?.querySelector<HTMLSelectElement>("#skills-project");
    expect(selector).not.toBeNull();
    expect(selector?.value).toBe("p-1");
    expect(selector?.querySelector('option[value="p-1"]')?.textContent).toBe("Work");
    expect(panelText(panel)).toContain("Loading skills");
    if (selector === null || selector === undefined) throw new Error("Expected a rendered Skills project selector");
    selector.value = "";
    selector.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onSelectProject).toHaveBeenCalledWith(undefined);
  });

  it("routes the switch a reader flips, with the row it was flipped on", async () => {
    const onToggleSkill = vi.fn<(skill: PiSkillInfo, enabled: boolean) => void>();
    const panel = await mount((element) => {
      element.skillsResponse = {
        skills: [skill("commit"), skill("notes", { enabled: false, preference: "disabled" })],
        diagnostics: [],
        scopes: [{ scope: "global", skillsDir: "/pi/skills", configPath: "/config/pi-web/config.json" }],
      };
      element.onToggleSkill = onToggleSkill;
    });

    const [first, second] = switches(panel);
    if (first === undefined || second === undefined) throw new Error("Expected a switch on each skill row");
    flip(first, false);
    flip(second, true);

    expect(onToggleSkill).toHaveBeenCalledTimes(2);
    expect(recordedToggle(onToggleSkill, 0)[0].name).toBe("commit");
    expect(recordedToggle(onToggleSkill, 0)[1]).toBe(false);
    expect(recordedToggle(onToggleSkill, 1)[0].name).toBe("notes");
    expect(recordedToggle(onToggleSkill, 1)[1]).toBe(true);
  });

  it("marks a global skill as saving when the selected project's preference is being written", async () => {
    const panel = await mount((element) => {
      element.projectSelection = "p-1";
      element.skillsResponse = {
        skills: [skill("commit")], diagnostics: [],
        scopes: [
          { scope: "global", skillsDir: "/pi/skills", configPath: "/config/pi-web/config.json" },
          { scope: "project", skillsDir: "/work/.pi/skills", configPath: "/work/.pi-web/config.json", projectId: "p-1", projectPath: "/work", projectTrusted: true },
        ],
      };
      element.operation = { name: "commit", scope: "project", enabled: false };
    });
    expect(panelText(panel)).toContain("Saving…");
    expect(switches(panel)[0]?.disabled).toBe(true);
  });

  it("marks a row as saving while its switch is in flight, and every switch waits for it", async () => {
    const panel = await mount((element) => {
      element.skillsResponse = { skills: [skill("commit")], diagnostics: [], scopes: [{ scope: "global", skillsDir: "/pi/skills", configPath: "/config/pi-web/config.json" }] };
      element.operation = { name: "commit", scope: "global", enabled: false };
    });

    const [input] = switches(panel);
    expect(panelText(panel)).toContain("Saving…");
    expect(input?.disabled).toBe(true);
  });

  it("calls an unread project scope not read, and an empty directory empty, in the same answer", async () => {
    const panel = await mount((element) => {
      element.skillsResponse = { skills: [], diagnostics: [], scopes: [{ scope: "global", skillsDir: "/pi/skills", configPath: "/config/pi-web/config.json" }] };
    });

    const text = panelText(panel);
    expect(text).toContain("Project scope not read: PI WEB Settings has no project selected");
    expect(text).toContain("No skills are configured in /pi/skills.");
    expect(text).not.toContain("No skills anywhere");
  });

  it("calls a skills directory it could not read a list that is not known, never an empty one", async () => {
    const panel = await mount((element) => {
      element.skillsResponse = {
        skills: [],
        diagnostics: [],
        scopes: [{ scope: "global", skillsDir: "/pi/skills", configPath: "/config/pi-web/config.json" }],
        unreadablePaths: [{ path: "/pi/skills", message: "permission denied" }],
      };
    });

    const text = panelText(panel);
    expect(text).toContain("The skills in /pi/skills were not read, so this list is not known.");
    expect(text).not.toContain("No skills are configured in /pi/skills.");
  });

  it("names the scope, not a blank, when a skills directory is left unnamed", async () => {
    const panel = await mount((element) => {
      element.skillsResponse = { skills: [], diagnostics: [], scopes: [{ scope: "global", skillsDir: "", configPath: "/config/pi-web/config.json" }] };
    });

    const text = panelText(panel);
    expect(text).toContain("No global skills are listed.");
    expect(text).not.toContain("configured in .");
  });

  it("says the project scope was not read because the project is not trusted, in its own words", async () => {
    const panel = await mount((element) => {
      element.skillsResponse = {
        skills: [],
        diagnostics: [],
        scopes: [
          { scope: "global", skillsDir: "/pi/skills", configPath: "/config/pi-web/config.json" },
          { scope: "project", skillsDir: "", configPath: "/repo/.pi-web/config.json", projectPath: "/repo", projectTrusted: false },
        ],
      };
    });

    expect(panelText(panel)).toContain("Project scope not read: /repo is not trusted");
  });
});
