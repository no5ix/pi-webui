import { LitElement, css, html, nothing, unsafeCSS } from "lit";
import { customElement, property } from "lit/decorators.js";
import { interactiveSurfaceStyles, pageScrollerStyles } from "../shared";
import { workspaceBandStyles } from "../appShell/workspaceBandStyles";
import type { ProjectSessionModel } from "../../workspace/projectSessionModel";
import { renderCrossIcon, renderPlusIcon, renderProjectIcon, renderSearchIcon, uiIconStyle } from "../uiIcons";
import { disclosureIconStyle, renderDisclosureIcon } from "../disclosureIcon";

/**
 * The project tree: every project, and the sessions that run in it.
 *
 * This is the dense sidebar surface. The full management list (rename, archive,
 * bulk selection, pins, machines) stays on the Navigate page, reachable from Go
 * to; a 280px column is not wide enough for both, and the reference is a tree,
 * not a tile board.
 *
 * A project row does two honest things at once: it selects the project (the
 * app's working scope) and folds or unfolds its sessions, which is what a row
 * with a chevron means everywhere else in the app. A folded project states how
 * many sessions it holds; the fold never hides the session that is open, so
 * selecting a project cannot make the reader's own session vanish.
 *
 * The counts are of what the app has loaded, and the tree says so when a
 * listing is still arriving or refused: a project list that is silently short
 * is the "absence read as negation" failure.
 */
@customElement("project-sessions-panel")
export class ProjectSessionsPanel extends LitElement {
  @property({ attribute: false }) model: ProjectSessionModel = { groups: [], sessionTotal: 0, filtering: false };
  @property({ attribute: false }) query = "";
  @property({ attribute: false }) projectCount = 0;
  @property({ attribute: false }) selectedProjectId: string | undefined;
  @property({ attribute: false }) selectedSessionId: string | undefined;
  /** A listing that has not answered: the tree draws what it has and says it is loading. */
  @property({ type: Boolean }) loading = false;
  /** A listing that refused: the tree says that, and does not present its rows as the truth. */
  @property({ type: String }) problem = "";
  @property({ attribute: false }) onQueryChange?: (query: string) => void;
  @property({ attribute: false }) onToggleProject?: (projectId: string) => void;
  @property({ attribute: false }) onSelectSession?: (sessionId: string) => void;
  @property({ attribute: false }) onNewSession?: (projectId: string | undefined) => void;
  @property({ attribute: false }) onOpenAllProjects?: () => void;

  override render() {
    const model = this.model;
    return html`
      <section class="panel">
        <header class="head">
          <span class="title">Projects</span>
          <span class="count">(${String(this.projectCount)})</span>
          <button class="new" type="button" aria-label="New session" title="New session"
            @click=${() => this.onNewSession?.(this.selectedProjectId)}>${renderPlusIcon()}</button>
        </header>
        <div class="search">
          <span class="search-icon" aria-hidden="true">${renderSearchIcon()}</span>
          <input class="search-input page-scroller" type="search" .value=${this.query}
            aria-label="Search sessions" placeholder="Search sessions"
            @input=${(event: Event) => {
              const field = event.target;
              if (field instanceof HTMLInputElement) this.onQueryChange?.(field.value);
            }} />
          ${this.query === "" ? nothing : html`<button class="search-clear" type="button" aria-label="Clear search" title="Clear search"
            @click=${() => { this.onQueryChange?.(""); }}>${renderCrossIcon()}</button>`}
        </div>
        ${this.onOpenAllProjects === undefined ? nothing : html`
          <button class="all-projects" type="button" data-selected=${this.selectedProjectId === undefined ? "true" : "false"}
            @click=${() => this.onOpenAllProjects?.()}>All projects</button>`}
        ${this.loading ? html`<p class="note">Loading projects…</p>` : nothing}
        ${this.problem === "" ? nothing : html`<p class="note problem" role="status">${this.problem}</p>`}
        <div class="tree page-scroller" role="tree">
          ${model.groups.length === 0
            ? html`<p class="empty">${model.filtering ? "No sessions match this search." : "No projects are listed on this machine."}</p>`
            : model.groups.map((group) => html`
              <div class="group" role="treeitem" aria-expanded=${group.expanded ? "true" : "false"}
                data-active=${group.projectId === this.selectedProjectId ? "true" : "false"}>
                <button class="project" type="button" title=${group.path === "" ? group.name : `${group.name} · ${group.path}`}
                  @click=${() => this.onToggleProject?.(group.projectId)}>
                  <span class="chevron" aria-hidden="true">${renderDisclosureIcon(!group.expanded)}</span>
                  <span class="folder" aria-hidden="true">${renderProjectIcon()}</span>
                  <span class="project-name" data-missing=${group.folderMissing ? "true" : "false"}>${group.name}</span>
                  ${group.total === 0 ? nothing : html`<span class="project-count">${String(group.total)}</span>`}
                </button>
                <div class="sessions-clip" ?data-expanded=${group.expanded}>
                  <div class="sessions">
                    ${group.rows.map((row) => html`
                      <button class="session" type="button" role="treeitem" data-selected=${row.selected ? "true" : "false"} aria-selected=${row.selected ? "true" : "false"}
                        title=${row.label} @click=${() => this.onSelectSession?.(row.id)}>
                        <span class="state-dot" data-state=${row.state} aria-hidden="true"></span>
                        <span class="session-name" data-unopenable=${row.unopenable ? "true" : "false"}>${row.label}</span>
                        ${row.age === undefined ? nothing : html`<span class="age">${row.age}</span>`}
                      </button>`)}
                    ${group.hiddenCount > 0 ? html`
                      <button class="show-more" type="button"
                        @click=${() => this.onToggleProject?.(group.projectId)}>Show ${String(group.hiddenCount)} more</button>`
                      : group.rows.length === 0 ? html`<p class="empty group-empty">No sessions in this project.</p>` : nothing}
                  </div>
                </div>
              </div>`)}
        </div>
      </section>
    `;
  }

  static override styles = [
    interactiveSurfaceStyles,
    workspaceBandStyles,
    pageScrollerStyles,
    css`${unsafeCSS(uiIconStyle)}`,
    css`${unsafeCSS(disclosureIconStyle)}`,
    css`
      :host { display: flex; flex: 1 1 auto; min-height: 0; flex-direction: column; }
      .panel { display: flex; flex: 1 1 auto; min-height: 0; flex-direction: column; }
      .head { box-sizing: border-box; flex: none; display: flex; align-items: center; gap: var(--pi-space-3); min-height: var(--pi-control-height-comfort); padding: var(--pi-space-3) var(--pi-row-edge) var(--pi-space-2); color: var(--pi-text-bright); font: var(--pi-text-md) var(--pi-font-ui); font-weight: var(--pi-weight-semibold); }
      .title { letter-spacing: var(--pi-tracking-tight); }
      .count { color: var(--pi-muted); font-size: var(--pi-text-sm); font-weight: var(--pi-weight-regular); font-variant-numeric: tabular-nums; }
      .new { margin-inline-start: auto; width: var(--pi-control-height); height: var(--pi-control-height); display: grid; place-items: center; padding: 0; border: 0; border-radius: var(--pi-radius-sm); background: transparent; color: var(--pi-muted); cursor: pointer; }
@media (hover: hover) { .new:hover { background: var(--pi-surface-hover); color: var(--pi-text); } }
      .new:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-focus-ring); outline-offset: var(--pi-focus-ring-offset-inset); }
      .search { flex: none; position: relative; display: flex; align-items: center; margin: 0 var(--pi-row-edge) var(--pi-space-4); }
      .search-icon { position: absolute; inset-inline-start: var(--pi-space-2); display: inline-flex; color: var(--pi-dim); pointer-events: none; }
      .search-icon .ui-icon { width: 13px; height: 13px; }
      .search-input { box-sizing:border-box; width:100%; min-width:0; height:var(--pi-control-height-comfort); padding:0 var(--pi-space-9); border:0; border-radius:var(--pi-radius-md); background:color-mix(in srgb, var(--pi-text) 5%, var(--pi-surface-panel)); color:var(--pi-text); font:var(--pi-text-base) var(--pi-font-ui); transition:background-color 140ms ease, box-shadow 140ms ease; }
      .search-input::placeholder { color:var(--pi-muted); }
      .search-input:focus-visible { background:var(--pi-surface); outline:var(--pi-focus-ring-width) solid var(--pi-focus-ring); outline-offset:var(--pi-focus-ring-offset-inset); }
      .search-input::-webkit-search-cancel-button { display: none; }
      .search-clear { position: absolute; inset-inline-end: var(--pi-space-2); width: 22px; height: 22px; display: grid; place-items: center; padding: 0; border: 0; border-radius: var(--pi-radius-sm); background: transparent; color: var(--pi-muted); cursor: pointer; }
      .search-clear .ui-icon { width: 12px; height: 12px; }
@media (hover: hover) { .search-clear:hover { background: var(--pi-surface-hover); color: var(--pi-text); } }
      .all-projects { flex: none; align-self: start; margin: 0 var(--pi-row-edge) var(--pi-space-3); padding: var(--pi-space-1) var(--pi-space-3); border: 1px solid transparent; border-radius: var(--pi-radius-md); background: transparent; color: var(--pi-text-secondary); font: var(--pi-text-base) var(--pi-font-ui); cursor: pointer; }
@media (hover: hover) { .all-projects:hover { background: var(--pi-row-hover); color: var(--pi-text); } }
      .all-projects[data-selected="true"] { background: var(--pi-selection-bg); color: var(--pi-text-bright); border-color: transparent; }
      .note { flex: none; margin: 0 var(--pi-row-edge) var(--pi-space-3); color: var(--pi-muted); font-size: var(--pi-text-2xs); }
      .note.problem { color: var(--pi-warning); }
      .tree { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 0 calc(var(--pi-row-edge) - var(--pi-space-3)) var(--pi-space-5); }
      .group { display: flex; flex-direction: column; }
      .project { width: 100%; box-sizing: border-box; min-height: var(--pi-control-height); display: flex; align-items: center; gap: var(--pi-space-3); padding: 0 var(--pi-space-3); border: 0; border-radius: var(--pi-radius-md); background: transparent; color: var(--pi-text-secondary); text-align: start; font: var(--pi-text-base) var(--pi-font-ui); cursor: pointer; }
@media (hover: hover) { .project:hover { background: var(--pi-row-hover); color: var(--pi-text); } }
      .project:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-focus-ring); outline-offset: var(--pi-focus-ring-offset-inset); }
      /* The project that holds the open session is marked by its own words and
         its folder, not by a fill: the fill is what hover and the chosen row use,
         and a container state that wears the same fill as a row state cannot be
         told apart from them. */
      .group[data-active="true"] > .project { color: var(--pi-text-bright); background: transparent; }
      .group[data-active="true"] .folder { color: var(--pi-text-secondary); }
      .chevron { flex: none; display: inline-flex; color: var(--pi-dim); }
      .chevron .disclosure-icon { width: 12px; height: 12px; }
      .folder { flex: none; display: inline-flex; color: var(--pi-dim); }
      .folder .ui-icon { width: 16px; height: 16px; }
      .project-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: var(--pi-weight-medium); }
      .project-name[data-missing="true"] { color: var(--pi-muted); text-decoration: line-through; }
      .project-count { flex: none; color: var(--pi-dim); font-variant-numeric: tabular-nums; font-size: var(--pi-text-xs); }
      .sessions-clip { display:grid; grid-template-rows:0fr; opacity:0; overflow:hidden; transition:grid-template-rows 180ms ease, opacity 150ms ease; }
      .sessions-clip[data-expanded="true"] { grid-template-rows:1fr; opacity:1; }
      .sessions { display:flex; flex-direction:column; min-height:0; padding-inline-start:var(--pi-space-6); }
      @media (prefers-reduced-motion: reduce) { .sessions-clip { transition:none; } }
      .session { width: 100%; box-sizing: border-box; min-height: var(--pi-control-height); display: flex; align-items: center; gap: var(--pi-space-3); padding: 0 var(--pi-space-3); border: 1px solid transparent; border-radius: var(--pi-radius-md); background: transparent; color: var(--pi-text-secondary); text-align: start; font: var(--pi-text-base) var(--pi-font-ui); cursor: pointer; }
@media (hover: hover) { .session:hover { background: var(--pi-row-hover); color: var(--pi-text); } }
      .session:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-focus-ring); outline-offset: var(--pi-focus-ring-offset-inset); }
      .session[data-selected="true"] { background: var(--pi-selection-bg); color: var(--pi-text-bright); }
      .state-dot { flex: none; width: var(--pi-dot-sm); height: var(--pi-dot-sm); border-radius: 50%; background: transparent; }
      .state-dot[data-state="working"] { background: var(--pi-success); }
      .state-dot[data-state="opening"] { background: var(--pi-accent); }
      .state-dot[data-state="background"] { background: var(--pi-accent); opacity: 0.7; }
      .state-dot[data-state="asking"] { background: var(--pi-warning); }
      .state-dot[data-state="error"] { background: var(--pi-danger); }
      .session-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .session-name[data-unopenable="true"] { color: var(--pi-muted); }
      .age { flex: none; color: var(--pi-dim); font-variant-numeric: tabular-nums; font-size: var(--pi-text-xs); }
      .show-more { box-sizing: border-box; align-self: start; margin: var(--pi-space-1) 0 0 var(--pi-space-3); padding: var(--pi-space-1) var(--pi-space-3); border: 0; border-radius: var(--pi-radius-sm); background: transparent; color: var(--pi-text-secondary); font: var(--pi-text-base) var(--pi-font-ui); cursor: pointer; }
@media (hover: hover) { .show-more:hover { background: var(--pi-row-hover); color: var(--pi-text); } }
      .empty { margin: 0; padding: var(--pi-space-3) var(--pi-space-3); color: var(--pi-muted); font-size: var(--pi-text-xs); }
      .group-empty { padding: var(--pi-space-1) var(--pi-space-3); }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "project-sessions-panel": ProjectSessionsPanel;
  }
}
