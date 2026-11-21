import { useCallback, useEffect, useMemo, useState } from "react";
import type { QualifiedContributionId, QualifiedThemeContribution, QualifiedThemePairContribution } from "../plugins/types";
import type { PluginRegistry } from "../plugins/registry";
import {
  CORE_MATERIAL_DARK_THEME_ID,
  NATIVE_THEME_CHOICES,
  NATIVE_THEME_PAIRS,
  applyPiWebTheme,
  readStoredThemePreference,
  resolveThemePreference,
  serializedThemePreference,
  writeStoredThemePreference,
  type ThemePreference,
} from "../theme";
import { reactThemeChoices, type ReactThemeChoice } from "./settings/reactThemeChoices";

/** What the theme surface knows: the current choice, what is offered, and how to change it. */
export interface AppliedTheme {
  readonly preference: ThemePreference;
  readonly choices: readonly ReactThemeChoice[];
  /** Why the current preference is not painted, in words a reader can act on. Absent means painted. */
  readonly failure: string | undefined;
  /** Paint and remember one theme. Returns whether it was found. */
  select(themeId: string): boolean;
  /** Follow the system's light/dark preference inside the chosen theme's pair. */
  setAuto(auto: boolean): void;
}

/**
 * The theme the application wears, applied by React.
 *
 * Three things had to come together here. The stored preference has to be painted when the page
 * opens, not only when Settings changes it — a reload that came back in the default palette threw
 * away what the reader chose. A theme a plugin contributes has to be offered and painted, since it
 * is data the React page can paint with no plugin rendering at all. And a preference that asks to
 * follow the system has to keep following it, which means listening to the media query for as long as
 * the page is open.
 *
 * A theme from a machine's plugins is not offered while those plugins are still loading, and that is
 * said quietly: the theme arrives with the plugin, and a page that announces a missing theme on every
 * load would train the reader to ignore the notice that means it really is gone. A stored id that
 * stays unknown is reported, not repainted — the page keeps its look and says why.
 */
export function useAppliedTheme(registry: PluginRegistry | undefined, machineId: string, revision: number): AppliedTheme {
  const [preference, setPreference] = useState<ThemePreference>(() => readStoredThemePreference() ?? { themeId: CORE_MATERIAL_DARK_THEME_ID, auto: false });
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const [prefersLight, setPrefersLight] = useState(() => mediaPrefersLight());

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const change = () => {
      setPrefersLight(media.matches);
    };
    change();
    media.addEventListener("change", change);
    return () => {
      media.removeEventListener("change", change);
    };
  }, []);

  // The registry is rebooted with the machine, and its themes come back with it; the revision is the
  // host's own signal that contributions changed, so themes are re-read on it and on nothing else.
  const loading = registry === undefined;
  const themes = useMemo(
    () => [...nativeThemeContributions(), ...(registry?.getThemes() ?? [])],
    [registry, machineId, revision],
  );
  const pairs = useMemo(
    () => [...nativeThemePairs(), ...(registry?.getThemePairs() ?? [])],
    [registry, machineId, revision],
  );
  const choices = useMemo(() => reactThemeChoices(registry?.getThemes() ?? []), [registry, machineId, revision]);

  useEffect(() => {
    const resolution = resolveThemePreference({ themes, themePairs: pairs, preference, prefersLight });
    const active = resolution.activeTheme ?? resolution.selectedTheme;
    if (active !== undefined) {
      applyPiWebTheme(active, { preference: serializedThemePreference(preference), followsSystem: preference.auto });
      setFailure(undefined);
      return;
    }
    setFailure(loading ? undefined : `${preference.themeId} is not offered on this machine. The current theme stays as it is.`);
  }, [preference, themes, pairs, prefersLight, loading]);

  const select = useCallback((themeId: QualifiedContributionId) => {
    if (!themes.some((theme) => theme.id === themeId)) {
      setFailure(`${themeId} is not offered on this machine. The current theme stays as it is.`);
      return false;
    }
    const next: ThemePreference = { themeId, auto: false };
    setPreference(next);
    writeStoredThemePreference(next);
    return true;
  }, [themes]);

  const setAuto = useCallback((auto: boolean) => {
    setPreference((current: ThemePreference) => {
      const next = { ...current, auto };
      writeStoredThemePreference(next);
      return next;
    });
  }, []);

  return { preference, choices, failure, select, setAuto };
}

/**
 * PI WEB's own looks in the shape a theme contribution has, so one resolution answers "what is
 * painted" for native and contributed themes together. The core's looks are not plugin contributions;
 * this is where they join the same list.
 */
function nativeThemeContributions(): QualifiedThemeContribution[] {
  return NATIVE_THEME_CHOICES.map((theme) => ({
    id: theme.id,
    pluginId: "core",
    localId: theme.id.split(":").slice(1).join(":"),
    name: theme.name,
    description: theme.description,
    colorScheme: theme.colorScheme,
    tokens: theme.tokens,
  }));
}

function nativeThemePairs(): QualifiedThemePairContribution[] {
  return NATIVE_THEME_PAIRS.map((pair, index) => ({
    id: `core:native-pair-${String(index)}`,
    pluginId: "core",
    localId: `native-pair-${String(index)}`,
    name: pair.name,
    light: pair.light,
    dark: pair.dark,
  }));
}

function mediaPrefersLight(): boolean {
  return window.matchMedia("(prefers-color-scheme: light)").matches;
}
