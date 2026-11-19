import { useEffect } from "react";
import {
  CORE_MATERIAL_DARK_THEME_ID,
  NATIVE_THEME_PAIRS,
  THEME_STORAGE_KEY,
  applyNativeThemeById,
  applyPiWebTheme,
  readStoredThemePreference,
  resolveNativeThemePaint,
  resolveThemePreference,
  serializedThemePreference,
  type ThemePreference,
} from "../../theme";
import type { QualifiedContributionId, QualifiedThemeContribution, QualifiedThemePairContribution } from "../../plugins/types";
import { createStore, useStoreSelect } from "./store";

/**
 * Theme painting for the React shell, on top of PI WEB's own theme engine.
 *
 * The four native looks (Material Dark/Light, Darkness/Lightness), the stored
 * preference, "follow the system", plugin themes, plugin theme pairs, the
 * `data-pi-web-theme` attribute, the theme-color meta and the favicon all come
 * from `theme.ts` unchanged. The shell only decides when to repaint and what
 * the plugin registry contributed.
 */
export interface ThemeState {
  readonly preference: ThemePreference;
  readonly paintedId: QualifiedContributionId | undefined;
  readonly followsSystem: boolean;
}

/*
 * The reference workspace is the dark one, so a browser that has never chosen a
 * theme starts on the app's native dark palette with "follow the system" off; a
 * reader's stored choice - including a light theme, a plugin theme, or following
 * the system - is honoured exactly as the app has always honoured it.
 */
const storedPreference = readStoredThemePreference() ?? { themeId: CORE_MATERIAL_DARK_THEME_ID, auto: false };

export const themeStore = createStore<ThemeState>({
  preference: storedPreference,
  paintedId: undefined,
  followsSystem: false,
});

let pluginThemes: readonly QualifiedThemeContribution[] = [];
let pluginThemePairs: readonly QualifiedThemePairContribution[] = [];

function prefersLight(): boolean {
  return window.matchMedia("(prefers-color-scheme: light)").matches;
}

function scope(preference: ThemePreference, followsSystem: boolean): { preference: string; followsSystem: boolean } {
  return { preference: serializedThemePreference(preference), followsSystem };
}

export function repaintTheme(): void {
  const preference = themeStore.get().preference;
  const light = prefersLight();
  const pluginResolution = resolveThemePreference({
    preference,
    themes: pluginThemes,
    themePairs: pluginThemePairs,
    prefersLight: light,
  });
  if (pluginResolution.activeTheme !== undefined) {
    const followsSystem = preference.auto && pluginResolution.selectedThemePair !== undefined;
    applyPiWebTheme(pluginResolution.activeTheme, scope(preference, followsSystem));
    themeStore.set({ preference, paintedId: pluginResolution.activeTheme.id, followsSystem });
    return;
  }
  const native = resolveNativeThemePaint(preference, light);
  const painted = applyNativeThemeById(native.themeId, scope(preference, native.followsSystem));
  themeStore.set({ preference, paintedId: painted ? native.themeId : undefined, followsSystem: native.followsSystem });
}

export function setThemePreference(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, serializedThemePreference(preference));
  } catch {
    // A browser that refuses storage keeps the choice for this page only.
  }
  themeStore.update((current) => ({ ...current, preference }));
  repaintTheme();
}

/** Plugin themes are contributions, not core constants: the plugin host hands them over when the manifest arrives. */
export function setPluginThemes(themes: readonly QualifiedThemeContribution[], pairs: readonly QualifiedThemePairContribution[] = []): void {
  pluginThemes = themes;
  pluginThemePairs = pairs;
  repaintTheme();
}

export function useThemeState(): ThemeState {
  return useStoreSelect(themeStore, (value) => value);
}

/** The system's light/dark preference moves an auto preference, exactly as the app has always done. */
export function useThemeSystemFollow(): void {
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = (): void => {
      repaintTheme();
    };
    media.addEventListener("change", onChange);
    return () => { media.removeEventListener("change", onChange); };
  }, []);
}

export const nativeThemeChoices = NATIVE_THEME_PAIRS;
