import { describe, expect, it } from "vitest";
import type { QualifiedThemeContribution } from "../../plugins/types";
import { CORE_MATERIAL_DARK_THEME_ID, CORE_MATERIAL_DARK_TOKENS } from "../../nativeDarkTheme";
import { reactThemeChoices, resolveStoredThemePreference } from "./reactThemeChoices";

const nativeFirst = reactThemeChoices([]);
const pluginTheme: QualifiedThemeContribution = {
  id: "aurora:night",
  pluginId: "aurora",
  localId: "night",
  name: "Aurora Night",
  description: "Cool blues.",
  colorScheme: "dark",
  tokens: CORE_MATERIAL_DARK_TOKENS,
};

describe("React theme choices", () => {
  it("offers PI WEB's own looks before contributions", () => {
    expect(nativeFirst.length).toBeGreaterThan(0);
    expect(nativeFirst.every((choice) => choice.source === "native")).toBe(true);
  });

  it("offers a contributed theme by name, with the plugin that made it", () => {
    const choices = reactThemeChoices([pluginTheme]);
    const aurora = choices.find((choice) => choice.id === "aurora:night");
    expect(aurora).toEqual({ id: "aurora:night", name: "Aurora Night", colorScheme: "dark", description: "Cool blues.", source: "plugin" });
  });

  it("keeps one contributed theme when a theme list repeats it", () => {
    const choices = reactThemeChoices([pluginTheme, { ...pluginTheme, name: "Aurora Night" }]);
    expect(choices.filter((choice) => choice.id === "aurora:night")).toHaveLength(1);
  });

  it("keeps a stored theme that is offered", () => {
    const preference = { themeId: "aurora:night" as const, auto: false };
    expect(resolveStoredThemePreference(preference, reactThemeChoices([pluginTheme]))).toEqual(preference);
  });

  it("falls back to the built-in default when the stored theme is gone", () => {
    const stored = { themeId: "aurora:night" as const, auto: false };
    const resolved = resolveStoredThemePreference(stored, nativeFirst);
    expect(resolved.themeId).toBe(CORE_MATERIAL_DARK_THEME_ID);
    expect(resolved.auto).toBe(false);
  });

  it("uses the built-in default when nothing is stored", () => {
    expect(resolveStoredThemePreference(undefined, nativeFirst).themeId).toBe(CORE_MATERIAL_DARK_THEME_ID);
  });
});
