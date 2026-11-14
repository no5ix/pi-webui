import type { QualifiedContributionId, ThemeToken } from "./plugins/types";

export const CORE_BUILTIN_LIGHT_THEME_ID: QualifiedContributionId = "core:builtin-light";

/**
 * The neutral light look: a white page, near-white secondary surfaces, and one restrained blue.
 *
 * The Material light look carries a full colour system - tonal surfaces, a purple primary, visible
 * elevation. This look is deliberately quieter: surfaces are separated by a few percent of grey, so
 * a long reading or coding session has no card edges and no tint to fight, and the accent appears
 * only where an action is real. The tokens are complete, so the pre-JavaScript paint is this look.
 */
export const CORE_BUILTIN_LIGHT_TOKENS = {
  "--pi-font-ui": "ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif",
  "--pi-font-display": "\"SF Pro Display\", \"Segoe UI Variable Display\", Inter, \"Helvetica Neue\", ui-sans-serif, system-ui, sans-serif",
  "--pi-font-mono": "ui-monospace, SFMono-Regular, \"SF Mono\", Menlo, Consolas, \"Liberation Mono\", monospace",
  "--pi-radius-xs": "4px",
  "--pi-radius-sm": "6px",
  "--pi-radius-md": "8px",
  "--pi-radius-lg": "10px",
  "--pi-radius-xl": "14px",
  "--pi-bg": "#ffffff",
  "--pi-surface": "#f9f9f9",
  "--pi-surface-hover": "#f0f0f0",
  "--pi-terminal-bg": "#fbfbfb",
  "--pi-terminal-text": "#1f1f1f",
  "--pi-border": "#e2e2e2",
  "--pi-border-muted": "#ededed",
  "--pi-text": "#1f1f1f",
  "--pi-text-secondary": "#414141",
  "--pi-text-bright": "#0d0d0d",
  "--pi-muted": "#6d6d6d",
  "--pi-dim": "#8c8c8c",
  "--pi-accent": "#2b6cb0",
  "--pi-on-accent": "#ffffff",
  "--pi-accent-border": "#c2d6ea",
  "--pi-selection-bg": "#d6e6f7",
  "--pi-success": "#137a43",
  "--pi-success-border": "#b5dcc3",
  "--pi-success-bg": "#f0f8f3",
  "--pi-success-surface": "#e7f3ec",
  "--pi-success-ring": "#137a4355",
  "--pi-warning": "#8a5a17",
  "--pi-warning-border": "#e6d0a8",
  "--pi-warning-surface": "#fdf6ea",
  "--pi-danger": "#b3261e",
  "--pi-purple": "#5c4a9e",
  "--pi-purple-border": "#cfc6e8",
  "--pi-purple-surface": "#f5f2fb",
  "--pi-overlay": "#00000059",
  "--pi-shadow-soft": "#0000000a",
  "--pi-shadow": "#00000012",
  "--pi-shadow-strong": "#0000001f",
  "--pi-bg-overlay-soft": "#ffffffdd",
  "--pi-bg-overlay": "#ffffffee",
  "--pi-success-bg-overlay": "#f0f8f3ee",
  "--pi-terminal-selection": "#d6e6f7",
  "--pi-surface-canvas": "#ffffff",
  "--pi-surface-panel": "#f9f9f9",
  "--pi-surface-card": "#f4f4f4",
  "--pi-surface-raised": "#ededed",
  "--pi-surface-active": "#e4e4e4",
  "--pi-msg-user-bg": "#eaf1f9",
  "--pi-msg-user-border": "#d3e0ee",
  "--pi-msg-user-header-bg": "#e0eaf6",
  "--pi-msg-assistant-bg": "#ffffff",
  "--pi-msg-assistant-border": "#ededed",
  "--pi-msg-assistant-header-bg": "#ffffff",
  "--pi-msg-system-bg": "#f6f4fb",
  "--pi-msg-system-border": "#ddd6ef",
  "--pi-msg-system-header-bg": "#f6f4fb"
} satisfies Record<ThemeToken, string>;
