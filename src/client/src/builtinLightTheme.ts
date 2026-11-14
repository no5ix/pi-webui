import type { QualifiedContributionId, ThemeToken } from "./plugins/types";

export const CORE_BUILTIN_LIGHT_THEME_ID: QualifiedContributionId = "core:builtin-light";

/**
 * Lightness: a warm paper workspace with white surfaces and restrained violet interactions.
 *
 * The palette starts with a warm off-white canvas, crisp white content surfaces, and gentle gray
 * separators. Violet is used for selection and primary actions; subtle elevation separates floating
 * controls without wrapping every element in a card. The tokens are complete for pre-JavaScript paint.
 */
export const CORE_BUILTIN_LIGHT_TOKENS = {
  "--pi-font-ui": "ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif",
  "--pi-font-display": "\"SF Pro Display\", \"Segoe UI Variable Display\", Inter, \"Helvetica Neue\", ui-sans-serif, system-ui, sans-serif",
  "--pi-font-mono": "ui-monospace, SFMono-Regular, \"SF Mono\", Menlo, Consolas, \"Liberation Mono\", monospace",
  "--pi-radius-xs": "5px",
  "--pi-radius-sm": "8px",
  "--pi-radius-md": "10px",
  "--pi-radius-lg": "13px",
  "--pi-radius-xl": "18px",
  "--pi-bg": "#f6f4f1",
  "--pi-surface": "#fffefd",
  "--pi-surface-hover": "#eee9f2",
  "--pi-terminal-bg": "#fbfaf8",
  "--pi-terminal-text": "#292431",
  "--pi-border": "#ded9e3",
  "--pi-border-muted": "#ebe7ed",
  "--pi-text": "#272331",
  "--pi-text-secondary": "#514b59",
  "--pi-text-bright": "#17131d",
  "--pi-muted": "#77717f",
  "--pi-dim": "#918b98",
  "--pi-accent": "#7040b5",
  "--pi-on-accent": "#ffffff",
  "--pi-accent-border": "#cdb9eb",
  "--pi-selection-bg": "#eee6f8",
  "--pi-success": "#16754a",
  "--pi-success-border": "#b8dfc9",
  "--pi-success-bg": "#edf8f1",
  "--pi-success-surface": "#e3f3e9",
  "--pi-success-ring": "#16754a55",
  "--pi-warning": "#956019",
  "--pi-warning-border": "#ead5af",
  "--pi-warning-surface": "#fff7e9",
  "--pi-danger": "#b52c35",
  "--pi-purple": "#7040b5",
  "--pi-purple-border": "#d5c5ea",
  "--pi-purple-surface": "#f4eefb",
  "--pi-overlay": "#00000059",
  "--pi-shadow-soft": "#0000000a",
  "--pi-shadow": "#00000012",
  "--pi-shadow-strong": "#0000001f",
  "--pi-bg-overlay-soft": "#f6f4f1dd",
  "--pi-bg-overlay": "#f6f4f1ee",
  "--pi-success-bg-overlay": "#f0f8f3ee",
  "--pi-terminal-selection": "#d6e6f7",
  "--pi-surface-canvas": "#f6f4f1",
  "--pi-surface-panel": "#fffefd",
  "--pi-surface-card": "#faf8f6",
  "--pi-surface-raised": "#f1edf3",
  "--pi-surface-active": "#e8e1ee",
  "--pi-msg-user-bg": "#f0eafa",
  "--pi-msg-user-border": "#dfd1f0",
  "--pi-msg-user-header-bg": "#e9e0f5",
  "--pi-msg-assistant-bg": "#fffefd",
  "--pi-msg-assistant-border": "#ebe7ed",
  "--pi-msg-assistant-header-bg": "#fffefd",
  "--pi-msg-system-bg": "#f2edf8",
  "--pi-msg-system-border": "#dcd0eb",
  "--pi-msg-system-header-bg": "#f2edf8"
} satisfies Record<ThemeToken, string>;
