import { describe, expect, it } from "vitest";
import {
  CORE_BUILTIN_DARK_THEME_ID,
  CORE_BUILTIN_LIGHT_THEME_ID,
  CORE_MATERIAL_DARK_THEME_ID,
  CORE_MATERIAL_LIGHT_THEME_ID,
  DEFAULT_THEME_PREFERENCE,
  NATIVE_THEME_CHOICES,
  NATIVE_THEME_PAIRS,
  THEME_TOKENS,
  findNativeThemePair,
  isNativeThemeId,
  nativeThemeChoice,
  nativeThemePairContribution,
  resolveNativeThemePaint,
} from "./theme";
import { CORE_BUILTIN_DARK_TOKENS } from "./builtinDarkTheme";
import { CORE_BUILTIN_LIGHT_TOKENS } from "./builtinLightTheme";
import { CORE_MATERIAL_DARK_TOKENS } from "./nativeDarkTheme";

/**
 * The two builtin looks are core themes, so they carry the whole contract themselves: a plugin pack
 * may lean on `DERIVED_TOKENS`, a core look may not, because the look a reader chooses has to be
 * the look the page paints before any module has loaded.
 */
describe("the builtin palettes", () => {
  it("name themselves with the core's own qualified ids", () => {
    expect(CORE_BUILTIN_DARK_THEME_ID).toBe("core:builtin-dark");
    expect(CORE_BUILTIN_LIGHT_THEME_ID).toBe("core:builtin-light");
    expect(NATIVE_THEME_CHOICES.map((theme) => theme.id)).toEqual([
      CORE_MATERIAL_DARK_THEME_ID,
      CORE_MATERIAL_LIGHT_THEME_ID,
      CORE_BUILTIN_DARK_THEME_ID,
      CORE_BUILTIN_LIGHT_THEME_ID,
    ]);
  });

  it("keep every existing native id, so a saved preference still names what it named", () => {
    expect(NATIVE_THEME_CHOICES.map((theme) => theme.id)).toContain(CORE_MATERIAL_DARK_THEME_ID);
    expect(NATIVE_THEME_CHOICES.map((theme) => theme.id)).toContain(CORE_MATERIAL_LIGHT_THEME_ID);
    expect(DEFAULT_THEME_PREFERENCE).toEqual({ themeId: CORE_MATERIAL_DARK_THEME_ID, auto: true });
  });

  it("are each a dark and a light look", () => {
    expect(nativeThemeChoice(CORE_BUILTIN_DARK_THEME_ID)?.colorScheme).toBe("dark");
    expect(nativeThemeChoice(CORE_BUILTIN_LIGHT_THEME_ID)?.colorScheme).toBe("light");
  });

  it("cover every token the app paints, and name no token the contract does not", () => {
    const contract = [...THEME_TOKENS].sort();
    expect(Object.keys(CORE_BUILTIN_DARK_TOKENS).sort()).toEqual(contract);
    expect(Object.keys(CORE_BUILTIN_LIGHT_TOKENS).sort()).toEqual(contract);
  });

  it("set no token the Material look does not also set, so no surface is left without a value", () => {
    const material = new Set(Object.keys(CORE_MATERIAL_DARK_TOKENS));
    expect(Object.keys(CORE_BUILTIN_DARK_TOKENS).filter((token) => !material.has(token))).toEqual([]);
  });

  it("are not the Material palette wearing new names", () => {
    const shared = THEME_TOKENS.filter((token) => CORE_BUILTIN_DARK_TOKENS[token] === CORE_MATERIAL_DARK_TOKENS[token]);
    expect(shared.length).toBeLessThan(THEME_TOKENS.length / 2);
  });

  it("are recognised as native looks, which is what keeps them out of the plugin resolver", () => {
    expect(isNativeThemeId(CORE_BUILTIN_DARK_THEME_ID)).toBe(true);
    expect(isNativeThemeId(CORE_BUILTIN_LIGHT_THEME_ID)).toBe(true);
    expect(isNativeThemeId("themes:pi-web-dark")).toBe(false);
  });
});

describe("the builtin theme pair", () => {
  it("pairs the builtin pair as its own pair, and leaves the Material pair alone", () => {
    expect(findNativeThemePair(CORE_BUILTIN_DARK_THEME_ID)).toEqual({ name: "Builtin", dark: CORE_BUILTIN_DARK_THEME_ID, light: CORE_BUILTIN_LIGHT_THEME_ID });
    expect(findNativeThemePair(CORE_MATERIAL_LIGHT_THEME_ID)).toEqual({ name: "Material", dark: CORE_MATERIAL_DARK_THEME_ID, light: CORE_MATERIAL_LIGHT_THEME_ID });
    expect(NATIVE_THEME_PAIRS).toHaveLength(2);
  });

  it("reports a pair in the plugin pair shape, so the Appearance panel offers the system switch", () => {
    const pair = nativeThemePairContribution(CORE_BUILTIN_LIGHT_THEME_ID);
    expect(pair?.light).toBe(CORE_BUILTIN_LIGHT_THEME_ID);
    expect(pair?.dark).toBe(CORE_BUILTIN_DARK_THEME_ID);
    expect(pair?.name).toBe("Builtin");
    expect(nativeThemePairContribution("themes:pi-web-dark")).toBeUndefined();
  });

  it("follows the system inside its own pair", () => {
    const darkPreference = { themeId: CORE_BUILTIN_DARK_THEME_ID, auto: true };
    expect(resolveNativeThemePaint(darkPreference, false).themeId).toBe(CORE_BUILTIN_DARK_THEME_ID);
    expect(resolveNativeThemePaint(darkPreference, true).themeId).toBe(CORE_BUILTIN_LIGHT_THEME_ID);
    const lightPreference = { themeId: CORE_BUILTIN_LIGHT_THEME_ID, auto: true };
    expect(resolveNativeThemePaint(lightPreference, false).themeId).toBe(CORE_BUILTIN_DARK_THEME_ID);
    expect(resolveNativeThemePaint(lightPreference, true).themeId).toBe(CORE_BUILTIN_LIGHT_THEME_ID);
  });

  it("keeps the Material pair's system swap exactly as it was", () => {
    const preference = { themeId: CORE_MATERIAL_DARK_THEME_ID, auto: true };
    expect(resolveNativeThemePaint(preference, true).themeId).toBe(CORE_MATERIAL_LIGHT_THEME_ID);
    expect(resolveNativeThemePaint(preference, false).themeId).toBe(CORE_MATERIAL_DARK_THEME_ID);
  });

  it("keeps an explicit pick, whatever the system says, and says it is not following", () => {
    const explicit = { themeId: CORE_BUILTIN_LIGHT_THEME_ID, auto: false };
    expect(resolveNativeThemePaint(explicit, false)).toEqual({ themeId: CORE_BUILTIN_LIGHT_THEME_ID, followsSystem: false });
    const explicitMaterial = { themeId: CORE_MATERIAL_LIGHT_THEME_ID, auto: false };
    expect(resolveNativeThemePaint(explicitMaterial, false)).toEqual({ themeId: CORE_MATERIAL_LIGHT_THEME_ID, followsSystem: false });
  });

  it("falls back to the Material system swap for a native theme that has no pair", () => {
    const unpaired = { themeId: CORE_MATERIAL_DARK_THEME_ID, auto: true };
    expect(resolveNativeThemePaint(unpaired, true)).toEqual({ themeId: CORE_MATERIAL_LIGHT_THEME_ID, followsSystem: true });
  });
});
