/**
 * The browser's own chrome follows the active theme.
 *
 * `meta[name="theme-color"]` is how a mobile browser paints its address bar and how the platform
 * tints the page before CSS runs. `index.html` can carry one value - the look a first paint uses -
 * so the tag is rewritten whenever a theme is applied: a reader who chose a light look should not get
 * a dark browser frame around it, and a theme whose canvas is charcoal should not open in a white
 * one. `color-scheme` (set with the tokens) covers the form controls and the scrollbar.
 */

export interface MetaColorTag {
  setAttribute(name: string, value: string): void;
}

export interface MetaColorDocument {
  querySelector(selector: string): MetaColorTag | null;
}

/** The colour the browser is asked to wear: the theme's canvas. */
export function themeMetaColor(tokens: Record<string, string>): string | undefined {
  return tokens["--pi-bg"];
}

export function applyThemeMetaColor(tokens: Record<string, string>, doc: MetaColorDocument): void {
  const canvas = themeMetaColor(tokens);
  if (canvas === undefined) return;
  const meta = doc.querySelector('meta[name="theme-color"]');
  if (meta === null) return;
  meta.setAttribute("content", canvas);
}
