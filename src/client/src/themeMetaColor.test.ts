import { describe, expect, it } from "vitest";
import { applyThemeMetaColor, themeMetaColor } from "./themeMetaColor";

/**
 * The browser's chrome follows the theme.
 *
 * A theme's canvas is what the platform is asked to wear, so the tag is rewritten from the theme's
 * own tokens - and a document without the tag, or a theme without a canvas, is left alone: a paint
 * that cannot be honest about the colour does not invent one.
 */

function fakeDocument(initial: string | undefined) {
  const written: string[] = [];
  const doc = {
    querySelector: (selector: string) => {
      if (selector !== 'meta[name="theme-color"]') return null;
      if (initial === undefined) return null;
      return { setAttribute: (_name: string, value: string) => { written.push(value); } };
    },
  };
  return { doc, written };
}

describe("the browser chrome colour", () => {
  it("asks for the theme's canvas", () => {
    expect(themeMetaColor({ "--pi-bg": "#141218" })).toBe("#141218");
    expect(themeMetaColor({})).toBeUndefined();
  });

  it("rewrites the tag from the theme tokens", () => {
    const { doc, written } = fakeDocument("#141218");

    applyThemeMetaColor({ "--pi-bg": "#ffffff", "--pi-accent": "#2b6cb0" }, doc);

    expect(written).toEqual(["#ffffff"]);
  });

  it("touches nothing when the theme has no canvas, and nothing when the page has no tag", () => {
    const withTag = fakeDocument("#141218");
    const withoutTag = fakeDocument(undefined);

    applyThemeMetaColor({ "--pi-accent": "#2b6cb0" }, withTag.doc);
    applyThemeMetaColor({ "--pi-bg": "#ffffff" }, withoutTag.doc);

    expect(withTag.written).toEqual([]);
    expect(withoutTag.written).toEqual([]);
  });
});
