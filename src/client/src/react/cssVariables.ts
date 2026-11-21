import type { CSSProperties } from "react";

/**
 * A style object that carries CSS custom properties.
 *
 * React's `CSSProperties` is a closed type (`csstype`'s properties only), so an
 * inline `--left-width` needs an assertion at every call site. The React
 * workbench styles itself on custom properties — theme tokens, panel widths,
 * tree depth — so the two places that set them from state share one call that
 * is checked, and the augmentation the platform asks for is declared once, in
 * the module that exists to say what a CSS variable in a style is.
 */
declare module "react" {
  // The augmentation React's own documentation asks for. A named Record member would not make
  // `--left-width` a valid style property, so the index signature has to sit on the interface.
  // eslint-disable-next-line @typescript-eslint/consistent-indexed-object-style
  interface CSSProperties {
    readonly [key: `--${string}`]: string | number | undefined;
  }
}

/** The style object for CSS custom properties set from React state. */
export function cssVariables(vars: Record<`--${string}`, string | number | undefined>): CSSProperties {
  return vars;
}
