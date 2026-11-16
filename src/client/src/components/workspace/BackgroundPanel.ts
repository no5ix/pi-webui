import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { interactiveSurfaceStyles } from "../shared";
import type { BackgroundRow } from "../../workspace/backgroundRows";

/**
 * The work a session has behind the conversation: queued prompts, runs that
 * outlive the turn, dialogs it is blocked on.
 *
 * The rows come from what the session's status states, so the count in the
 * heading and the rows underneath agree. The app has no list of individual
 * background runs to name; it counts them, and says so, rather than filling the
 * card with a sentence about "activity".
 */
@customElement("background-panel")
export class BackgroundPanel extends LitElement {
  /** Absent means the session has not answered: the card says that, not "nothing". */
  @property({ attribute: false }) rows: readonly BackgroundRow[] | undefined = undefined;
  /** The panel that lists the individual runs, when a plugin keeps such a list. */
  @property({ type: String }) pluginPanelTitle = "";

  override render() {
    if (this.rows === undefined) return html`<p class="note">This session has not reported its background work.</p>`;
    if (this.rows.length === 0) {
      return html`
        <p class="note">Nothing is running behind this conversation.</p>
        ${this.hint()}
      `;
    }
    return html`
      <ul class="rows" role="list">
        ${this.rows.map((row) => html`
          <li class="row">
            <span class="dot" data-state=${row.state} aria-hidden="true"></span>
            <span class="label">${row.label}</span>
            ${row.detail === "" ? nothing : html`<span class="detail" title=${row.detail}>${row.detail}</span>`}
          </li>`)}
      </ul>
      ${this.hint()}
    `;
  }

  /**
   * The card counts runs; a plugin that owns the individual runs lists them, and
   * the card names that panel rather than implying its rows are the whole list.
   */
  private hint() {
    return this.pluginPanelTitle === "" ? nothing : html`<p class="hint">Individual runs are listed by the ${this.pluginPanelTitle} panel.</p>`;
  }

  static override styles = [
    interactiveSurfaceStyles,
    css`
      :host { display: block; }
      .rows { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
      .row { min-height: 26px; display: flex; align-items: center; gap: var(--pi-space-3); padding: 0 var(--pi-space-3); border-radius: var(--pi-radius-sm); font: var(--pi-text-xs) var(--pi-font-ui); }
@media (hover: hover) { .row:hover { background: var(--pi-row-hover); } }
      .dot { flex: none; width: var(--pi-dot-sm); height: var(--pi-dot-sm); border-radius: 50%; background: var(--pi-dim); }
      .dot[data-state="running"] { background: var(--pi-success); }
      .dot[data-state="queued"] { background: var(--pi-accent); opacity: 0.75; }
      .dot[data-state="waiting"] { background: var(--pi-warning); }
      .dot[data-state="failed"] { background: var(--pi-danger); }
      .label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .detail { flex: none; max-width: 45%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--pi-muted); }
      .note { margin: 0; padding: var(--pi-space-2) 0; color: var(--pi-muted); }
      .hint { margin: var(--pi-space-3) 0 0; color: var(--pi-dim); font-size: var(--pi-text-2xs); }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "background-panel": BackgroundPanel;
  }
}
