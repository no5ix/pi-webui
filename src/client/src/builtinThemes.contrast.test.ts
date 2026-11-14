// @vitest-environment node

import { describe, expect, it } from "vitest";
import { CORE_BUILTIN_DARK_TOKENS } from "./builtinDarkTheme";
import { CORE_BUILTIN_LIGHT_TOKENS } from "./builtinLightTheme";
import { CORE_MATERIAL_DARK_TOKENS } from "./nativeDarkTheme";
import { CORE_MATERIAL_LIGHT_TOKENS } from "./nativeLightTheme";

/**
 * The four built-in looks are shipped as the product's default appearance, so
 * their text has to be readable, not merely pretty. The tokens had been drifting
 * lighter: Lightness shipped a muted ink at 4.30:1 and a dim ink at 3.01:1 on the
 * canvas, and a dim ink under 4.5:1 in both dark looks - under the bar for the
 * small text that carries timestamps, paths and diff metadata. This is the guard
 * that keeps a future token edit from buying a softer look with unreadable words.
 *
 * Pairs are the text token and the surface it is documented to sit on. The floor
 * is WCAG 2.x AA for normal text (4.5:1) because every one of these pairs renders
 * at 12-15px.
 */
const AA_TEXT = 4.5;

const pairs: readonly (readonly [string, string])[] = [
  ["--pi-text", "--pi-bg"],
  ["--pi-text", "--pi-surface"],
  ["--pi-text", "--pi-chip-bg"],
  ["--pi-text-secondary", "--pi-bg"],
  ["--pi-text-bright", "--pi-bg"],
  ["--pi-muted", "--pi-bg"],
  ["--pi-dim", "--pi-bg"],
  ["--pi-muted", "--pi-accent-soft"],
  ["--pi-on-accent", "--pi-accent"],
  ["--pi-on-accent-soft", "--pi-accent-soft"],
  ["--pi-text", "--pi-code-bg"],
  ["--pi-danger", "--pi-bg"],
  ["--pi-success", "--pi-bg"],
  ["--pi-warning", "--pi-bg"],
  ["--pi-success", "--pi-success-surface"],
  ["--pi-text", "--pi-warning-surface"],
];

const themes: readonly (readonly [string, Record<string, string>])[] = [
  ["core:builtin-dark", CORE_BUILTIN_DARK_TOKENS],
  ["core:builtin-light", CORE_BUILTIN_LIGHT_TOKENS],
  ["core:material-dark", CORE_MATERIAL_DARK_TOKENS],
  ["core:material-light", CORE_MATERIAL_LIGHT_TOKENS],
];

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const digits = hex.slice(1);
  const r = Number.parseInt(digits.slice(0, 2), 16);
  const g = Number.parseInt(digits.slice(2, 4), 16);
  const b = Number.parseInt(digits.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const hexColor = /^#[0-9a-fA-F]{6}$/u;

describe("the built-in themes' text contrast", () => {
  it("meets the AA floor on every surface it documents", () => {
    const offences: string[] = [];
    for (const [themeId, tokens] of themes) {
      for (const [ink, surface] of pairs) {
        const foreground = tokens[ink];
        const background = tokens[surface];
        if (foreground === undefined || background === undefined) {
          offences.push(`${themeId}: ${ink} or ${surface} is not declared`);
          continue;
        }
        if (!hexColor.test(foreground) || !hexColor.test(background)) {
          offences.push(`${themeId}: ${ink}=${foreground} on ${surface}=${background} is not a plain colour`);
          continue;
        }
        const ratio = contrast(foreground, background);
        if (ratio < AA_TEXT) offences.push(`${themeId}: ${ink} on ${surface} is ${ratio.toFixed(2)}:1`);
      }
    }

    expect(offences).toEqual([]);
  });

  it("keeps the dim ink quieter than the muted ink it sits under", () => {
    const offenders: string[] = [];
    for (const [themeId, tokens] of themes) {
      const muted = luminance(tokens["--pi-muted"] as string);
      const dim = luminance(tokens["--pi-dim"] as string);
      const canvas = luminance(tokens["--pi-bg"] as string);
      const darkerThanCanvas = canvas < 0.5 ? dim < muted : dim > muted;
      if (!darkerThanCanvas) offenders.push(`${themeId}: --pi-dim does not read as quieter than --pi-muted`);
    }

    expect(offenders).toEqual([]);
  });
});
