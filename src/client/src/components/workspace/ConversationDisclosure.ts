import { LitElement, css, html, nothing, unsafeCSS, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { interactiveSurfaceStyles } from "../shared";
import { uiIconStyle } from "../uiIcons";
import { disclosureIconStyle, renderDisclosureIcon } from "../disclosureIcon";

/**
 * One collapsed-by-default card in the conversation's rail: Subagents,
 * Background, Edited Files.
 *
 * The reference keeps these folded so the conversation owns the middle of the
 * window, and puts the count where the heading is: a reader learns "10 edited
 * files" without opening anything, and opens the card only to read the list.
 * The chevron is at the far edge, so the affordance reads as "this whole card
 * opens", not "this row is a link".
 *
 * The card owns no data. Its content is the host's light DOM, slotted when the
 * card is open: the host decides what the truth is, including what an unknown
 * looks like.
 */
@customElement("conversation-disclosure")
export class ConversationDisclosure extends LitElement {
  @property({ type: String }) heading = "";
  @property({ attribute: false }) icon: TemplateResult | undefined;
  /** The count the heading carries. Absent means the host has no count to state. */
  @property({ type: Number }) count: number | undefined;
  /** The muted tail, for what a count cannot say ("waiting for an answer"). */
  @property({ type: String }) detail = "";
  @property({ type: Boolean, reflect: true }) expanded = false;
  @property({ type: Boolean }) disabled = false;
  @property({ type: String }) panelId = "";
  /** Called the first time the reader opens the card, before its content shows. */
  @property({ attribute: false }) onExpand: (() => void) | undefined;

  private contentId = "";

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.contentId === "") this.contentId = this.panelId !== "" ? this.panelId : `disclosure-${String(DISCLOSURE_SEQUENCE += 1)}`;
  }

  override render() {
    const count = this.count;
    return html`
      <section class="card" data-expanded=${this.expanded ? "true" : "false"}>
        <button class="toggle" type="button" aria-expanded=${this.expanded ? "true" : "false"}
          aria-controls=${this.contentId} ?disabled=${this.disabled}
          @click=${() => { const opening = !this.expanded; this.expanded = opening; if (opening) this.onExpand?.(); }}>
          ${this.icon === undefined ? nothing : html`<span class="icon" aria-hidden="true">${this.icon}</span>`}
          <span class="heading">${this.heading}</span>
          ${count === undefined ? nothing : html`<span class="count">(${String(count)})</span>`}
          ${this.detail === "" ? nothing : html`<span class="detail">${this.detail}</span>`}
          <span class="chevron" aria-hidden="true">${renderDisclosureIcon(!this.expanded)}</span>
        </button>
        ${this.expanded ? html`<div class="content" id=${this.contentId}><slot></slot></div>` : nothing}
      </section>
    `;
  }

  static override styles = [
    interactiveSurfaceStyles,
    css`${unsafeCSS(uiIconStyle)}`,
    css`${unsafeCSS(disclosureIconStyle)}`,
    css`
      :host { display: block; flex: none; }
      /* A disclosure inside the conversation is a row of the transcript, not a
         card on top of it: one muted border and the card surface, so five of
         them stacked do not read as five products. */
      .card { border: 1px solid var(--pi-border-muted); border-radius: var(--pi-radius-lg); background: var(--pi-surface-card); overflow: hidden; }
      .toggle { width: 100%; min-height: var(--pi-control-height-touch); box-sizing: border-box; display: flex; align-items: center; gap: var(--pi-space-4); padding: 0 var(--pi-space-6); border: 0; border-radius: inherit; background: transparent; color: var(--pi-text); text-align: start; font: var(--pi-text-base) var(--pi-font-ui); cursor: pointer; }
@media (hover: hover) { .toggle:hover { background: var(--pi-row-hover); } }
      .toggle:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-focus-ring); outline-offset: var(--pi-focus-ring-offset-inset); }
      .icon { display: inline-flex; color: var(--pi-text-secondary); }
      .icon .ui-icon { width: 16px; height: 16px; }
      .heading { font-size: var(--pi-text-md); font-weight: var(--pi-weight-semibold); letter-spacing: var(--pi-tracking-tight); color: var(--pi-text-bright); }
      .count { color: var(--pi-muted); font-weight: var(--pi-weight-regular); font-size: var(--pi-text-sm); font-variant-numeric: tabular-nums; }
      .detail { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: end; color: var(--pi-muted); font-size: var(--pi-text-xs); }
      .chevron { margin-inline-start: auto; display: inline-flex; color: var(--pi-muted); }
      .content { max-height: 220px; overflow: auto; padding: var(--pi-space-3) var(--pi-space-6) var(--pi-space-5); border-top: 1px solid var(--pi-divider); color: var(--pi-text-secondary); font-size: var(--pi-text-xs); }
      :host([disabled]) .toggle { cursor: default; opacity: 0.6; }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "conversation-disclosure": ConversationDisclosure;
  }
}

/** Each card's content needs an id its toggle can name, so the two are wired for a screen reader. */
let DISCLOSURE_SEQUENCE = 0;
