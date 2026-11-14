import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DefaultResourceLoader, SettingsManager, loadSkills, type ResourceDiagnostic, type Skill } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PiSkillPreferenceConfig } from "../../../shared/apiTypes.js";
import { canonicalPathKey, skillIdentity } from "../../shared/resources/skillIdentity.js";
import { planSkillRuntime, type SkillPreferenceSubject } from "../../shared/resources/skillPreferences.js";
import { piWebSkillsOverride, type SkillPreferenceReader } from "./piWebSkillPreferences";

/**
 * The preferences as a real Pi session sees them.
 *
 * The filter is only worth anything at the place Pi hands the session its skills, so this drives
 * `DefaultResourceLoader` - the loader PI WEB's session runtime builds - with `piWebSkillsOverride`
 * attached exactly where `piSessionService` attaches it, over real skill files on disk. A helper that
 * filters an array in isolation cannot show that a disabled skill is absent from a session, that a
 * shadowed one can be reached, or that Pi's own loader and PI WEB's filter agree.
 *
 * Two things the tests must respect, because Pi's loader, not PI WEB, decides them:
 *
 * - Pi keeps one skill per name. In a session, the skill it keeps for the same name in the agent
 *   directory and the project is the **project's** one, which is not the order the Settings panel's
 *   discovery gets. That is why the filter reads the shadowed skill out of Pi's collision diagnostics
 *   instead of assuming which one Pi loaded.
 * - Pi also loads skills from the machine's own standard locations. Every assertion here is scoped to
 *   the skills under the throwaway root, so a machine's real skills cannot decide a test.
 */

const AUDIT = "nestjs-code-audit";

let root: string;
let agentDir: string;
let projectA: string;
let projectB: string;
let globalAuditPath: string;
let projectAuditPath: string;
let globalPdfPath: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "pi-web-skill-runtime-")));
  agentDir = join(root, "agent");
  projectA = join(root, "project-a");
  projectB = join(root, "project-b");
  globalAuditPath = writeSkill(join(agentDir, "skills", "audit"), AUDIT);
  globalPdfPath = writeSkill(join(agentDir, "skills", "pdf"), "pdf");
  projectAuditPath = writeSkill(join(projectA, ".pi", "skills", "audit"), AUDIT);
  writeSkill(join(projectB, ".pi", "skills", "audit"), AUDIT);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeSkill(dir: string, name: string): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "SKILL.md");
  writeFileSync(path, `---\nname: ${name}\ndescription: A skill.\n---\nRead the body.\n`, "utf8");
  return path;
}

/** A skill's session identity: the same computation the Settings panel runs on the same file. */
const identityAt = (filePath: string, projectPath: string) => skillIdentity(filePath, { projectPath });

const globalAuditId = (projectPath: string) => identityAt(globalAuditPath, projectPath).id;
const projectAuditId = (projectPath: string) => identityAt(join(projectPath, ".pi", "skills", "audit", "SKILL.md"), projectPath).id;
const globalPdfId = (projectPath: string) => identityAt(globalPdfPath, projectPath).id;

/** One session's skill list, from Pi's own loader with PI WEB's filter attached where the runtime attaches it. */
async function sessionSkills(projectPath: string, preferences: () => PiSkillPreferenceConfig): Promise<Skill[]> {
  const reader: SkillPreferenceReader = { readGlobal: preferences, readProject: () => ({}) };
  const loader = new DefaultResourceLoader({
    cwd: projectPath,
    agentDir,
    settingsManager: SettingsManager.create(projectPath, agentDir, { projectTrusted: true }),
    skillsOverride: piWebSkillsOverride(agentDir, projectPath, { info: () => undefined, warn: () => undefined }, reader, new Map()),
  });
  await loader.reload();
  return loader.getSkills().skills.filter((skill) => skill.filePath.startsWith(`${root}/`));
}

const names = (skills: readonly Skill[]): string[] => skills.map((skill) => `${skill.name}@${relativeToRoot(skill.filePath)}`);

function relativeToRoot(filePath: string): string {
  return filePath.slice(root.length + 1);
}

/** What a session's filter and the Skills panel both answer for the skills under the throwaway root. */
function panelRowsForTheSameFiles(projectPath: string, preferences: PiSkillPreferenceConfig) {
  const loaded = loadSkills({
    cwd: projectPath,
    agentDir,
    skillPaths: [join(agentDir, "skills"), join(projectPath, ".pi", "skills")],
    includeDefaults: false,
  });
  const winners = loaded.skills.filter((skill) => skill.filePath.startsWith(`${root}/`));
  const losers = shadowedLoserPaths(loaded.diagnostics).filter((path) => path.startsWith(`${root}/`));
  const subjects: SkillPreferenceSubject[] = [
    ...winners.map((skill) => ({ identity: identityAt(skill.filePath, projectPath), name: skill.name })),
    ...losers.map((path) => ({ identity: identityAt(path, projectPath), name: AUDIT, shadowedByPi: true })),
  ];
  return planSkillRuntime(subjects, preferences, {});
}

/** The files Pi's loader dropped because a same-named skill was read first. */
function shadowedLoserPaths(diagnostics: readonly ResourceDiagnostic[]): string[] {
  const paths: string[] = [];
  for (const diagnostic of diagnostics) {
    if (diagnostic.collision?.resourceType !== "skill") continue;
    paths.push(diagnostic.collision.loserPath);
  }
  return paths;
}

describe("what a session is given", () => {
  it("keeps every skill under the root when nobody has written a preference", async () => {
    const skills = await sessionSkills(projectA, () => ({}));

    expect(names(skills).sort()).toEqual([
      `${AUDIT}@project-a/.pi/skills/audit/SKILL.md`,
      "pdf@agent/skills/pdf/SKILL.md",
    ].sort());
  });

  it("keeps one skill per name, the way Pi's loader does, and it is the project's own", async () => {
    const skills = await sessionSkills(projectA, () => ({}));

    expect(skills.filter((skill) => skill.name === AUDIT).map((skill) => skill.filePath)).toEqual([projectAuditPath]);
  });

  it("takes the skill the session's project turned off out of the list, and leaves the rest", async () => {
    const config: PiSkillPreferenceConfig = { version: 2, disabled: [{ id: projectAuditId(projectA) }] };

    const skills = await sessionSkills(projectA, () => config);

    expect(names(skills)).toEqual(["pdf@agent/skills/pdf/SKILL.md"]);
  });

  it("leaves a machine-wide skill that is turned off out, and keeps the project's own skill of that name", async () => {
    const config: PiSkillPreferenceConfig = { version: 2, disabled: [{ id: globalAuditId(projectA) }] };

    const skills = await sessionSkills(projectA, () => config);

    expect(skills.filter((skill) => skill.name === AUDIT).map((skill) => skill.filePath)).toEqual([projectAuditPath]);
    expect(skills.some((skill) => skill.name === "pdf")).toBe(true);
  });

  it("gives the session the machine-wide skill the reader turned on, in place of the project's skill turned off", async () => {
    const config: PiSkillPreferenceConfig = {
      version: 2,
      disabled: [{ id: projectAuditId(projectA) }],
      enabled: [{ id: globalAuditId(projectA) }],
    };

    const skills = await sessionSkills(projectA, () => config);

    expect(skills.filter((skill) => skill.name === AUDIT).map((skill) => skill.filePath)).toEqual([globalAuditPath]);
  });

  it("leaves a name out of the session when its skill is off and nothing asked for the shadowed one", async () => {
    const config: PiSkillPreferenceConfig = { version: 2, disabled: [{ id: projectAuditId(projectA) }] };

    const skills = await sessionSkills(projectA, () => config);

    expect(skills.some((skill) => skill.name === AUDIT)).toBe(false);
  });

  it("keeps a project's own skill in its own session when the other project turned that name off", async () => {
    const config: PiSkillPreferenceConfig = { version: 2, disabled: [{ id: projectAuditId(projectB) }] };

    const forA = await sessionSkills(projectA, () => config);
    const forB = await sessionSkills(projectB, () => config);

    expect(forA.filter((skill) => skill.name === AUDIT).map((skill) => skill.filePath)).toEqual([projectAuditPath]);
    expect(forB.some((skill) => skill.name === AUDIT)).toBe(false);
  });

  it("filters an absolute configured skill path using the project identity", () => {
    const configuredPath = writeSkill(join(projectA, "custom-skills", "absolute-helper"), "absolute-helper");
    const id = skillIdentity(configuredPath, { projectPath: projectA }).id;
    const base = loadSkills({
      cwd: projectA,
      agentDir,
      skillPaths: [join(projectA, "custom-skills")],
      includeDefaults: false,
    });
    const filter = piWebSkillsOverride(agentDir, projectA, { info: () => undefined, warn: () => undefined }, {
      readGlobal: () => ({}),
      readProject: () => ({ version: 2, disabled: [{ id, name: "absolute-helper" }] }),
    }, new Map());

    expect(base.skills).toHaveLength(1);
    expect(filter(base).skills).toEqual([]);
  });

  it("applies the preferences saved between two session creations", async () => {
    const saved: { config: PiSkillPreferenceConfig } = { config: {} };

    const before = await sessionSkills(projectA, () => saved.config);
    saved.config = { version: 2, disabled: [{ id: globalPdfId(projectA) }] };
    const after = await sessionSkills(projectA, () => saved.config);

    expect(before.some((skill) => skill.name === "pdf")).toBe(true);
    expect(after.some((skill) => skill.name === "pdf")).toBe(false);
  });
});

describe("the panel's rows and the session's list", () => {
  it("answer the same for every skill under the root", async () => {
    const config: PiSkillPreferenceConfig = {
      version: 2,
      disabled: [{ id: projectAuditId(projectA) }],
      enabled: [{ id: globalAuditId(projectA) }],
    };

    const rows = panelRowsForTheSameFiles(projectA, config);
    const live = await sessionSkills(projectA, () => config);

    const rowsEnabledUnderRoot = rows.rows
      .filter((row) => row.identity.resourceKey.startsWith(`${canonicalPathKey(root)}/`))
      .filter((row) => row.enabled)
      .map((row) => row.identity.resourceKey)
      .sort();
    const liveKeys = live.map((skill) => identityAt(skill.filePath, projectA).resourceKey).sort();

    expect(liveKeys).toEqual(rowsEnabledUnderRoot);
  });
});
