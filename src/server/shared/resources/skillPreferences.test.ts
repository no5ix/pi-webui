import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isRecord } from "../../../shared/unknownValues.js";
import type { PiSkillPreferenceConfig } from "../../../shared/apiTypes.js";
import { skillIdentity, type SkillIdentity } from "./skillIdentity";
import {
  PROJECT_SKILL_PREFERENCES_PATH,
  applySkillPreference,
  loadProjectSkillPreferences,
  planSkillRuntime,
  saveProjectSkillPreferences,
  type SkillPreferenceSubject,
  type SkillRuntimeRow,
} from "./skillPreferences";
import { PiWebConfigError } from "../../../config";

/**
 * The preference that decides which skills a session is given.
 *
 * Two scopes answer for one skill, the nearer one wins, and a skill neither scope wrote about is Pi's
 * default, which is available. A preference is written against a skill's identity, so a project's own
 * skill of the same display name as a machine-wide one is answered apart from it, and these tests pin
 * that: the whole precedence table, and the cases a name-keyed answer got wrong.
 */

const AGENT_DIR = "/machine/.pi";

function identity(filePath: string, projectPath?: string): SkillIdentity {
  return skillIdentity(filePath, projectPath === undefined ? {} : { projectPath });
}

/** The global skill at `<agentDir>/skills/<name>/SKILL.md`. */
function globalSubject(name: string, dir = name): SkillPreferenceSubject {
  return { identity: identity(`${AGENT_DIR}/skills/${dir}/SKILL.md`), name };
}

/** A project's own skill at `<project>/.pi/skills/<name>/SKILL.md`. */
function projectSubject(name: string, projectPath = "/work/one", dir = name): SkillPreferenceSubject {
  return { identity: identity(`${projectPath}/.pi/skills/${dir}/SKILL.md`, projectPath), name };
}

function rowFor(rows: readonly SkillRuntimeRow[], subject: SkillPreferenceSubject): SkillRuntimeRow {
  const row = rows.find((entry) => entry.identity.id === subject.identity.id);
  if (row === undefined) throw new Error(`No plan row for ${subject.name} ${subject.identity.id}`);
  return row;
}

function plan(subjects: readonly SkillPreferenceSubject[], global: PiSkillPreferenceConfig, project?: PiSkillPreferenceConfig) {
  return planSkillRuntime(subjects, global, project);
}

function enabledFor(global: PiSkillPreferenceConfig, project: PiSkillPreferenceConfig | undefined, subject = globalSubject("pdf")): SkillRuntimeRow {
  return rowFor(plan([subject], global, project).rows, subject);
}

let projectPath: string;

beforeEach(() => {
  projectPath = mkdtempSync(join(tmpdir(), "pi-web-skill-prefs-"));
  mkdirSync(join(projectPath, ".pi-web"), { recursive: true });
});

afterEach(() => {
  rmSync(projectPath, { recursive: true, force: true });
});

const projectConfigPath = () => join(projectPath, PROJECT_SKILL_PREFERENCES_PATH);

describe("the precedence the two scopes give one skill", () => {
  it("treats a skill nobody wrote about as Pi's default, which is available", () => {
    const row = enabledFor({}, undefined);

    expect(row.preference).toBe("default");
    expect(row.answeredBy).toBe("default");
    expect(row.enabled).toBe(true);
  });

  it("keeps a global skill out when the global scope turned it off and nothing overrides it", () => {
    const row = enabledFor({ version: 1, disabled: [{ id: globalSubject("pdf").identity.id }] }, undefined);

    expect(row).toMatchObject({ preference: "disabled", answeredBy: "global", enabled: false });
  });

  it("lets a project turn a global skill back on for itself", () => {
    const global = { version: 2 as const, disabled: [{ id: globalSubject("pdf").identity.id }] };
    const project = { version: 2 as const, enabled: [{ id: globalSubject("pdf").identity.id }] };

    expect(enabledFor(global, project)).toMatchObject({ preference: "enabled", answeredBy: "project", enabled: true });
  });

  it("lets a project turn a global skill off for itself", () => {
    const global = { version: 2 as const, enabled: [{ id: globalSubject("pdf").identity.id }] };
    const project = { version: 2 as const, disabled: [{ id: globalSubject("pdf").identity.id }] };

    expect(enabledFor(global, project)).toMatchObject({ preference: "disabled", answeredBy: "project", enabled: false });
  });

  it("keeps a global skill in when the global scope turned it on and nothing overrides it", () => {
    expect(enabledFor({ version: 2, enabled: [{ id: globalSubject("pdf").identity.id }] }, undefined))
      .toMatchObject({ preference: "enabled", answeredBy: "global", enabled: true });
  });

  it("answers a skill of one project without touching another project's answer", () => {
    const one = projectSubject("release", "/work/one");
    const two = projectSubject("release", "/work/two");
    const projectConfig: PiSkillPreferenceConfig = { version: 2, disabled: [{ id: one.identity.id }] };

    const forOne = rowFor(plan([one], {}, projectConfig).rows, one);
    const forTwo = rowFor(plan([two], {}, projectConfig).rows, two);

    expect(forOne).toMatchObject({ preference: "disabled", enabled: false });
    expect(forTwo).toMatchObject({ preference: "default", enabled: true });
  });

  it("never lets a project's answer change the machine's answer", () => {
    const global: PiSkillPreferenceConfig = { version: 2, disabled: [{ id: globalSubject("pdf").identity.id }] };
    const project: PiSkillPreferenceConfig = { version: 2, enabled: [{ id: globalSubject("pdf").identity.id }] };

    const readForProject = enabledFor(global, project);
    const readForTheMachineAlone = enabledFor(global, undefined);

    expect(readForProject).toMatchObject({ preference: "enabled", enabled: true });
    expect(readForTheMachineAlone).toMatchObject({ preference: "disabled", enabled: false });
  });
});

describe("two skills that share a display name", () => {
  const globalAudit = () => globalSubject("nestjs-code-audit");
  const projectAudit = (projectPath = "/work/one") => projectSubject("nestjs-code-audit", projectPath);

  it("answers each of them on its own identity, in both directions", () => {
    const global = globalAudit();
    const project = projectAudit();
    const globalConfig: PiSkillPreferenceConfig = { version: 2, disabled: [{ id: global.identity.id }] };
    const projectConfig: PiSkillPreferenceConfig = { version: 2, enabled: [{ id: project.identity.id }] };

    const rows = plan([global, project], globalConfig, projectConfig).rows;

    expect(rowFor(rows, global)).toMatchObject({ enabled: false, preference: "disabled", answeredBy: "global" });
    expect(rowFor(rows, project)).toMatchObject({ enabled: true, preference: "enabled", answeredBy: "project" });
  });

  it("keeps a project's own skill out of the list when the project turns it off, whatever the machine says", () => {
    const global = globalAudit();
    const project = projectAudit();
    const rows = plan(
      [global, project],
      { version: 2, enabled: [{ id: global.identity.id }] },
      { version: 2, disabled: [{ id: project.identity.id }] },
    ).rows;

    expect(rowFor(rows, global)).toMatchObject({ enabled: true });
    expect(rowFor(rows, project)).toMatchObject({ enabled: false });
  });

  it("never writes one skill's answer onto the other when the switch is saved", () => {
    const global = globalAudit();
    const project = projectAudit();
    const saved = applySkillPreference({}, project, false, [global, project]);

    expect(saved.disabled).toEqual([{ id: project.identity.id, name: "nestjs-code-audit" }]);
    expect(saved.enabled).toBeUndefined();
  });
});

describe("a legacy name entry", () => {
  it("answers for the one skill that carries the name", () => {
    const subject = globalSubject("pdf");

    expect(enabledFor({ version: 1, disabled: ["pdf"] }, undefined, subject)).toMatchObject({ preference: "disabled", answeredBy: "global", enabled: false });
    expect(enabledFor({}, { version: 1, disabled: ["pdf"] }, subject)).toMatchObject({ preference: "disabled", answeredBy: "project", enabled: false });
  });

  it("answers for a project's own skill when the project named it by name", () => {
    const project = projectSubject("release");

    expect(rowFor(plan([project], {}, { version: 1, disabled: ["release"] }).rows, project)).toMatchObject({ preference: "disabled", answeredBy: "project", enabled: false });
  });

  it("answers for neither of two skills that share the name, and says so", () => {
    const global = globalSubject("nestjs-code-audit");
    const project = projectSubject("nestjs-code-audit");
    const planned = plan([global, project], { version: 1, disabled: ["nestjs-code-audit"] }, undefined);

    expect(rowFor(planned.rows, global).enabled).toBe(true);
    expect(rowFor(planned.rows, project).enabled).toBe(true);
    expect(planned.ambiguous).toEqual([{ scope: "global", name: "nestjs-code-audit", identities: [global.identity, project.identity] }]);
  });

  it("is kept, and answers for nothing, when no discovered skill carries the name", () => {
    const planned = plan([globalSubject("pdf")], { version: 1, disabled: ["gone-away"] }, undefined);

    expect(planned.rows[0]).toMatchObject({ enabled: true, preference: "default" });
    expect(planned.unresolved).toEqual([{ scope: "global", name: "gone-away" }]);
    expect(planned.ambiguous).toEqual([]);
  });

  it("loses to an identity entry for the same skill, which is the canonical spelling", () => {
    const subject = globalSubject("pdf");

    expect(enabledFor({ version: 1, disabled: ["pdf"] }, undefined, subject)).toMatchObject({ preference: "disabled" });
    expect(enabledFor({ version: 2, enabled: [{ id: subject.identity.id }], disabled: ["pdf"] }, undefined, subject))
      .toMatchObject({ preference: "enabled", enabled: true });
  });
});

describe("one scope that names the same skill in both lists", () => {
  it("lets the identity entry settle a legacy name for the same skill, and reports the contradiction", () => {
    const subject = globalSubject("pdf");

    const runtime = plan([subject], { version: 2, disabled: ["pdf"], enabled: [{ id: subject.identity.id, name: "pdf" }] }, undefined);

    expect(rowFor(runtime.rows, subject)).toMatchObject({ preference: "enabled", answeredBy: "global", enabled: true });
    expect(runtime.conflicts).toEqual([{ scope: "global", name: "pdf", identity: subject.identity }]);
  });

  it("reports a project that contradicts itself the same way, without involving the machine", () => {
    const subject = globalSubject("pdf");

    const runtime = plan([subject], {}, { version: 2, disabled: [{ id: subject.identity.id, name: "pdf" }], enabled: [{ id: subject.identity.id, name: "pdf" }] });

    expect(rowFor(runtime.rows, subject)).toMatchObject({ preference: "disabled", answeredBy: "project", enabled: false });
    expect(runtime.conflicts.map((entry) => entry.scope)).toEqual(["project"]);
  });

  it("lets a project turn a machine's no into a yes, which is precedence and not a contradiction", () => {
    const subject = globalSubject("pdf");

    const runtime = plan([subject], { version: 2, disabled: [{ id: subject.identity.id, name: "pdf" }] }, { version: 2, enabled: [{ id: subject.identity.id, name: "pdf" }] });

    expect(rowFor(runtime.rows, subject)).toMatchObject({ preference: "enabled", answeredBy: "project", enabled: true });
    expect(runtime.conflicts).toEqual([]);
  });
});

describe("writing a preference into a file that predates identities", () => {
  it("turns a legacy alias into the identity entry when the switch is saved, so one skill has one answer", () => {
    const subject = globalSubject("pdf");

    const saved = applySkillPreference({ version: 1, disabled: ["pdf"] }, subject, true, [subject]);

    expect(saved).toEqual({ version: 2, enabled: [{ id: subject.identity.id, name: "pdf" }] });
  });
});

describe("writing one scope's list", () => {
  it("adds the skill to the list the switch asks for, and never to both", () => {
    const subject = globalSubject("pdf");

    expect(applySkillPreference({}, subject, false, [subject])).toEqual({ version: 2, disabled: [{ id: subject.identity.id, name: "pdf" }] });
    expect(applySkillPreference({ version: 2, enabled: [{ id: subject.identity.id, name: "pdf" }] }, subject, false, [subject]))
      .toEqual({ version: 2, disabled: [{ id: subject.identity.id, name: "pdf" }] });
  });

  it("keeps the answers it was given about other skills", () => {
    const pdf = globalSubject("pdf");
    const legacy = globalSubject("legacy");

    expect(applySkillPreference({ version: 2, disabled: [{ id: pdf.identity.id, name: "pdf" }, { id: legacy.identity.id, name: "legacy" }] }, pdf, true, [pdf, legacy]))
      .toEqual({ version: 2, disabled: [{ id: legacy.identity.id, name: "legacy" }], enabled: [{ id: pdf.identity.id, name: "pdf" }] });
  });
});

describe("the project's own file", () => {
  it("reads a missing file as no preferences, not as an empty list", () => {
    const loaded = loadProjectSkillPreferences(projectPath);

    expect(loaded.exists).toBe(false);
    expect(loaded.config).toEqual({});
    expect(loaded.path).toBe(projectConfigPath());
  });

  it("writes its own key and leaves every other key in the project's config alone", () => {
    const release = projectSubject("release", projectPath);
    writeFileSync(projectConfigPath(), `${JSON.stringify({ uploads: { maxBytes: 10 }, pathAccess: { allowed: ["/tmp"] }, skills: { version: 1, disabled: ["pdf"] } }, null, 4)}\n`, "utf8");

    const saved = saveProjectSkillPreferences(projectPath, applySkillPreference(loadProjectSkillPreferences(projectPath).config, release, false, [release]));

    const value: unknown = JSON.parse(readFileSync(projectConfigPath(), "utf8"));
    if (!isRecord(value)) throw new Error("Expected the project config file to be an object");
    const parsed = value;
    expect(parsed["uploads"]).toEqual({ maxBytes: 10 });
    expect(parsed["pathAccess"]).toEqual({ allowed: ["/tmp"] });
    expect(parsed["skills"]).toEqual({ version: 2, disabled: ["pdf", { id: release.identity.id, name: "release" }] });
    expect(saved.exists).toBe(true);
  });

  it("keeps an older project file readable, so an installation does not lose its answers", () => {
    writeFileSync(projectConfigPath(), `${JSON.stringify({ skills: { version: 1, disabled: ["pdf"], enabled: ["release"] } }, null, 2)}\n`, "utf8");

    expect(loadProjectSkillPreferences(projectPath).config).toEqual({ version: 1, disabled: ["pdf"], enabled: ["release"] });
  });

  it("writes the file in PI WEB's own shape, ending with a newline", () => {
    saveProjectSkillPreferences(projectPath, { version: 1, disabled: ["pdf"] });

    const text = readFileSync(projectConfigPath(), "utf8");
    expect(text.endsWith("\n")).toBe(true);
    expect(text).toContain('\n  "skills"');
  });

  it("creates the directory when the project has no PI WEB config yet", () => {
    const bare = mkdtempSync(join(tmpdir(), "pi-web-skill-prefs-bare-"));
    try {
      saveProjectSkillPreferences(bare, { version: 1, disabled: ["pdf"] });

      const bareValue: unknown = JSON.parse(readFileSync(join(bare, PROJECT_SKILL_PREFERENCES_PATH), "utf8"));
      if (!isRecord(bareValue)) throw new Error("Expected the created project config file to be an object");
      expect(bareValue["skills"]).toEqual({ version: 1, disabled: ["pdf"] });
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });

  it("refuses to read a file whose skills key is not the shape it writes", () => {
    writeFileSync(projectConfigPath(), JSON.stringify({ skills: { version: 2, disabled: "pdf" } }), "utf8");

    expect(() => loadProjectSkillPreferences(projectPath)).toThrow(PiWebConfigError);
  });

  it("refuses a version it does not write", () => {
    writeFileSync(projectConfigPath(), JSON.stringify({ skills: { version: 3, disabled: ["pdf"] } }), "utf8");

    expect(() => loadProjectSkillPreferences(projectPath)).toThrow(PiWebConfigError);
  });
});
