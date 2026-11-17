import type { QualifiedContributionId, ThemeToken } from "./plugins/types";

export const CORE_BUILTIN_DARK_THEME_ID: QualifiedContributionId = "core:builtin-dark";

/**
 * Darkness: a focused charcoal workspace with layered surfaces and a violet interaction accent.
 *
 * The stops are measured off the workspace reference (docs/ui-design): a neutral-cool charcoal
 * canvas at #1a1a21, panel/card/raised steps a few points apart, and one violet spent on
 * selection, the primary control and focus. Purple is not a label colour in this look — a tree
 * row, a "show more" and a tab label are ink, not accent, because the reference's purple is a
 * fill and not a text style. Shapes are tighter than Material's: the reference rounds a card by
 * 10px, not 13. Every ink clears AA on the surface it is documented to sit on
 * (builtinThemes.contrast.test.ts), and the tokens are complete, so the pre-JavaScript paint is
 * this look.
 */
export const CORE_BUILTIN_DARK_TOKENS = {
  "--pi-font-ui": "ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif",
  "--pi-font-display": "\"SF Pro Display\", \"Segoe UI Variable Display\", Inter, \"Helvetica Neue\", ui-sans-serif, system-ui, sans-serif",
  "--pi-font-mono": "ui-monospace, SFMono-Regular, \"SF Mono\", Menlo, Consolas, \"Liberation Mono\", monospace",
  "--pi-radius-xs": "4px",
  "--pi-radius-sm": "6px",
  "--pi-radius-md": "8px",
  "--pi-radius-lg": "10px",
  "--pi-radius-xl": "14px",
  "--pi-bg": "#1a1a21",
  "--pi-surface": "#212028",
  "--pi-surface-hover": "#28272f",
  "--pi-terminal-bg": "#131319",
  "--pi-terminal-text": "#e9e8ee",
  "--pi-border": "#34333d",
  "--pi-border-muted": "#27262f",
  "--pi-text": "#e9e8ee",
  "--pi-text-secondary": "#c3c2cb",
  "--pi-text-bright": "#ffffff",
  "--pi-muted": "#9c9ba5",
  "--pi-dim": "#8b8a94",
  "--pi-accent": "#a48cf0",
  "--pi-on-accent": "#1c1428",
  "--pi-accent-border": "#6a5a99",
  "--pi-selection-bg": "#3d3849",
  "--pi-success": "#78d6a0",
  "--pi-success-border": "#3c7654",
  "--pi-success-bg": "#182820",
  "--pi-success-surface": "#20392a",
  "--pi-success-ring": "#78d6a055",
  "--pi-warning": "#efbd75",
  "--pi-warning-border": "#80602f",
  "--pi-warning-surface": "#302516",
  "--pi-danger": "#ffaaa9",
  "--pi-purple": "#c1a6f5",
  "--pi-purple-border": "#7b64ad",
  "--pi-purple-surface": "#2a2438",
  "--pi-overlay": "#00000073",
  "--pi-shadow-soft": "#00000026",
  "--pi-shadow": "#00000040",
  "--pi-shadow-strong": "#0000005c",
  "--pi-bg-overlay-soft": "#1a1a21dd",
  "--pi-bg-overlay": "#1a1a21e6",
  "--pi-success-bg-overlay": "#182820ee",
  "--pi-terminal-selection": "#3a4d68",
  "--pi-surface-canvas": "#1a1a21",
  "--pi-surface-panel": "#1d1d25",
  "--pi-surface-card": "#24232c",
  "--pi-surface-raised": "#2d2b37",
  "--pi-surface-active": "#37353f",
  "--pi-msg-user-bg": "#34314a",
  "--pi-msg-user-border": "#4d4670",
  "--pi-msg-user-header-bg": "#3b3752",
  "--pi-msg-assistant-bg": "#212028",
  "--pi-msg-assistant-border": "#27262f",
  "--pi-msg-assistant-header-bg": "#212028",
  "--pi-msg-system-bg": "#262334",
  "--pi-msg-system-border": "#4e4270",
  "--pi-msg-system-header-bg": "#262334",
  "--pi-accent-soft": "#322d44",
  "--pi-accent-soft-hover": "#3b3450",
  "--pi-on-accent-soft": "#ded3f5",
  "--pi-focus-ring": "#a48cf0",
  "--pi-row-hover": "#24232c",
  "--pi-divider": "#24232c",
  "--pi-chip-bg": "#232229",
  "--pi-chip-border": "#34333d",
  "--pi-code-bg": "#131319",
  "--pi-code-border": "#2f2e38",
  "--pi-sheen": "inset 0 1px 0 #ffffff0d"
} satisfies Record<ThemeToken, string>;
