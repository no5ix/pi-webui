import { css, html, LitElement, type TemplateResult } from "lit";
import { interactiveSurfaceStyles } from "./shared";
import { customElement, property } from "lit/decorators.js";
import { renderCopyIcon, renderSearchIcon, renderTranslateIcon, uiIconStyle } from "./uiIcons.js";
import { unsafeCSS } from "lit";

/**
 * The small surface a reading gesture answers with.
 *
 * Double-clicking a word brings up a pill of three actions over the word; holding a sentence writes
 * its translation in the reader's own language under the sentence. Both are the same element in two
 * modes, because they are the same answer in two shapes: the reader asked about the text under their
 * pointer and got something back at that place.
 *
 * It is fixed-positioned, in viewport coordinates, so it floats over the transcript without
 * disturbing the text it annotates - the transcript is Lit-rendered and re-rendered constantly, and
 * a translation inserted into it as a node would be wiped by the next frame.
 */

export type ReadingAction = "copy" | "search" | "translate";

export type ReadingTranslation =
  | { state: "pending" }
  | { state: "ready"; text: string; source?: string }
  | { state: "failed"; message: string };

/** Where the gesture happened, in viewport coordinates. */
export interface ReadingAnchor {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

export interface ReadingSurface {
  readonly mode: "toolbar" | "translation";
  /** The text the gesture named. */
  readonly text: string;
  readonly anchor: ReadingAnchor;
  readonly translation?: ReadingTranslation;
}

const VIEWPORT_EDGE_PX = 10;
const GAP_PX = 8;

@customElement("reading-toolbar")
export class ReadingToolbar extends LitElement {
  @property({ attribute: false }) surface?: ReadingSurface;
  @property({ attribute: false }) onAction?: (action: ReadingAction, surface: ReadingSurface) => void;
  @property({ attribute: false }) onClose?: () => void;

  protected override render(): TemplateResult | null {
    const surface = this.surface;
    if (surface === undefined) return null;
    if (surface.mode === "toolbar") return this.renderPill(surface);
    return this.renderTranslation(surface);
  }

  private renderPill(surface: ReadingSurface): TemplateResult {
    return html`
      <div class="pill" style=${this.pillStyle(surface.anchor)} role="toolbar" aria-label="Reading actions">
        ${ACTION_BUTTONS.map((action) => html`
          <button type="button" data-action=${action.id} title=${action.title} aria-label=${action.title} @click=${() => { this.onAction?.(action.id, surface); }}>${action.icon}</button>
        `)}
      </div>
    `;
  }

  private renderTranslation(surface: ReadingSurface): TemplateResult {
    const translation = surface.translation;
    const body = translation === undefined
      ? html`<span class="pending">Translating…</span>`
      : translation.state === "pending"
        ? html`<span class="pending">Translating…</span>`
        : translation.state === "failed"
          ? html`<span class="failed">${translation.message}</span>`
          : html`<span class="translated">${translation.text}</span>`;
    return html`
      <div class="translation" style=${this.translationStyle(surface.anchor)} role="note" aria-label="Translation">
        <button type="button" class="dismiss" title="Dismiss the translation" aria-label="Dismiss the translation" @click=${() => { this.onClose?.(); }}>×</button>
        ${body}
      </div>
    `;
  }

  /**
   * The pill sits over the word, on the line above it, and kept inside the viewport: a word at the
   * right edge of a phone screen is a common case, and a pill that runs off-screen offers nothing.
   */
  private pillStyle(anchor: ReadingAnchor): string {
    const width = PILL_WIDTH_PX;
    const left = clamp(anchor.left, VIEWPORT_EDGE_PX, Math.max(VIEWPORT_EDGE_PX, window.innerWidth - width - VIEWPORT_EDGE_PX));
    const top = Math.max(VIEWPORT_EDGE_PX, anchor.top - GAP_PX);
    return `left: ${String(left)}px; top: ${String(top)}px; transform: translateY(-100%);`;
  }

  private translationStyle(anchor: ReadingAnchor): string {
    const left = clamp(anchor.left, VIEWPORT_EDGE_PX, Math.max(VIEWPORT_EDGE_PX, window.innerWidth - MIN_TRANSLATION_WIDTH_PX - VIEWPORT_EDGE_PX));
    const width = Math.max(MIN_TRANSLATION_WIDTH_PX, Math.min(window.innerWidth - 2 * VIEWPORT_EDGE_PX, anchor.right - anchor.left));
    return `left: ${String(left)}px; top: ${String(anchor.bottom + 4)}px; width: ${String(width)}px;`;
  }

  static override styles = css`${unsafeCSS(uiIconStyle)}${interactiveSurfaceStyles}
    :host { position: fixed; left: 0; top: 0; width: 0; height: 0; z-index: 6; display: block; pointer-events: none; }
    .pill { position: fixed; pointer-events: auto; display: inline-flex; align-items: center; gap: var(--pi-space-3); padding: var(--pi-space-2) var(--pi-space-3); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-lg); background: var(--pi-surface-card); box-shadow: var(--pi-elevation-3); }
    .pill button { box-sizing: border-box; display: inline-grid; place-items: center; width: var(--pi-control-height-comfort); height: var(--pi-control-height-comfort); border: 0; border-radius: var(--pi-radius-md); background: transparent; color: var(--pi-text-secondary); cursor: pointer; padding: 0; }
    @media (pointer: coarse) { .pill button { width: var(--pi-control-height-touch); height: var(--pi-control-height-touch); } }
    @media (hover: hover) { .pill button:hover { background: var(--pi-surface-hover); color: var(--pi-text); } }
    .pill button:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset); }
    .pill .ui-icon { width: 18px; height: 18px; }
    .translation { position: fixed; pointer-events: auto; padding: var(--pi-space-2) var(--pi-space-3); border-radius: var(--pi-radius-md); background: var(--pi-surface-card); box-shadow: var(--pi-elevation-2); color: var(--pi-muted); font-size: var(--pi-text-sm); line-height: 1.45; overflow-wrap: anywhere; }
    .translation .failed { color: var(--pi-danger); }
    .translation .dismiss { float: right; border: 0; background: transparent; color: var(--pi-muted); font-size: var(--pi-text-sm); line-height: 1; cursor: pointer; padding: 0 var(--pi-space-2); }
    @media (hover: hover) { .translation .dismiss:hover { color: var(--pi-text); } }
  `;
}

const PILL_WIDTH_PX = 140;
const MIN_TRANSLATION_WIDTH_PX = 220;

const ACTION_BUTTONS: readonly { id: ReadingAction; title: string; icon: TemplateResult }[] = [
  { id: "copy", title: "Copy", icon: renderCopyIcon() },
  { id: "search", title: "Search the web", icon: renderSearchIcon() },
  { id: "translate", title: "Translate", icon: renderTranslateIcon() },
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

declare global {
  interface HTMLElementTagNameMap {
    "reading-toolbar": ReadingToolbar;
  }
}
