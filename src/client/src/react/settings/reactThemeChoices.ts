import type { QualifiedThemeContribution } from "../../plugins/types";
import type { ThemePreference } from "../../theme";
import { NATIVE_THEME_CHOICES, selectableThemeContributions } from "../../theme";
import { CORE_MATERIAL_DARK_THEME_ID } from "../../nativeDarkTheme";

/**
 * The themes the React Appearance page offers, and how it paints one.
 *
 * A contributed theme is data — a qualified id, a name, a scheme, tokens — so the React page lists it
 * and paints it with no plugin rendering at all: `applyPiWebTheme` writes the tokens as CSS custom
 * properties on the document, the same properties PI WEB's own looks are painted from. One selector
 * therefore offers both kinds, and a reader picks a look without caring which side made it.
 */
export interface ReactThemeChoice {
  readonly id: string;
  readonly name: string;
  readonly colorScheme: "dark" | "light";
  readonly description: string;
  readonly source: "native" | "plugin";
}

/** The selectable themes in a stable order: PI WEB's own looks first, then contributions by qualified id. */
export function reactThemeChoices(themes: readonly QualifiedThemeContribution[]): readonly ReactThemeChoice[] {
  const native = NATIVE_THEME_CHOICES.map((theme) => ({
    id: theme.id,
    name: theme.name,
    colorScheme: theme.colorScheme,
    description: theme.description,
    source: "native" as const,
  }));
  const contributed = selectableThemeContributions(themes)
    .map((theme) => ({
      id: theme.id,
      name: theme.name,
      colorScheme: theme.colorScheme,
      description: theme.description ?? `From ${theme.pluginId}.`,
      source: "plugin" as const,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  // One option per id: a selector keyed by id would warn, and a reader would see the same name twice.
  const seen = new Set<string>();
  const unique = contributed.filter((choice) => (seen.has(choice.id) ? false : (seen.add(choice.id), true)));
  return [...native, ...unique];
}

/**
 * The theme to start from, given what is stored and what is offered.
 *
 * The stored id names a theme, and a theme may have been uninstalled since. A stored id that is not
 * among the choices paints nothing, and a page painted by no theme is a page nobody chose, so the
 * built-in default takes it and the Appearance page shows that default.
 */
export function resolveStoredThemePreference(
  stored: ThemePreference | undefined,
  choices: readonly ReactThemeChoice[],
): ThemePreference {
  const fallback: ThemePreference = { themeId: CORE_MATERIAL_DARK_THEME_ID, auto: false };
  if (stored === undefined) return fallback;
  return choices.some((choice) => choice.id === stored.themeId) ? stored : fallback;
}
