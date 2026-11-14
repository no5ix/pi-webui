import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectTrustStore } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PiSkillPreferenceConfig, PiSkillsResponse } from "../../shared/apiTypes.js";
import {
  DefaultPiSkillsService,
  describeUnreadableSkillsDir,
  PiSkillNotFoundError,
  PiSkillsRequestError,
  type DiscoveredSkill,
  projectSkillTrust,
  type PiSkillDiscoveryPort,
  type SkillDiscovery,
  type SkillPreferencesStore,
} from "./piSkillsService";
import { SettingsProjectError, type SettingsProjectResolver } from "../shared/resources/settingsProjectResolver.js";
import type { LoadedSkillPreferences } from "../../config.js";
import type { LoadedProjectSkillPreferences } from "../shared/resources/skillPreferences.js";

/**
 * The Skills panel's service.
 *
 * Pi discovers skills; PI WEB owns the preference that takes one out. These tests pin the seam
 * between them: what a scope is allowed to show, which answer wins when the two scopes disagree,
 * and that a switch writes only the scope the request named.
 */

const skill = (name: string, overrides: Partial<DiscoveredSkill> = {}): DiscoveredSkill => ({
  name,
  description: `${name} description`,
  filePath: `/home/test/.pi/skills/${name}/SKILL.md`,
  baseDir: `/home/test/.pi/skills/${name}`,
  source: "user",
  piScope: "user",
  disableModelInvocation: false,
  ...overrides,
});

function discovery(skills: DiscoveredSkill[], diagnostics: { path: string; message: string }[] = []): PiSkillDiscoveryPort {
  return {
    discover: (projectPath) => {
      const skillsDirs: SkillDiscovery["skillsDirs"] = [{ scope: "global", path: "/home/test/.pi/skills" }];
      if (projectPath !== undefined) skillsDirs.push({ scope: "project", path: `${projectPath}/.pi/skills` });
      return Promise.resolve({ skills, diagnostics, unreadablePaths: [], skillsDirs } satisfies SkillDiscovery);
    },
  };
}

function preferences(global: PiSkillPreferenceConfig = {}, project: PiSkillPreferenceConfig = {}) {
  const saved = { global, project };
  const writeGlobal = vi.fn<SkillPreferencesStore["writeGlobal"]>((config) => {
    saved.global = config;
    return { path: "/home/test/.pi-web/config.json", exists: true, config };
  });
  const writeProject = vi.fn<SkillPreferencesStore["writeProject"]>((projectPath, config) => {
    saved.project = config;
    return { projectPath, path: `${projectPath}/.pi-web/config.json`, exists: true, config };
  });
  const store: SkillPreferencesStore = {
    readGlobal: () => ({ path: "/home/test/.pi-web/config.json", exists: true, config: saved.global }),
    writeGlobal,
    readProject: (projectPath) => ({ projectPath, path: `${projectPath}/.pi-web/config.json`, exists: true, config: saved.project }),
    writeProject,
  };
  return { store, saved, writeGlobal, writeProject };
}

const projects: SettingsProjectResolver = {
  requireProjectPath: (projectId) => {
    if (projectId !== "p-1") throw new SettingsProjectError(404, `Project ${projectId} was not found`);
    return Promise.resolve("/work/project");
  },
  isProjectTrusted: () => true,
};

const untrusted: SettingsProjectResolver = { ...projects, isProjectTrusted: () => false };

function service(port: PiSkillDiscoveryPort, store: SkillPreferencesStore, resolver: SettingsProjectResolver = projects) {
  return new DefaultPiSkillsService(port, store, resolver);
}

function scopeNames(response: PiSkillsResponse): string[] {
  return response.scopes.map((scope) => scope.scope);
}

describe("listing skills", () => {
  it("reports the global scope, and says it did not read a project", async () => {
    const listed = await service(discovery([skill("pdf")]), preferences().store).list({});

    expect(scopeNames(listed)).toEqual(["global"]);
    expect(listed.scopes[0]).toMatchObject({ scope: "global", skillsDir: "/home/test/.pi/skills", configPath: "/home/test/.pi-web/config.json" });
    expect(listed.skills).toEqual([expect.objectContaining({ name: "pdf", scope: "global", origin: "agent", source: "user", enabled: true, preference: "default", validation: "valid", filePath: "/home/test/.pi/skills/pdf/SKILL.md", baseDir: "/home/test/.pi/skills/pdf" })]);
  });

  it("adds the project scope when the request names a project", async () => {
    const listed = await service(discovery([
      skill("pdf"),
      skill("release", { piScope: "project", source: "project", filePath: "/work/project/.pi/skills/release/SKILL.md", baseDir: "/work/project/.pi/skills/release" }),
    ]), preferences().store).list({ projectId: "p-1" });

    expect(scopeNames(listed)).toEqual(["global", "project"]);
    const project = listed.scopes[1];
    expect(project).toMatchObject({ scope: "project", skillsDir: "/work/project/.pi/skills", projectId: "p-1", projectPath: "/work/project", projectTrusted: true });
    expect(listed.skills.map((entry) => `${entry.scope}:${entry.name}`)).toEqual(["global:pdf", "project:release"]);
  });

  it("says a project's scope was not read when the project is not trusted", async () => {
    const listed = await service(discovery([skill("pdf")]), preferences().store, untrusted).list({ projectId: "p-1" });

    expect(listed.scopes[1]).toMatchObject({ scope: "project", projectId: "p-1", projectPath: "/work/project", projectTrusted: false });
    expect(listed.skills.filter((entry) => entry.scope === "project")).toEqual([]);
  });

  it("marks a skill the global preference disabled, and keeps the rest of the row honest", async () => {
    const listed = await service(discovery([skill("pdf"), skill("other")]), preferences({ version: 1, disabled: ["pdf"] }).store).list({});

    expect(listed.skills[0]).toMatchObject({ name: "pdf", enabled: false, preference: "disabled" });
    expect(listed.skills[1]).toMatchObject({ name: "other", enabled: true, preference: "default" });
  });

  it("classifies a configured skills path inside the selected repository as project-owned", async () => {
    const repositorySkill = skill("changeset-changelog", {
      piScope: "user", source: "local",
      filePath: "/work/project/.agents/skills/changeset-changelog/SKILL.md",
      baseDir: "/work/project/.agents/skills/changeset-changelog",
    });
    const listed = await service(discovery([repositorySkill]), preferences({ version: 1, disabled: ["changeset-changelog"] }).store).list({ projectId: "p-1" });
    expect(listed.skills[0]).toMatchObject({ scope: "project", origin: "project", name: "changeset-changelog", enabled: true, preference: "default" });
  });

  it("keeps a global configured skill global when it lives outside the selected repository", async () => {
    const globalConfiguredSkill = skill("shared-helper", { piScope: "user", source: "local", filePath: "/home/test/shared/skills/shared-helper/SKILL.md" });
    const listed = await service(discovery([globalConfiguredSkill]), preferences().store).list({ projectId: "p-1" });
    expect(listed.skills[0]).toMatchObject({ scope: "global", origin: "path", name: "shared-helper" });
  });

  it("lets a project's preference answer for that project, and only for it", async () => {
    const store = preferences({ version: 1, disabled: ["pdf"] }, { version: 1, disabled: ["release"], enabled: ["pdf"] }).store;

    const forProject = await service(discovery([
      skill("pdf"),
      skill("release", { piScope: "project", source: "project", filePath: "/work/project/.pi/skills/release/SKILL.md", baseDir: "/work/project/.pi/skills/release" }),
    ]), store).list({ projectId: "p-1" });
    const globalOnly = await service(discovery([skill("pdf")]), store).list({});

    expect(forProject.scopes[1]).toMatchObject({ scope: "project", configPath: "/work/project/.pi-web/config.json" });
    expect(forProject.skills[0]).toMatchObject({ scope: "global", name: "pdf", preference: "enabled", enabled: true });
    expect(forProject.skills[1]).toMatchObject({ scope: "project", name: "release", preference: "disabled", enabled: false });
    expect(forProject.skills.some((entry) => entry.name === "pdf" && entry.scope === "project")).toBe(false);
    expect(globalOnly.skills[0]).toMatchObject({ scope: "global", name: "pdf", preference: "disabled", enabled: false });
    expect(scopeNames(globalOnly)).toEqual(["global"]);
  });

  it("names the package a skill came from, and says when that package is configured off", async () => {
    const listed = await service(discovery([
      skill("charts", { source: "npm:@acme/skills", packageSource: "npm:@acme/skills" }),
      skill("legacy", { source: "npm:@acme/old", packageSource: "npm:@acme/old", ownerPackageDisabled: true }),
    ]), preferences().store).list({});

    expect(listed.skills[0]).toMatchObject({ name: "charts", origin: "package", packageSource: "npm:@acme/skills", enabled: true });
    expect(listed.skills[1]).toMatchObject({ name: "legacy", origin: "package", packageSource: "npm:@acme/old", ownerPackageDisabled: true, enabled: false });
  });

  it("carries the diagnostics pi reported, including a skill path it could not read", async () => {
    const listed = await service(discovery([skill("pdf")], [{ path: "/home/test/.pi/skills/broken", message: "no SKILL.md" }]), preferences().store).list({});

    expect(listed.diagnostics).toEqual([{ path: "/home/test/.pi/skills/broken", message: "no SKILL.md" }]);
  });

  it("refuses a project the machine does not know", async () => {
    await expect(service(discovery([]), preferences().store).list({ projectId: "p-9" })).rejects.toBeInstanceOf(SettingsProjectError);
  });
});

describe("changing a skill's preference", () => {
  it("writes the global scope, and returns the list that follows", async () => {
    const { store, writeGlobal, writeProject } = preferences();

    const response = await service(discovery([skill("pdf")]), store).setEnabled({ name: "pdf", scope: "global", enabled: false });

    expect(writeGlobal).toHaveBeenCalledWith({ version: 1, disabled: ["pdf"] });
    expect(writeProject).not.toHaveBeenCalled();
    expect(response.requiresReload).toBe(true);
    expect(response.skills[0]).toMatchObject({ name: "pdf", scope: "global", enabled: false, preference: "disabled" });
  });

  it("turns on a globally disabled skill for one project and returns the effective state", async () => {
    const { store, saved, writeGlobal, writeProject } = preferences({ version: 1, disabled: ["nestjs-code-audit"] });
    const response = await service(discovery([skill("nestjs-code-audit")]), store).setEnabled({
      name: "nestjs-code-audit", scope: "project", projectId: "p-1", enabled: true,
    });

    expect(writeProject).toHaveBeenCalledWith("/work/project", { version: 1, enabled: ["nestjs-code-audit"] });
    expect(writeGlobal).not.toHaveBeenCalled();
    expect(saved.global.disabled).toEqual(["nestjs-code-audit"]);
    expect(response.skills[0]).toMatchObject({ name: "nestjs-code-audit", scope: "global", enabled: true, preference: "enabled" });
    const projectRead = await service(discovery([skill("nestjs-code-audit")]), store).list({ projectId: "p-1" });
    const globalRead = await service(discovery([skill("nestjs-code-audit")]), store).list({});
    expect(projectRead.skills[0]).toMatchObject({ enabled: true, preference: "enabled" });
    expect(globalRead.skills[0]).toMatchObject({ enabled: false, preference: "disabled" });
  });

  it("writes the project scope for one project, and leaves the global file alone", async () => {
    const { store, writeGlobal, writeProject } = preferences();

    const response = await service(discovery([skill("pdf", { piScope: "project", source: "project" })]), store).setEnabled({ name: "pdf", scope: "project", projectId: "p-1", enabled: false });

    expect(writeProject).toHaveBeenCalledWith("/work/project", { version: 1, disabled: ["pdf"] });
    expect(writeGlobal).not.toHaveBeenCalled();
    expect(response.scopes[1]).toMatchObject({ scope: "project", projectPath: "/work/project", configPath: "/work/project/.pi-web/config.json" });
  });

  it("refuses a project-scope preference that names no project", async () => {
    const { store, writeProject } = preferences();

    await expect(service(discovery([skill("pdf")]), store).setEnabled({ name: "pdf", scope: "project", enabled: false })).rejects.toBeInstanceOf(PiSkillsRequestError);
    expect(writeProject).not.toHaveBeenCalled();
  });

  it("refuses a name the requested scope does not offer, so a typo leaves no preference behind", async () => {
    const { store, writeGlobal } = preferences();

    await expect(service(discovery([skill("pdf")]), store).setEnabled({ name: "pfd", scope: "global", enabled: false })).rejects.toBeInstanceOf(PiSkillNotFoundError);
    expect(writeGlobal).not.toHaveBeenCalled();
  });

  it("refuses an empty name", async () => {
    await expect(service(discovery([skill("pdf")]), preferences().store).setEnabled({ name: "   ", scope: "global", enabled: true })).rejects.toBeInstanceOf(PiSkillsRequestError);
  });

  it("applies the preferences of one project to that project's list only", async () => {
    const projectStore: SkillPreferencesStore = {
      readGlobal: () => ({ path: "/g", exists: true, config: {} }),
      writeGlobal: vi.fn((config: PiSkillPreferenceConfig): LoadedSkillPreferences => ({ path: "/g", exists: true, config })),
      readProject: (projectPath): LoadedProjectSkillPreferences => ({ projectPath, path: `${projectPath}/.pi-web/config.json`, exists: true, config: projectPath === "/work/project" ? { version: 1, disabled: ["release"] } : {} }),
      writeProject: vi.fn((projectPath: string, config: PiSkillPreferenceConfig): LoadedProjectSkillPreferences => ({ projectPath, path: `${projectPath}/.pi-web/config.json`, exists: true, config })),
    };
    const scoped: SettingsProjectResolver = {
      requireProjectPath: (projectId) => Promise.resolve(projectId === "p-1" ? "/work/project" : "/work/other"),
      isProjectTrusted: () => true,
    };

    const projectSkill = skill("release", { piScope: "project", source: "project", filePath: "/work/project/.pi/skills/release/SKILL.md", baseDir: "/work/project/.pi/skills/release" });
    const one = await service(discovery([projectSkill]), projectStore, scoped).list({ projectId: "p-1" });
    const two = await service(discovery([projectSkill]), projectStore, scoped).list({ projectId: "p-2" });

    expect(one.skills[0]).toMatchObject({ scope: "project", name: "release", enabled: false, preference: "disabled" });
    expect(two.skills[0]).toMatchObject({ scope: "project", name: "release", enabled: true, preference: "default" });
  });
});

describe("the trust answer the skills list is built on", () => {
  let root: string;
  let agentDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "pi-web-skill-trust-"));
    agentDir = join(root, "agent");
    mkdirSync(agentDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function project(name: string, shipsSkills: boolean): string {
    const path = join(root, name);
    mkdirSync(path, { recursive: true });
    if (shipsSkills) {
      mkdirSync(join(path, ".pi/skills/notes"), { recursive: true });
      writeFileSync(join(path, ".pi/skills/notes/SKILL.md"), "---\nname: notes\ndescription: Notes.\n---\n", "utf8");
    }
    return path;
  }

  it("asks pi's rule, so the rows and the project row cannot give two answers about one project", () => {
    const shipsSkills = project("ships-skills", true);
    const plain = project("plain", false);

    expect(projectSkillTrust(agentDir, undefined)).toBe(true);
    expect(projectSkillTrust(agentDir, plain)).toBe(true);
    expect(projectSkillTrust(agentDir, shipsSkills)).toBe(false);

    new ProjectTrustStore(agentDir).set(shipsSkills, true);

    expect(projectSkillTrust(agentDir, shipsSkills)).toBe(true);
  });
});

describe("a skills directory that cannot be read", () => {
  it("reports the skills as not known, naming the directory and the reason", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-web-skills-locked-"));
    const skillsDir = join(root, "skills");
    mkdirSync(skillsDir, { recursive: true });
    mkdirSync(join(skillsDir, "pdf"));
    writeFileSync(join(skillsDir, "pdf", "SKILL.md"), "---\nname: pdf\n---\nRead and write PDF documents.\n");
    chmodSync(skillsDir, 0o000);
    try {
      const diagnostic = await describeUnreadableSkillsDir(skillsDir);

      expect(diagnostic?.path).toBe(skillsDir);
      expect(diagnostic?.message).toContain("could not be listed");
      expect(diagnostic?.message).toMatch(/EACCES|EPERM/);
    } finally {
      chmodSync(skillsDir, 0o755);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports nothing for a skills directory that is simply not there, because that absence is empty", async () => {
    expect(await describeUnreadableSkillsDir(join(tmpdir(), "pi-web-no-such-skills-dir"))).toBeUndefined();
  });
});
