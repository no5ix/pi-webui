import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { interactiveSurfaceStyles } from "../shared";
import type { EditedFileRow } from "../../workspace/editedFiles";

/**
 * The filenames a session wrote, edited, patched, or deleted.
 *
 * Only tools that write files count, and only the paths they named, so a shell
 * command that touched something is not claimed. A file edited many times is
 * one row. The list is of the transcript that is loaded, which the empty line
 * and the tooltip say: it is this session's recent work, not its whole history,
 * and it is not the working tree's state (the Git tab counts that).
 */
@customElement("edited-files-panel")
export class EditedFilesPanel extends LitElement {
  @property({ attribute: false }) rows: readonly EditedFileRow[] = [];
  /** Why the list is short, when it is short for a reason the reader should know. */
  @property({ type: String }) note = "";

  override render() {
    if (this.rows.length === 0) {
      return html`<p class="note">${this.note === "" ? "This session has not named a file to write." : this.note}</p>`;
    }
    return html`
      <ul class="rows" role="list" aria-label="Files this session wrote">
        ${this.rows.map((row) => html`
          <li class="row" title=${row.path}>
            <span class="name">${row.name}</span>
            ${row.directory === "" ? nothing : html`<span class="directory">${row.directory}</span>`}
          </li>`)}
      </ul>
    `;
  }

  static override styles = [
    interactiveSurfaceStyles,
    css`
      :host { display: block; }
      .rows { list-style: none; margin: 0; padding: 0; display: grid; gap: 1px; }
      .row { min-height: 24px; display: flex; align-items: baseline; gap: var(--pi-space-3); padding: 0 var(--pi-space-3); border-radius: var(--pi-radius-sm); }
@media (hover: hover) { .row:hover { background: var(--pi-row-hover); } }
      .name { flex: none; max-width: 70%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--pi-text); font: var(--pi-text-2xs) var(--pi-font-mono); }
      .directory { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: end; color: var(--pi-dim); font: var(--pi-text-2xs) var(--pi-font-mono); }
      .note { margin: 0; padding: var(--pi-space-2) 0; color: var(--pi-muted); font-size: var(--pi-text-xs); }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "edited-files-panel": EditedFilesPanel;
  }
}
