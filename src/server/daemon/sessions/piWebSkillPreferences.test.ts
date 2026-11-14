import { describe, expect, it, vi } from "vitest";
import type { Skill } from "@earendil-works/pi-coding-agent";
import type { PiSkillPreferenceConfig } from "../../../shared/apiTypes.js";
import { piWebSkillsOverride, type CachedPreferences, type SkillFilterLogger, type SkillLoadResult, type SkillPreferenceReader } from "./piWebSkillPreferences";

/**
 * The Skills panel is only true if a session stops carrying the skill.
 *
 * These tests drive the filter pi's resource loader calls, with the preference reader faked so a
 * test never reads a real config file: what matters is which skills reach the session, and what the
 * filter does when a preference file cannot be read.
 */

const skill = (name: string): Skill => ({
  name,
  description: `${name} description`,
  filePath: `/skills/${name}/SKILL.md`,
  baseDir: `/skills/${name}`,
  sourceInfo: { path: `/skills/${name}/SKILL.md`, source: "skills", scope: "user", origin: "top-level" },
  disableModelInvocation: false,
});

const result = (...names: string[]): SkillLoadResult => ({
  skills: names.map(skill),
  diagnostics: [{ type: "warning", message: "a loader diagnostic", path: "/skills" }],
});

const logger = (): SkillFilterLogger => ({ info: vi.fn(), warn: vi.fn() });

function reader(global: SkillPreferenceReader["readGlobal"], project: SkillPreferenceReader["readProject"]): SkillPreferenceReader {
  return { readGlobal: global, readProject: project };
}

function preferences(global: SkillPreferenceReader["readGlobal"], project: SkillPreferenceReader["readProject"] = () => ({})) {
  const log = logger();
  const cache = new Map<string, CachedPreferences>();
  const apply = piWebSkillsOverride("/agent", "/project", log, reader(global, project), cache);
  return { log, apply, cache };
}

describe("the skill filter a session runs", () => {
  it("keeps every skill when neither scope has written anything", () => {
    const { apply, log } = preferences(() => ({}));
    const base = result("pdf", "commit-messages");

    const applied = apply(base);

    expect(applied.skills.map((entry) => entry.name)).toEqual(["pdf", "commit-messages"]);
    expect(log.info).not.toHaveBeenCalled();
  });

  it("drops a skill the global scope disabled and leaves the others alone", () => {
    const { apply, log } = preferences(() => ({ version: 1 as const, disabled: ["pdf"] }));

    const applied = apply(result("pdf", "commit-messages"));

    expect(applied.skills.map((entry) => entry.name)).toEqual(["commit-messages"]);
    expect(log.info).toHaveBeenCalledWith(expect.objectContaining({ loaded: 2, kept: 1, removed: 1, scopes: ["global"] }), expect.any(String));
  });

  it("lets a project turn a global skill off without touching the global scope", () => {
    const { apply } = preferences(() => ({ version: 1 as const, enabled: ["pdf"] }), () => ({ version: 1 as const, disabled: ["pdf"] }));

    expect(apply(result("pdf")).skills).toEqual([]);
  });

  it("lets a project turn a global skill back on", () => {
    const { apply } = preferences(() => ({ version: 1 as const, disabled: ["pdf"] }), () => ({ version: 1 as const, enabled: ["pdf"] }));

    expect(apply(result("pdf")).skills.map((entry) => entry.name)).toEqual(["pdf"]);
  });

  it("keeps the loader's diagnostics, so a filtered skill does not hide a path problem", () => {
    const { apply } = preferences(() => ({ version: 1 as const, disabled: ["pdf"] }));

    const applied = apply(result("pdf", "other"));

    expect(applied.diagnostics).toEqual([{ type: "warning", message: "a loader diagnostic", path: "/skills" }]);
  });

  it("keeps every skill, and says so, when the global preference file cannot be read", () => {
    const { apply, log } = preferences(() => {
      throw new Error("config.json is not valid JSON");
    });

    const applied = apply(result("pdf", "other"));

    expect(applied.skills.map((entry) => entry.name)).toEqual(["pdf", "other"]);
    expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({ agentDir: "/agent", error: "config.json is not valid JSON" }), expect.any(String));
  });

  it("keeps the global scope's answer when only the project file is broken", () => {
    const { apply, log } = preferences(
      () => ({ version: 1 as const, disabled: ["pdf"] }),
      () => {
        throw new Error("no read permission");
      },
    );

    const applied = apply(result("pdf", "other"));

    expect(applied.skills.map((entry) => entry.name)).toEqual(["other"]);
    expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({ cwd: "/project", error: "no read permission" }), expect.any(String));
  });

  it("reads the preferences once per pair, and again after the cache has aged out", () => {
    const readGlobal = vi.fn(() => ({ version: 1 as const, disabled: ["pdf"] }));
    const log = logger();
    const cache = new Map<string, CachedPreferences>();
    const apply = piWebSkillsOverride("/agent", "/project", log, reader(readGlobal, () => ({})), cache);

    apply(result("pdf"));
    apply(result("pdf"));
    expect(readGlobal).toHaveBeenCalledTimes(1);

    for (const entry of cache.values()) entry.readAt = Date.now() - 60_000;
    apply(result("pdf"));
    expect(readGlobal).toHaveBeenCalledTimes(2);
  });

  it("keeps one cache entry per project, so one project cannot answer for another", () => {
    const readProject = vi.fn((cwd: string): PiSkillPreferenceConfig => (cwd === "/a" ? { version: 1, disabled: ["pdf"] } : {}));
    const log = logger();
    const cache = new Map<string, CachedPreferences>();

    const applyA = piWebSkillsOverride("/agent", "/a", log, reader(() => ({}), readProject), cache);
    const applyB = piWebSkillsOverride("/agent", "/b", log, reader(() => ({}), readProject), cache);

    expect(applyA(result("pdf")).skills).toEqual([]);
    expect(applyB(result("pdf")).skills.map((entry) => entry.name)).toEqual(["pdf"]);
  });
});
