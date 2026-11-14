// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import {
  CORE_BUILTIN_DARK_THEME_ID,
  CORE_BUILTIN_LIGHT_THEME_ID,
  CORE_MATERIAL_DARK_THEME_ID,
  CORE_MATERIAL_LIGHT_THEME_ID,
  THEME_STORAGE_KEY,
  THEME_TOKENS,
  applyNativeThemeById,
  readStoredThemePreference,
  resolvedThemePreferenceId,
  serializedThemePreference,
  writeStoredThemePreference,
} from "./theme";
import { CORE_BUILTIN_DARK_TOKENS } from "./builtinDarkTheme";
import { CORE_BUILTIN_LIGHT_TOKENS } from "./builtinLightTheme";

afterEach(() => {
  document.documentElement.removeAttribute("data-pi-web-theme");
  document.documentElement.style.colorScheme = "";
  for (const token of THEME_TOKENS) document.documentElement.style.removeProperty(token);
  window.localStorage.clear();
});

const scope = { preference: serializedThemePreference({ themeId: CORE_BUILTIN_DARK_THEME_ID, auto: false }), followsSystem: false };

describe("painting a builtin look", () => {
  it("paints Builtin Dark with its own tokens, in the dark scheme", () => {
    expect(applyNativeThemeById(CORE_BUILTIN_DARK_THEME_ID, scope)).toBe(true);

    const root = document.documentElement;
    expect(root.dataset["piWebTheme"]).toBe(CORE_BUILTIN_DARK_THEME_ID);
    expect(root.style.colorScheme).toBe("dark");
    expect(root.style.getPropertyValue("--pi-bg")).toBe(CORE_BUILTIN_DARK_TOKENS["--pi-bg"]);
  });

  it("paints Builtin Light in the light scheme, with every contract token set", () => {
    expect(applyNativeThemeById(CORE_BUILTIN_LIGHT_THEME_ID, { ...scope, preference: serializedThemePreference({ themeId: CORE_BUILTIN_LIGHT_THEME_ID, auto: false }) })).toBe(true);

    const root = document.documentElement;
    expect(root.style.colorScheme).toBe("light");
    const missing = THEME_TOKENS.filter((token) => root.style.getPropertyValue(token) === "");
    expect(missing).toEqual([]);
  });

  it("asks the browser to wear the theme's canvas, in both directions of the pair", () => {
    const meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    meta.setAttribute("content", "#141218");
    document.head.append(meta);
    try {
      applyNativeThemeById(CORE_BUILTIN_LIGHT_THEME_ID, { ...scope, preference: serializedThemePreference({ themeId: CORE_BUILTIN_LIGHT_THEME_ID, auto: false }) });
      expect(meta.getAttribute("content")).toBe(CORE_BUILTIN_LIGHT_TOKENS["--pi-bg"]);

      applyNativeThemeById(CORE_BUILTIN_DARK_THEME_ID, scope);

      expect(meta.getAttribute("content")).toBe(CORE_BUILTIN_DARK_TOKENS["--pi-bg"]);
    } finally {
      meta.remove();
    }
  });

  it("leaves the page alone for a theme the core does not own, so a plugin id cannot blank the palette", () => {
    expect(applyNativeThemeById("themes:some-pack", scope)).toBe(false);
    expect(document.documentElement.dataset["piWebTheme"]).toBeUndefined();
  });

  it("keeps painting the Material looks by their own ids", () => {
    expect(applyNativeThemeById(CORE_MATERIAL_LIGHT_THEME_ID, scope)).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("light");
    expect(document.documentElement.style.getPropertyValue("--pi-bg")).not.toBe(CORE_BUILTIN_LIGHT_TOKENS["--pi-bg"]);
  });
});

describe("a saved preference that names a builtin look", () => {
  it("round-trips through storage with its auto flag", () => {
    writeStoredThemePreference({ themeId: CORE_BUILTIN_DARK_THEME_ID, auto: true });

    expect(readStoredThemePreference()).toEqual({ themeId: CORE_BUILTIN_DARK_THEME_ID, auto: true });
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe(serializedThemePreference({ themeId: CORE_BUILTIN_DARK_THEME_ID, auto: true }));
  });

  it("resolves a preference saved before the builtin looks existed to the Material look it named", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({ themeId: "core:pro", auto: false }));

    expect(readStoredThemePreference()).toEqual({ themeId: CORE_MATERIAL_DARK_THEME_ID, auto: false });
    expect(resolvedThemePreferenceId("core:pro", [])).toBe(CORE_MATERIAL_DARK_THEME_ID);
    expect(resolvedThemePreferenceId(CORE_BUILTIN_LIGHT_THEME_ID, [])).toBe(CORE_BUILTIN_LIGHT_THEME_ID);
  });
});
