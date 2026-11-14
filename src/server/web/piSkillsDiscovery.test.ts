import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { createPiSkillDiscovery } from "./piSkillsService.js";

/**
 * The Skills panel's discovery, measured against the real Pi resource loader.
 *
 * Pi keeps one skill per name and keeps the first it reads, so "which skill of this name a session
 * gets" is a fact about the loader, not about the files on disk. The panel says which skill is in the
 * list Pi is given, so it has to read the loader's list. This test builds the files Pi reads - a
 * machine-wide skill and a project's own skill that carry one name - and asks both producers the same
 * question. It is the check the panel used to fail: it added Pi's default directories on top of the
 * configured paths, which made the machine-wide skill win the name while a session loads the project's
 * own skill, so the panel reported the opposite of the session (found in a live browser run, 2026-11-14).
 */

const roots: string[] = [];

function skillFile(directory: string, name: string, description: string): string {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, "SKILL.md");
  writeFileSync(path, `---\nname: ${name}\ndescription: ${description}\n---\nBody of ${description}.\n`, "utf8");
  return path;
}

interface Fixture {
  agentDir: string;
  projectPath: string;
  globalSkill: string;
  projectSkill: string;
  name: string;
}

function fixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "pi-web-skill-discovery-"));
  roots.push(root);
  const agentDir = join(root, "agent");
  mkdirSync(join(root, "project"), { recursive: true });
  const projectPath = realpathSync(join(root, "project"));
  // A name this machine cannot already have: Pi always reads ~/.agents/skills, and a fixture that
  // collided with a real skill there would measure the developer's machine instead of the loader.
  const name = `pi-web-fixture-audit-${Math.random().toString(36).slice(2, 10)}`;
  const globalSkill = skillFile(join(agentDir, "skills", "audit"), name, "Machine-wide audit skill.");
  const projectSkill = skillFile(join(projectPath, ".pi", "skills", "audit"), name, "Project-owned audit skill.");
  // Pi's trust store keys the resolved path, and a temp dir on macOS sits behind a symlink: an
  // untrusted project contributes no skills, which would test trust instead of the loader's order.
  writeFileSync(join(agentDir, "trust.json"), `${JSON.stringify({ [projectPath]: true }, null, 2)}\n`, "utf8");
  expect(existsSync(globalSkill) && existsSync(projectSkill)).toBe(true);
  return { agentDir, projectPath, globalSkill, projectSkill, name };
}

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

/** The skills a Pi session is given, read by Pi's own resource loader the way the session daemon builds it. */
async function sessionSkillPaths(agentDir: string, projectPath: string): Promise<string[]> {
  const settingsManager = SettingsManager.create(projectPath, agentDir, { projectTrusted: true });
  const loader = new DefaultResourceLoader({
    cwd: projectPath,
    agentDir,
    settingsManager,
    noExtensions: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    skillsOverride: (base) => base,
  });
  await loader.reload();
  return loader.getSkills().skills.map((skill) => skill.filePath);
}

describe("the Skills panel reads the list a Pi session is given", () => {
  it("shows the skill Pi's loader keeps for a shared name, and marks the one it shadowed", async () => {
    const { agentDir, projectPath, globalSkill, projectSkill, name } = fixture();

    const loadedInASession = await sessionSkillPaths(agentDir, projectPath);
    const discovery = await createPiSkillDiscovery(projectPath, agentDir).discover(projectPath);
    const audits = discovery.skills.filter((skill) => skill.name === name);
    const inTheList = audits.filter((skill) => skill.shadowedByPi !== true).map((skill) => skill.filePath);

    expect(audits.map((skill) => skill.filePath).sort()).toEqual([globalSkill, projectSkill].sort());
    expect(loadedInASession).toContain(projectSkill);
    expect(loadedInASession).not.toContain(globalSkill);
    expect(inTheList).toEqual([projectSkill]);
    expect(loadedInASession.filter((path) => audits.some((skill) => skill.filePath === path))).toEqual(inTheList);
  });

  it("lists the machine's own skill when no project is selected", async () => {
    const { agentDir, globalSkill, name } = fixture();

    const discovery = await createPiSkillDiscovery(process.cwd(), agentDir).discover(undefined);
    const audit = discovery.skills.find((skill) => skill.filePath === globalSkill);

    expect(audit).toBeDefined();
    expect(audit?.name).toBe(name);
    expect(audit?.piScope).toBe("user");
    expect(audit?.shadowedByPi).not.toBe(true);
  });
});
