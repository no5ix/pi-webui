import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(fileURLToPath(new URL("../workspace.css", import.meta.url)), "utf8");

const panelSources = [
  "./SettingsKit.tsx",
  "./PiPackagesSettingsPanel.tsx",
  "./SkillsSettingsPanel.tsx",
  "../McpSettingsPanel.tsx",
];

function classesRendered(source: string): string[] {
  const text = readFileSync(fileURLToPath(new URL(source, import.meta.url)), "utf8");
  return [...new Set(text.match(/rw-[a-z][a-z-]*/g) ?? [])];
}

/** The body of the phone-width media block, so a test can ask what the narrow layout does. */
function narrowBlock(css: string): string {
  const start = css.indexOf("@media(max-width:640px){");
  if (start < 0) throw new Error("the stylesheet has no phone-width block");
  return css.slice(start);
}

describe("settings stylesheet coverage", () => {
  it("styles every class the settings panels render", () => {
    const missing = panelSources.flatMap(classesRendered).filter((name) => !stylesheet.includes(`.${name}`));
    expect([...new Set(missing)]).toEqual([]);
  });

  it("stacks card actions and inline forms on a narrow screen", () => {
    const narrow = narrowBlock(stylesheet);
    expect(narrow).toContain(".rw-settings-card-actions{width:100%}");
    expect(narrow).toContain(".rw-settings-inline-form{align-items:stretch}");
    expect(narrow).toMatch(/\.rw-settings-card-actions \.rw-settings-toggle\{[^}]*min-height:44px/);
  });

  it("keeps every settings control on the coarse-pointer floor", () => {
    const buttons = stylesheet.match(/\.rw-settings-section-actions button,\.rw-settings-card-actions button,\.rw-settings-inline-form button\{[^}]*\}/)?.[0] ?? "";
    expect(buttons).toContain("min-height:32px");
    const fields = stylesheet.match(/\.rw-settings-field input,\.rw-settings-field select,\.rw-settings-field textarea\{[^}]*\}/)?.[0] ?? "";
    expect(fields).toContain("min-height:32px");
    const switches = stylesheet.match(/\.rw-settings-toggle\{[^}]*\}/)?.[0] ?? "";
    expect(switches).toContain("min-height:32px");
    expect(stylesheet).toMatch(/\.rw-settings-nav button\{[^}]*min-height:36px/);
  });

  it("keeps the settings navigation usable in a phone-width dialog", () => {
    const narrow = narrowBlock(stylesheet);
    expect(narrow).toMatch(/\.rw-settings-nav\{[^}]*flex-direction:row/);
  });

  it("gives a settings switch a touch-sized target, not a raw checkbox", () => {
    expect(stylesheet).toMatch(/\.rw-settings-toggle\{[^}]*min-height:32px/);
    expect(stylesheet).toMatch(/\.rw-settings-toggle input\{[^}]*inset:0/);
    expect(narrowBlock(stylesheet)).toMatch(/\.rw-settings-toggle\{[^}]*min-height:44px/);
  });
});
