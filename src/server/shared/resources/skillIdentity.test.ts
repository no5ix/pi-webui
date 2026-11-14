import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { canonicalPathKey, isSkillIdentityKey, skillIdentity, skillScopeCacheKey } from "./skillIdentity";

/**
 * The identity a skill preference is written against.
 *
 * A skill's name is front matter, so identity is built from where the skill file is, in the scope the
 * reader is looking at. These tests pin the two properties the preference system rests on: two skills
 * that share a name are two identities, and one skill discovered twice the same way is one identity
 * every time - because a preference written against an identity that moves would turn a reader's
 * switch into a coin flip.
 */

let root: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "pi-web-skill-identity-")));
  mkdirSync(join(root, "agent", "skills"), { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const agentDir = () => join(root, "agent");

function skillFile(dir: string, name: string): string {
  const path = join(dir, name, "SKILL.md");
  mkdirSync(join(dir, name), { recursive: true });
  writeFileSync(path, `---\nname: ${name}\ndescription: A skill.\n---\n`, "utf8");
  return path;
}

const globalSkill = (name = "nestjs-code-audit") =>
  skillIdentity(skillFile(join(agentDir(), "skills"), name), {});

const projectSkill = (projectName: string, name = "nestjs-code-audit") => {
  const projectPath = skillProject(projectName);
  return skillIdentity(join(projectPath, ".pi", "skills", name, "SKILL.md"), { projectPath });
};

function skillProject(projectName: string): string {
  const projectPath = join(root, projectName);
  mkdirSync(join(projectPath, ".pi", "skills"), { recursive: true });
  skillFile(join(projectPath, ".pi", "skills"), "nestjs-code-audit");
  return projectPath;
}

describe("distinguishing the skills a name cannot tell apart", () => {
  it("gives a global skill and a project's own skill of the same name two identities", () => {
    const global = globalSkill();
    const project = projectSkill("work");

    expect(global.scope).toBe("global");
    expect(project.scope).toBe("project");
    expect(global.id).not.toBe(project.id);
  });

  it("gives two projects' own skills of the same name two identities", () => {
    expect(projectSkill("alpha").id).not.toBe(projectSkill("beta").id);
  });

  it("gives two project skills of the same name in different directories two identities", () => {
    const projectPath = skillProject("nested");
    const inSkillsDir = skillIdentity(join(projectPath, ".pi", "skills", "audit", "SKILL.md"), { projectPath });
    const inAgentsDir = skillIdentity(join(projectPath, ".agents", "skills", "audit", "SKILL.md"), { projectPath });

    expect(inSkillsDir.id).not.toBe(inAgentsDir.id);
    expect(inSkillsDir.scope).toBe("project");
    expect(inAgentsDir.scope).toBe("project");
  });

  it("never builds an identity out of the display name", () => {
    const agent = agentDir();
    const globalOne = skillIdentity(join(agent, "skills", "aaa", "SKILL.md"), {});
    const globalTwo = skillIdentity(join(agent, "skills", "zzz", "SKILL.md"), {});

    expect(globalOne.id).not.toContain("aaa");
    expect(globalTwo.id).not.toContain("zzz");
    expect(globalOne.id).not.toBe(globalTwo.id);
  });

  it("tells a skill inside the project from one outside it, and keeps the outside one machine-wide", () => {
    const projectPath = skillProject("boundary");
    const outside = skillIdentity(join(agentDir(), "skills", "shared", "SKILL.md"), { projectPath });

    expect(outside.scope).toBe("global");
    expect(outside.projectKey).toBeUndefined();
  });
});

describe("identity stability", () => {
  it("repeated discovery of the same file gives the same identity", () => {
    const projectPath = skillProject("stable");
    const path = join(projectPath, ".pi", "skills", "audit", "SKILL.md");

    const first = skillIdentity(path, { projectPath });
    const second = skillIdentity(path, { projectPath });

    expect(second).toEqual(first);
  });

  it("is not moved by a trailing separator, a `.` segment, or a `..` segment", () => {
    const projectPath = skillProject("spelling");
    const plain = skillIdentity(join(projectPath, ".pi", "skills", "audit", "SKILL.md"), { projectPath });
    const withDot = skillIdentity(join(projectPath, ".pi", "skills", "audit", ".", "SKILL.md"), { projectPath });
    const withParent = skillIdentity(join(projectPath, ".pi", "skills", "audit", "..", "audit", "SKILL.md"), { projectPath });
    const projectWithSlash = skillIdentity(join(projectPath, ".pi", "skills", "audit", "SKILL.md"), { projectPath: `${projectPath}${sep}` });

    expect(withDot.id).toBe(plain.id);
    expect(withParent.id).toBe(plain.id);
    expect(projectWithSlash.id).toBe(plain.id);
  });

  it("is the same identity through a symlink to the same file, so one skill is one skill", () => {
    const agent = agentDir();
    const real = skillFile(join(agent, "skills"), "real");
    const linkPath = join(agent, "skills", "link", "SKILL.md");
    mkdirSync(join(agent, "skills", "link"), { recursive: true });
    symlinkSync(real, linkPath);

    expect(skillIdentity(linkPath, {}).id).toBe(skillIdentity(real, {}).id);
  });

  it("keeps a global skill's identity the same whether or not a project was selected", () => {
    const agent = agentDir();
    const path = skillFile(join(agent, "skills"), "shared");
    const projectPath = skillProject("with-project");

    expect(skillIdentity(path, { projectPath }).id).toBe(skillIdentity(path, {}).id);
  });

  it("is marked as an identity key, so a saved entry is told from a legacy name", () => {
    expect(isSkillIdentityKey(globalSkill().id)).toBe(true);
    expect(isSkillIdentityKey("nestjs-code-audit")).toBe(false);
    expect(isSkillIdentityKey("sk1")).toBe(false);
  });
});

describe("the path key identities are built from", () => {
  it("resolves symlinks in the directory, not only in the file name", () => {
    const target = join(root, "real-dir");
    mkdirSync(target, { recursive: true });
    const file = join(target, "SKILL.md");
    writeFileSync(file, "---\nname: linked\ndescription: A skill.\n---\n", "utf8");
    const link = join(root, "link-dir");
    symlinkDir(target, link);

    expect(canonicalPathKey(join(link, "SKILL.md"))).toBe(canonicalPathKey(file));
  });

  it("keeps a path it cannot resolve, so a skill Pi was told about still has a deterministic identity", () => {
    const missing = join(root, "not-written", "SKILL.md");

    expect(canonicalPathKey(missing)).toBe(canonicalPathKey(missing));
    expect(skillIdentity(missing, {}).id).toBe(skillIdentity(missing, {}).id);
  });

  it("folds case where the filesystem does, so a path spelling is not a second skill with its own switch", () => {
    // macOS APFS and Windows are case-insensitive and case-preserving: realpathSync keeps the
    // spelling it was given, so /Machine/Skills and /machine/skills reach one folder and must name
    // one skill. A case-sensitive filesystem is the opposite case, and the rule is the platform's.
    const foldsCase = process.platform === "win32" || process.platform === "darwin";

    expect(skillIdentity("/Machine/Skills/audit/SKILL.md", {}).id === skillIdentity("/machine/skills/audit/SKILL.md", {}).id).toBe(foldsCase);
    expect(skillIdentity("/Machine/Skills/audit/SKILL.md", { projectPath: "/Machine/Repo" }).id === skillIdentity("/machine/skills/audit/SKILL.md", { projectPath: "/machine/repo" }).id).toBe(foldsCase);
    const folds = process.platform === "win32" || process.platform === "darwin";
    expect(canonicalPathKey("/Machine/Skills/audit/SKILL.md") === canonicalPathKey("/machine/skills/audit/SKILL.md")).toBe(folds);
  });
});

describe("the preference cache key", () => {
  it("answers the same for two spellings of one project, so one project cannot hold two answers", () => {
    const projectPath = skillProject("cached");

    const last = projectPath.split(sep).pop() ?? "";

    expect(skillScopeCacheKey(agentDir(), projectPath)).toBe(skillScopeCacheKey(agentDir(), `${projectPath}${sep}..${sep}${last}`));
  });

  it("separates two projects, so one project's preferences cannot answer for another", () => {
    const agent = agentDir();

    expect(skillScopeCacheKey(agent, skillProject("one"))).not.toBe(skillScopeCacheKey(agent, skillProject("two")));
  });
});

function symlinkDir(target: string, link: string): void {
  symlinkSync(target, link, "dir");
}
