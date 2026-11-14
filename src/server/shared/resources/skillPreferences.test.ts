import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { isRecord } from "../../../shared/unknownValues.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PROJECT_SKILL_PREFERENCES_PATH,
  applySkillPreference,
  filterSkillsByPreference,
  isSkillEnabled,
  loadProjectSkillPreferences,
  resolveSkillPreference,
  saveProjectSkillPreferences,
} from "./skillPreferences";
import { PiWebConfigError } from "../../../config";

/**
 * The preference that decides which skills a session is given.
 *
 * Two scopes answer for one skill, and the nearer one wins; a name neither scope has written is
 * Pi's default, which is available. The project's answers live in a file the project commits,
 * beside PI WEB's other project settings, so writing them must leave every other key in that file
 * exactly as it was.
 */

let projectPath: string;

beforeEach(() => {
  projectPath = mkdtempSync(join(tmpdir(), "pi-web-skill-prefs-"));
  mkdirSync(join(projectPath, ".pi-web"), { recursive: true });
});

afterEach(() => {
  rmSync(projectPath, { recursive: true, force: true });
});

const projectConfigPath = () => join(projectPath, PROJECT_SKILL_PREFERENCES_PATH);

describe("resolving the two scopes", () => {
  it("treats a name nobody wrote about as Pi's default, which is available", () => {
    expect(resolveSkillPreference("pdf", {})).toBe("default");
    expect(isSkillEnabled("pdf", {})).toBe(true);
  });

  it("lets the global scope turn a skill off", () => {
    expect(resolveSkillPreference("pdf", { version: 1, disabled: ["pdf"] })).toBe("disabled");
    expect(isSkillEnabled("pdf", { version: 1, disabled: ["pdf"] })).toBe(false);
  });

  it("lets a project answer for itself, in both directions", () => {
    expect(resolveSkillPreference("pdf", { disabled: ["pdf"] }, { enabled: ["pdf"] })).toBe("enabled");
    expect(resolveSkillPreference("pdf", { enabled: ["pdf"] }, { disabled: ["pdf"] })).toBe("disabled");
  });

  it("says a project that was not asked about has no answer of its own", () => {
    expect(resolveSkillPreference("pdf", { disabled: ["pdf"] }, undefined)).toBe("disabled");
    expect(resolveSkillPreference("other", {}, {})).toBe("default");
  });

  it("filters the runtime list by the answer, and keeps a name it has nothing to say about", () => {
    const skills = [{ name: "pdf" }, { name: "other" }, { name: "legacy" }];

    expect(filterSkillsByPreference(skills, { disabled: ["pdf"] }, { enabled: ["legacy"] }).map((entry) => entry.name)).toEqual(["other", "legacy"]);
    expect(filterSkillsByPreference(skills, {})).toEqual(skills);
  });
});

describe("writing one scope's list", () => {
  it("adds a name to the list the switch asks for", () => {
    expect(applySkillPreference({}, "pdf", false)).toEqual({ version: 1, disabled: ["pdf"] });
    expect(applySkillPreference({}, "pdf", true)).toEqual({ version: 1, enabled: ["pdf"] });
  });

  it("leaves the other list, so a scope never holds both answers for one name", () => {
    const enabled = applySkillPreference({ version: 1, enabled: ["pdf"] }, "pdf", false);
    expect(enabled).toEqual({ version: 1, disabled: ["pdf"] });

    const disabled = applySkillPreference({ version: 1, disabled: ["pdf"] }, "pdf", true);
    expect(disabled).toEqual({ version: 1, enabled: ["pdf"] });
  });

  it("keeps the other names it was given", () => {
    expect(applySkillPreference({ version: 1, disabled: ["pdf", "legacy"] }, "pdf", true)).toEqual({ version: 1, enabled: ["pdf"], disabled: ["legacy"] });
  });

  it("refuses an empty name, so a switch cannot write a preference that matches everything", () => {
    expect(() => applySkillPreference({}, "   ", false)).toThrow(PiWebConfigError);
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
    writeFileSync(projectConfigPath(), `${JSON.stringify({ uploads: { maxBytes: 10 }, skills: { version: 1, disabled: ["pdf"] } }, null, 4)}\n`, "utf8");

    const saved = saveProjectSkillPreferences(projectPath, applySkillPreference(loadProjectSkillPreferences(projectPath).config, "legacy", false));

    const value: unknown = JSON.parse(readFileSync(projectConfigPath(), "utf8"));
    if (!isRecord(value)) throw new Error("Expected the project config file to be an object");
    const parsed = value;
    expect(parsed["uploads"]).toEqual({ maxBytes: 10 });
    expect(parsed["skills"]).toEqual({ version: 1, disabled: ["pdf", "legacy"] });
    expect(saved.exists).toBe(true);
    expect(loadProjectSkillPreferences(projectPath).config).toEqual({ version: 1, disabled: ["pdf", "legacy"] });
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
});
