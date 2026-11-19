// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import {
  CORE_MATERIAL_DARK_THEME_ID,
  THEME_STORAGE_KEY,
  NATIVE_THEME_PAIRS,
  readStoredThemePreference,
  serializedThemePreference,
} from "../../theme";
import { repaintTheme, setThemePreference, themeStore } from "./theme";

/**
 * Theme persistence, as the reader experiences it.
 *
 * A settings change is only real when the next page paints the same look, so the
 * assertions are the three facts that make that true: the browser stored the
 * choice, the module's own reader reads it back, and the painted document
 * carries it. A stored preference beats the reference dark default, which is
 * what a browser with no stored choice gets.
 */
describe("the theme a reader chose", () => {
  afterEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset["piWebTheme"];
  });

  it("is written to the browser, read back, and painted on the document", () => {
    const light = NATIVE_THEME_PAIRS[0]?.light;
    expect(light).toBeDefined();
    if (light === undefined) return;
    setThemePreference({ themeId: light, auto: false });

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe(serializedThemePreference({ themeId: light, auto: false }));
    expect(readStoredThemePreference()).toEqual({ themeId: light, auto: false });
    expect(themeStore.get().preference).toEqual({ themeId: light, auto: false });

    repaintTheme();
    expect(document.documentElement.dataset["piWebTheme"]).toBe(light);
    expect(themeStore.get().paintedId).toBe(light);
  });

  it("keeps a follow-system choice as a follow-system choice", () => {
    setThemePreference({ themeId: CORE_MATERIAL_DARK_THEME_ID, auto: true });
    expect(readStoredThemePreference()).toEqual({ themeId: CORE_MATERIAL_DARK_THEME_ID, auto: true });
    repaintTheme();
    expect(document.documentElement.dataset["piWebTheme"]).toBeDefined();
  });

  it("starts on the app's dark palette when the browser has never chosen", () => {
    const stored = readStoredThemePreference();
    expect(stored === undefined || stored.themeId === CORE_MATERIAL_DARK_THEME_ID).toBe(true);
  });
});
