import { LitElement, css, html, nothing, unsafeCSS } from "lit";
import { customElement, property } from "lit/decorators.js";
import { interactiveSurfaceStyles } from "../shared";
import { uiIconStyle } from "../uiIcons";
import type { SubagentRow } from "../../workspace/subagentRows";

/** What the Subagents rail knows about a session's children. */
export type SubagentsRead =
  | { kind: "unknown" }
  | { kind: "loading" }
  | { kind: "available"; rows: readonly SubagentRow[] }
  | { kind: "unavailable"; reason: string };

/**
 * The child sessions one session started.
 *
 * These are the children PI WEB tracks for the session on screen — the surface
 * the reference labels "Subagents". pi's own subagent runs are the subagents
 * plugin's list, and a conversation branch is neither: the branch navigator is
 * a modal with its own name. The rail shows the tracked children, names what it
 * cannot show, and never pads the list with a row it invented.
 */
@customElement("subagents-panel")
export class SubagentsPanel extends LitElement {
  @property({ attribute: false }) read: SubagentsRead = { kind: "unknown" };
  @property({ attribute: false }) onSelectSession?: (sessionId: string) => void;
  /** The plugin panel that lists pi's subagent runs, when one is registered. */
  @property({ type: String }) pluginPanelTitle = "";

  override render() {
    const read = this.read;
    if (read.kind === "loading") return this.note("Reading this session's child sessions…");
    if (read.kind === "unknown") return this.note("This session's child sessions have not been read yet.");
    if (read.kind === "unavailable") return this.note(`This session's child sessions could not be read: ${read.reason}`);
    if (read.rows.length === 0) {
      return html`
        <p class="note">This session has not started a child session.</p>
        ${this.pluginPanelTitle === "" ? nothing : html`<p class="hint">Subagent runs are listed by the ${this.pluginPanelTitle} panel.</p>`}
      `;
    }
    return html`
      <ul class="rows" role="list">
        ${read.rows.map((row) => html`
          <li><button class="row" type="button" ?disabled=${!row.openable}
            @click=${() => this.onSelectSession?.(row.id)}>
            <span class="dot" data-state=${row.state} aria-hidden="true"></span>
            <span class="name">${row.label ?? `Child session in ${row.folder}`}</span>
            ${row.label === undefined ? nothing : html`<span class="folder">${row.folder}</span>`}
            <span class="state">${STATE_WORDS[row.state]}</span>
          </button></li>`)}
      </ul>
      ${this.pluginPanelTitle === "" ? nothing : html`<p class="hint">Subagent runs are listed by the ${this.pluginPanelTitle} panel.</p>`}
    `;
  }

  private note(text: string) {
    return html`<p class="note">${text}</p>`;
  }

  static override styles = [
    interactiveSurfaceStyles,
    css`${unsafeCSS(uiIconStyle)}`,
    css`
      :host { display: block; }
      .rows { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
      .row { width: 100%; box-sizing: border-box; min-height: var(--pi-control-height); display: flex; align-items: center; gap: var(--pi-space-3); padding: 0 var(--pi-space-3); border: 0; border-radius: var(--pi-radius-sm); background: transparent; color: var(--pi-text); text-align: start; font: var(--pi-text-xs) var(--pi-font-ui); cursor: pointer; }
@media (hover: hover) { .row:hover:not(:disabled) { background: var(--pi-row-hover); } }
      .row:disabled { opacity: var(--pi-disabled-opacity); cursor: default; }
      .dot { flex: none; width: var(--pi-dot-sm); height: var(--pi-dot-sm); border-radius: 50%; background: var(--pi-dim); }
      .dot[data-state="working"] { background: var(--pi-success); }
      .dot[data-state="error"] { background: var(--pi-danger); }
      .name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .folder { flex: none; max-width: 38%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--pi-muted); font: var(--pi-text-2xs) var(--pi-font-mono); }
      .state { flex: none; color: var(--pi-muted); font-size: var(--pi-text-2xs); }
      .note { margin: 0; padding: var(--pi-space-2) 0; color: var(--pi-muted); }
      .hint { margin: var(--pi-space-3) 0 0; color: var(--pi-dim); font-size: var(--pi-text-2xs); }
    `,
  ];
}

const STATE_WORDS: Record<SubagentRow["state"], string> = {
  working: "working",
  idle: "idle",
  error: "stopped on an error",
  unknown: "state unknown",
};

declare global {
  interface HTMLElementTagNameMap {
    "subagents-panel": SubagentsPanel;
  }
}
