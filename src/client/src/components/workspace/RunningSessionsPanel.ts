import { LitElement, css, html, nothing, unsafeCSS } from "lit";
import { customElement, property } from "lit/decorators.js";
import { interactiveSurfaceStyles, pageScrollerStyles } from "../shared";
import type { RunningSessionRow } from "../../workspace/runningSessionRows";
import { uiIconStyle } from "../uiIcons";
import { disclosureIconStyle, renderDisclosureIcon } from "../disclosureIcon";

/**
 * The sessions that are running right now, across every project.
 *
 * Only sessions the app can name as running are listed, with the state dot the
 * rest of the window uses and the elapsed span of the turn the daemon reported.
 * A session whose status has not arrived is not shown as running: an unknown is
 * not a yes, and a list that says "2 running" when one is idle is the kind of
 * claim that costs the reader's trust in every other number on the screen.
 *
 * The section is a fixed block above the project tree with its own scroll, and
 * its header is the control that folds it away. A long project list can never
 * push it off, and folding it never folds the tree.
 */
@customElement("running-sessions-panel")
export class RunningSessionsPanel extends LitElement {
  @property({ attribute: false }) rows: readonly RunningSessionRow[] = [];
  @property({ attribute: false }) selectedSessionId: string | undefined;
  @property({ attribute: false }) onSelectSession?: (sessionId: string) => void;

  private collapsed = false;

  override render() {
    const count = this.rows.length;
    return html`
      <section class="section" ?data-collapsed=${this.collapsed}>
        <button class="head" type="button" aria-expanded=${this.collapsed ? "false" : "true"}
          aria-label=${this.collapsed ? "Show running sessions" : "Hide running sessions"}
          @click=${() => { this.collapsed = !this.collapsed; }}>
          <span class="title">Running Sessions</span>
          <span class="count">(${String(count)})</span>
          <span class="chevron" data-collapsed=${this.collapsed ? "true" : "false"} aria-hidden="true">${renderDisclosureIcon(this.collapsed)}</span>
        </button>
        ${this.collapsed ? nothing : html`
          <div class="rows page-scroller" role="list">
            ${count === 0
              ? html`<p class="empty">No sessions are running.</p>`
              : this.rows.map((row) => html`
                <button type="button" role="listitem" class="row" data-selected=${row.id === this.selectedSessionId ? "true" : "false"}
                  @click=${() => this.onSelectSession?.(row.id)}>
                  <span class="dot" data-state=${row.state} aria-hidden="true"></span>
                  <span class="name" title=${row.label}>${row.label}</span>
                  ${row.elapsed === undefined ? nothing : html`<span class="elapsed">${row.elapsed}</span>`}
                </button>`)}
          </div>`}
      </section>
    `;
  }

  static override styles = [
    interactiveSurfaceStyles,
    pageScrollerStyles,
    css`${unsafeCSS(uiIconStyle)}`,
    css`${unsafeCSS(disclosureIconStyle)}`,
    css`
      :host { display: flex; flex: none; flex-direction: column; min-height: 0; border-bottom: 1px solid var(--pi-border-muted); }
      .section { display: flex; flex: none; flex-direction: column; min-height: 0; max-height: min(38%, 260px); }
      .section[data-collapsed="true"] { max-height: none; }
      .head { box-sizing: border-box; flex: none; display: flex; align-items: center; gap: var(--pi-space-3); min-height: var(--pi-control-height-comfort); padding: 0 var(--pi-space-6); border: 0; border-radius: 0; background: transparent; color: var(--pi-text-secondary); text-align: start; font: var(--pi-text-xs) var(--pi-font-ui); cursor: pointer; }
@media (hover: hover) { .head:hover { background: var(--pi-surface-hover); color: var(--pi-text); } }
      .title { font-weight: var(--pi-weight-semibold); letter-spacing: 0.02em; }
      .count { color: var(--pi-muted); font-weight: var(--pi-weight-regular); font-variant-numeric: tabular-nums; }
      .chevron { margin-inline-start: auto; display: inline-flex; color: var(--pi-muted); }
      .chevron .disclosure-icon { width: 14px; height: 14px; }
      .rows { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 0 var(--pi-space-3) var(--pi-space-4); }
      .row { width: 100%; box-sizing: border-box; min-height: var(--pi-control-height); display: flex; align-items: center; gap: var(--pi-space-3); padding: 0 var(--pi-space-4); border: 0; border-radius: var(--pi-radius-md); background: transparent; color: var(--pi-text); text-align: start; font: var(--pi-text-xs) var(--pi-font-ui); cursor: pointer; }
@media (hover: hover) { .row:hover { background: var(--pi-row-hover); } }
      .row[data-selected="true"] { background: var(--pi-selection-bg); }
      .name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .elapsed { flex: none; color: var(--pi-muted); font-variant-numeric: tabular-nums; font-size: var(--pi-text-2xs); }
      .dot { flex: none; width: width: var(--pi-dot-md); height: height: var(--pi-dot-md); border-radius: 50%; background: var(--pi-dim); }
      .dot[data-state="working"] { background: var(--pi-success); }
      .dot[data-state="opening"] { background: var(--pi-accent); }
      .dot[data-state="background"] { background: var(--pi-accent); opacity: 0.7; }
      .dot[data-state="asking"] { background: var(--pi-warning); }
      .dot[data-state="error"] { background: var(--pi-danger); }
      .empty { margin: 0; padding: var(--pi-space-3) var(--pi-space-4); color: var(--pi-muted); font-size: var(--pi-text-2xs); }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "running-sessions-panel": RunningSessionsPanel;
  }
}
