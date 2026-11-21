import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { NATIVE_THEME_CHOICES, THEME_TOKENS } from "../theme";

const tokensPath = fileURLToPath(new URL("./tokens.css", import.meta.url));
const stylesheet = readFileSync(tokensPath, "utf8");

function declarations(css: string): Map<string, string> {
  const body = css.slice(css.indexOf("{") + 1, css.lastIndexOf("}"));
  const found = new Map<string, string>();
  for (const entry of body.split(";")) {
    const separator = entry.indexOf(":");
    if (separator < 0) continue;
    const name = entry.slice(0, separator).trim();
    const value = entry.slice(separator + 1).trim();
    if (name.startsWith("--rw-")) found.set(name, value);
  }
  return found;
}

const values = declarations(stylesheet);

/**
 * The React surface is a projection of the theme, not a second palette.
 *
 * The React app reads `--rw-*`; the app's one theme applier (`theme.ts`'s `applyNativeTheme`) paints
 * `--pi-*` on the root element. When those two stopped talking, the Appearance control changed the
 * stored theme and the document's `color-scheme` while the React surface kept its own fixed colours, so
 * the reader saw nothing move. These assertions keep the projection: every React colour names a theme
 * token the applier paints, the token names are ones the applier knows, and every native theme answers
 * them.
 */
describe("React palette", () => {
  const themeTokens = new Set<string>(THEME_TOKENS);

  it("names every React colour after a theme token, so a theme change reaches the surface", () => {
    const names = [...values.keys()];
    expect(names.length).toBeGreaterThan(15);
    const detached = names.filter((name) => !values.get(name)!.includes("var(--pi-"));
    expect(detached).toEqual([]);
  });

  it("consults only tokens the theme applier paints", () => {
    const consulted = new Set([...stylesheet.matchAll(/var\((--pi-[a-z0-9-]+)/g)].map((match) => match[1]!));
    expect(consulted.size).toBeGreaterThan(10);
    expect([...consulted].filter((token) => !themeTokens.has(token))).toEqual([]);
  });

  it("is answered by every theme the Appearance page offers", () => {
    const consulted = [...new Set([...stylesheet.matchAll(/var\((--pi-[a-z0-9-]+)/g)].map((match) => match[1]!))];
    for (const theme of NATIVE_THEME_CHOICES) {
      const tokens = theme.tokens as Record<string, string | undefined>;
      const missing = consulted.filter((token) => tokens[token] === undefined);
      expect(missing, `${theme.id} paints every token the React surface reads`).toEqual([]);
    }
  });

  it("keeps the previous palette as the fallback, so the first frame and a sparse theme still answer", () => {
    const colours = new Map([...values].filter(([name]) => name !== "--rw-font"));
    const withoutFallback = [...colours].filter(([, value]) => !/#[0-9a-f]{3,8}/i.test(value));
    expect(withoutFallback).toEqual([]);
    expect(values.get("--rw-font"), "the font stack keeps its own fallback").toContain("ui-sans-serif");
    expect(stylesheet).toContain("color-scheme: dark");
  });
});
