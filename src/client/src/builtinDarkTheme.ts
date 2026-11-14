import type { QualifiedContributionId, ThemeToken } from "./plugins/types";

export const CORE_BUILTIN_DARK_THEME_ID: QualifiedContributionId = "core:builtin-dark";

/**
 * The neutral dark look: charcoal, not black, with surfaces a few percent apart.
 *
 * The Material dark look is a tonal system - violet-tinted surfaces, a purple primary, message
 * colours that carry their own fills. This look keeps the tint out and lets surfaces differ only
 * enough to be read as stacked: the eye survives a long session when nothing shouts. Text is
 * soft-white so the page never glares, secondary text is dimmed rather than greyed into
 * illegibility, and the single blue appears only on real actions. The tokens are complete, so the
 * pre-JavaScript paint is this look.
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
  "--pi-bg": "#212121",
  "--pi-surface": "#2a2a2a",
  "--pi-surface-hover": "#333333",
  "--pi-terminal-bg": "#1a1a1a",
  "--pi-terminal-text": "#e8e8e8",
  "--pi-border": "#4d4d4d",
  "--pi-border-muted": "#3a3a3a",
  "--pi-text": "#ececec",
  "--pi-text-secondary": "#c9c9c9",
  "--pi-text-bright": "#f8f8f8",
  "--pi-muted": "#a3a3a3",
  "--pi-dim": "#8b8b8b",
  "--pi-accent": "#7fa9e8",
  "--pi-on-accent": "#12233c",
  "--pi-accent-border": "#3f5c86",
  "--pi-selection-bg": "#3a4d68",
  "--pi-success": "#78c996",
  "--pi-success-border": "#3f6b4f",
  "--pi-success-bg": "#17281d",
  "--pi-success-surface": "#1d3423",
  "--pi-success-ring": "#78c99655",
  "--pi-warning": "#e0a86a",
  "--pi-warning-border": "#7a5a26",
  "--pi-warning-surface": "#2b2214",
  "--pi-danger": "#f0a9a4",
  "--pi-purple": "#bcaada",
  "--pi-purple-border": "#6f6196",
  "--pi-purple-surface": "#282536",
  "--pi-overlay": "#00000073",
  "--pi-shadow-soft": "#00000026",
  "--pi-shadow": "#00000040",
  "--pi-shadow-strong": "#0000005c",
  "--pi-bg-overlay-soft": "#212121dd",
  "--pi-bg-overlay": "#212121e6",
  "--pi-success-bg-overlay": "#17281dee",
  "--pi-terminal-selection": "#3a4d68",
  "--pi-surface-canvas": "#212121",
  "--pi-surface-panel": "#282828",
  "--pi-surface-card": "#2f2f2f",
  "--pi-surface-raised": "#383838",
  "--pi-surface-active": "#414141",
  "--pi-msg-user-bg": "#2b3a4d",
  "--pi-msg-user-border": "#3d5169",
  "--pi-msg-user-header-bg": "#324459",
  "--pi-msg-assistant-bg": "#2a2a2a",
  "--pi-msg-assistant-border": "#3a3a3a",
  "--pi-msg-assistant-header-bg": "#2a2a2a",
  "--pi-msg-system-bg": "#2c2937",
  "--pi-msg-system-border": "#4a4560",
  "--pi-msg-system-header-bg": "#2c2937"
} satisfies Record<ThemeToken, string>;
