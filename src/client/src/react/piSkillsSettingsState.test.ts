import { describe, expect, it } from "vitest";
import type { PiSkillInfo, PiSkillsScopeInfo } from "../api";
import {
  isPiSkillTogglePending,
  piSkillAnyPending,
  piSkillBusyMessage,
  piSkillDiagnosticsLines,
  piSkillDuplicateNameNote,
  piSkillDuplicateNames,
  piSkillDirectoryLines,
  piSkillGlobalEmptyNote,
  piSkillGlobalRows,
  piSkillMutationMessage,
  piSkillNoProjectNote,
  piSkillOriginLabel,
  piSkillOwnerPackageNote,
  piSkillPreferenceLabel,
  piSkillProjectEmptyNote,
  piSkillProjectRows,
  piSkillPromotedNote,
  piSkillRowBlockedByPackage,
  piSkillRowKey,
  piSkillRowTestId,
  piSkillScopeNote,
  piSkillScopeRows,
  piSkillSetEnabledRequest,
  piSkillShadowedNote,
  piSkillStatus,
  piSkillUnreadableLines,
  piSkillValidationNote,
} from "./settings/piSkillsSettingsState";

const globalFile = "/home/dev/.pi/agent/skills/reviews/review/SKILL.md";

function skill(overrides: Partial<PiSkillInfo> = {}): PiSkillInfo {
  return {
    id: `global:${globalFile}`,
    name: "review",
    description: "Review a pull request",
    filePath: globalFile,
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

describe("Skills scope rules", () => {
  it("splits the machine's rows from the project's", () => {
    const rows = [skill({}), skill({ name: "notes", scope: "project", origin: "project" })];
    expect(piSkillGlobalRows(rows).map(entry => entry.name)).toEqual(["review"]);
    expect(piSkillProjectRows(rows).map(entry => entry.name)).toEqual(["notes"]);
    expect(piSkillScopeRows(rows, "global")).toHaveLength(1);
  });

  it("writes a switch against the row's identity and scope, and sends no project", () => {
    expect(piSkillSetEnabledRequest(skill({}), false)).toEqual({
      id: `global:${globalFile}`,
      name: "review",
      scope: "global",
      enabled: false,
    });
    const projectRow = skill({ scope: "project", origin: "project", id: "project:/srv/repo/.pi/skills/notes/SKILL.md" });
    expect(piSkillSetEnabledRequest(projectRow, true)).toEqual({
      id: "project:/srv/repo/.pi/skills/notes/SKILL.md",
      name: "review",
      scope: "project",
      enabled: true,
    });
    expect(piSkillSetEnabledRequest(projectRow, true)).not.toHaveProperty("projectId");
  });

  it("keys a row by pi's identity, so two rows sharing a name keep two separate pending states", () => {
    const globalRow = skill({});
    const projectRow = skill({ scope: "project", name: "review", id: "project:/srv/repo/.pi/skills/review/SKILL.md" });
    expect(piSkillRowKey(globalRow)).not.toBe(piSkillRowKey(projectRow));
    const busy = { [piSkillRowKey(projectRow)]: "Switching “review”" };
    expect(isPiSkillTogglePending(busy, projectRow)).toBe(true);
    expect(isPiSkillTogglePending(busy, globalRow)).toBe(false);
    expect(piSkillAnyPending(busy)).toBe(true);
    expect(piSkillAnyPending({})).toBe(false);
    expect(piSkillBusyMessage(busy)).toContain("skill controls are disabled while it runs");
    expect(piSkillBusyMessage({})).toBeUndefined();
    expect(piSkillRowTestId(projectRow)).toBe("react-skills-row-project-project:/srv/repo/.pi/skills/review/SKILL.md");
  });

  it("says where pi read a skill from, in pi's own words", () => {
    expect(piSkillOriginLabel("agent")).toBe("user (global)");
    expect(piSkillOriginLabel("project")).toBe("project");
    expect(piSkillOriginLabel("path")).toBe("path");
    expect(piSkillOriginLabel("package")).toBe("package (installed)");
  });

  it("states the preference and the file that answered, because two scopes save two answers", () => {
    expect(piSkillPreferenceLabel(skill({}))).toBe("enabled · saved in global settings");
    expect(piSkillPreferenceLabel(skill({ scope: "project", preference: "disabled", answeredBy: "project" })))
      .toBe("disabled · saved in project settings");
    expect(piSkillPreferenceLabel(skill({ answeredBy: "default", preference: "default" })))
      .toBe("default · no saved entry — pi's default");
  });

  it("reports a row's state, and why a row is not used", () => {
    expect(piSkillStatus(skill({}))).toEqual({ label: "On", off: false });
    expect(piSkillStatus(skill({ enabled: false, preference: "disabled" }))).toEqual({ label: "Off", off: true });
    expect(piSkillShadowedNote(skill({ shadowed: true }))).toContain("a stronger source is the one pi keeps");
    expect(piSkillShadowedNote(skill({}))).toBeUndefined();
    expect(piSkillPromotedNote(skill({ promoted: true }))).toContain('in place of a skill named "review" that was turned off');
  });

  it("blocks a row whose supplying package is turned off, and says where to fix it", () => {
    const row = skill({ ownerPackageDisabled: true, packageSource: "github.com/owner/pkg" });
    expect(piSkillRowBlockedByPackage(row)).toBe(true);
    expect(piSkillOwnerPackageNote(row)).toContain("github.com/owner/pkg that is turned off");
    expect(piSkillOwnerPackageNote(row)).toContain("Pi Packages");
    expect(piSkillOwnerPackageNote(skill({}))).toBeUndefined();
  });

  it("shows a validation problem as the file to open, and stays quiet about a valid definition", () => {
    expect(piSkillValidationNote(skill({}))).toBeUndefined();
    expect(piSkillValidationNote(skill({ validation: "warning", validationMessage: "name does not match the directory" })))
      .toBe(`Validation warning: name does not match the directory — edit ${globalFile}`);
    expect(piSkillValidationNote(skill({ validation: "warning" }))).toBe(`Validation warning — edit ${globalFile}`);
  });

  it("lists pi's diagnostics and the paths it could not read, each naming its file", () => {
    expect(piSkillDiagnosticsLines([{ message: "missing description", path: globalFile }]))
      .toEqual([`${globalFile} — missing description`]);
    expect(piSkillDiagnosticsLines([{ message: "no skills directory" }])).toEqual(["skills — no skills directory"]);
    expect(piSkillUnreadableLines([{ message: "permission denied", path: "/srv/repo/.pi/skills/x/SKILL.md" }]))
      .toEqual(["/srv/repo/.pi/skills/x/SKILL.md — permission denied"]);
    expect(piSkillUnreadableLines([{ message: "unreadable" }])).toEqual(["a skill path — unreadable"]);
  });

  it("lists the directories pi searched, per scope, with the settings file a switch writes", () => {
    const scopes: PiSkillsScopeInfo[] = [
      { scope: "global", skillsDir: "/home/dev/.pi/agent/skills", configPath: "/home/dev/.pi/agent/settings.json" },
      { scope: "project", skillsDir: "/srv/repo/.pi/skills", configPath: "/srv/repo/.pi/settings.json", projectId: "p1", projectTrusted: true },
    ];
    const lines = piSkillDirectoryLines(scopes);
    expect(lines[0]).toBe("Global skills: /home/dev/.pi/agent/skills · settings: /home/dev/.pi/agent/settings.json");
    expect(lines[1]).toContain("Project skills: /srv/repo/.pi/skills");
  });

  it("names the file a section's switch writes", () => {
    expect(piSkillScopeNote("global", 1, "repo", "Workstation")).toContain("Global skills on Workstation: 1 skill");
    expect(piSkillScopeNote("global", 2, "repo", "Workstation")).toContain("2 skills");
    expect(piSkillScopeNote("project", 1, "repo", "Workstation")).toContain("Project skills for repo: 1 skill");
    expect(piSkillNoProjectNote()).toContain("project skills are not read");
    expect(piSkillProjectEmptyNote()).toContain(".pi/skills/");
    expect(piSkillGlobalEmptyNote()).toContain("No skills were returned");
  });

  it("notes a name answered in more than one scope, and names the scope to switch", () => {
    const globalRow = skill({});
    const projectRow = skill({ scope: "project", name: "review", id: "project:/srv/repo/.pi/skills/review/SKILL.md" });
    const duplicates = piSkillDuplicateNames([globalRow, projectRow, skill({ name: "notes" })]);
    expect(duplicates).toEqual(["review"]);
    expect(piSkillDuplicateNameNote(projectRow, duplicates)).toContain("also answered for the global scope");
    expect(piSkillDuplicateNameNote(globalRow, duplicates)).toContain("also answered for the project scope");
    expect(piSkillDuplicateNameNote(skill({ name: "notes" }), duplicates)).toBeUndefined();
    expect(piSkillDuplicateNames([skill({})])).toEqual([]);
  });

  it("names the scope a switch saved, and carries pi's reload note", () => {
    expect(piSkillMutationMessage({ skills: [skill({})], diagnostics: [], scopes: [], requiresReload: true }, true))
      .toBe("Global skills saved — enabled. Reload running sessions to apply it.");
    expect(piSkillMutationMessage({ skills: [skill({ scope: "project" })], diagnostics: [], scopes: [], requiresReload: false }, false))
      .toBe("Project skills saved — disabled.");
  });
});
