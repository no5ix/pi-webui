import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { SessionInfo } from "../api";
import { sessionLabel } from "../sessionLabels";
import { isSessionActive } from "../../../shared/activity";
import type { SessionStatus, SessionActivity } from "../api";
import { sessionActivityCategory } from "../../../shared/sessionActivityState";
import { interactiveSurfaceStyles, pageScrollerStyles } from "./shared";

/** Small machine-wide running-session list; session identity and activity remain host-owned. */
@customElement("running-sessions-panel")
export class RunningSessionsPanel extends LitElement {
  @property({ attribute: false }) sessions: readonly SessionInfo[] = [];
  @property({ attribute: false }) selectedSessionId: string | undefined;
  @property({ attribute: false }) sessionStatuses: Readonly<Record<string, SessionStatus>> = {};
  @property({ attribute: false }) sessionActivities: Readonly<Record<string, SessionActivity>> = {};
  @property({ attribute: false }) onSelectSession?: (session: SessionInfo) => void;

  private category(session: SessionInfo): string {
    const status = this.sessionStatuses[session.id];
    const activity = this.sessionActivities[session.id];
    return sessionActivityCategory(status, activity) ?? "unknown";
  }

  override render() {
    const rows = this.sessions.filter((session) => session.archived !== true && isSessionActive(this.sessionStatuses[session.id], this.sessionActivities[session.id]));
    return html`
      <section class="running">
        <header class="section-head"><span>Running Sessions</span><span class="count">${rows.length}</span></header>
        <div class="rows page-scroller">
          ${rows.length === 0
            ? html`<p class="empty">No running sessions</p>`
            : rows.map((session) => html`
              <button class=${this.selectedSessionId === session.id ? "session selected" : "session"} type="button"
                aria-current=${this.selectedSessionId === session.id ? "true" : "false"}
                @click=${() => this.onSelectSession?.(session)}>
                <span class="dot" data-state=${this.category(session)}></span>
                <span class="name">${sessionLabel(session)}</span>
              </button>`)}
        </div>
      </section>
    `;
  }

  static override styles = [interactiveSurfaceStyles, pageScrollerStyles, css`
    :host { display:flex; flex-direction:column; min-height:0; border-bottom:1px solid var(--pi-border-muted); }
    .running { display:flex; flex-direction:column; min-height:0; max-height:38%; }
    .section-head { flex:none; display:flex; align-items:center; justify-content:space-between; padding:12px 14px 7px; color:var(--pi-text-secondary); font-size:var(--pi-text-xs); font-weight:var(--pi-weight-semibold); }
    .count { color:var(--pi-muted); font-weight:var(--pi-weight-regular); }
    .rows { min-height:0; overflow:auto; padding:0 8px 10px; }
    .session { width:100%; min-height:28px; display:flex; align-items:center; gap:8px; text-align:left; border:0; border-radius:var(--pi-radius-md); padding:4px 8px; color:var(--pi-text); background:transparent; font:var(--pi-text-xs) var(--pi-font-ui); }
    .session:hover { background:var(--pi-surface-hover); }
    .session.selected { background:var(--pi-selection-bg); }
    .name { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .dot { flex:none; width:7px; height:7px; border-radius:50%; background:var(--pi-muted); }
    .dot[data-state="working"] { background:var(--pi-success); }
    .dot[data-state="asking"] { background:var(--pi-warning); }
    .dot[data-state="error"] { background:var(--pi-danger); }
    .empty { margin:0; padding:6px 10px; color:var(--pi-muted); font-size:var(--pi-text-2xs); }
  `];
}

@customElement("workspace-tab-bar")
export class WorkspaceTabBar extends LitElement {
  @property({ type: String }) active = "core:workspace.files";
  @property({ attribute: false }) editedCount = 0;
  @property({ attribute: false }) onSelect?: (id: string) => void;
  @property({ attribute: false }) tabs: readonly { id: string; label: string; disabled?: boolean; detail?: string }[] = [
    { id: "git", label: "Git" },
    { id: "files", label: "Files" },
    { id: "terminal", label: "Terminal" },
    { id: "goals", label: "Goals" },
  ];

  override render() {
    return html`
      <nav class="tabs" role="tablist" aria-label="Workspace tools">
        ${this.tabs.map((tab) => html`
          <button type="button" role="tab" aria-selected=${this.active === tab.id ? "true" : "false"}
            class=${this.active === tab.id ? "tab selected" : "tab"} ?disabled=${tab.disabled === true}
            @click=${() => this.onSelect?.(tab.id)}>
            <span>${tab.label}</span>
            ${tab.id === "git" && this.editedCount > 0 ? html`<span class="badge">${this.editedCount}</span>` : nothing}
          </button>`)}
      </nav>
    `;
  }

  static override styles = [interactiveSurfaceStyles, css`
    :host { display:block; flex:none; }
    .tabs { min-height:40px; display:flex; align-items:center; gap:3px; padding:5px 7px; border-bottom:1px solid var(--pi-border-muted); background:var(--pi-surface); }
    .tab { min-width:0; min-height:28px; flex:1; display:flex; justify-content:center; align-items:center; gap:5px; padding:3px 5px; border:1px solid transparent; border-radius:var(--pi-radius-sm); background:transparent; color:var(--pi-text-secondary); font:var(--pi-text-xs) var(--pi-font-ui); white-space:nowrap; }
    .tab:hover:not(:disabled) { background:var(--pi-surface-hover); color:var(--pi-text); }
    .tab.selected { background:var(--pi-selection-bg); color:var(--pi-text); border-color:var(--pi-border-muted); font-weight:var(--pi-weight-semibold); }
    .tab:disabled { opacity:.45; cursor:not-allowed; }
    .badge { display:inline-flex; align-items:center; justify-content:center; min-width:16px; height:16px; padding:0 4px; border-radius:999px; background:var(--pi-danger); color:white; font-size:10px; line-height:1; }
  `];
}

@customElement("conversation-disclosure")
export class ConversationDisclosure extends LitElement {
  @property({ type:String }) heading = "";
  @property({ type:String }) description = "";
  @property({ type:Boolean, reflect:true }) expanded = false;
  @property({ type:Boolean }) disabled = false;
  @property({ type:String }) panelId = "";

  override render() {
    return html`
      <section class="disclosure" ?data-expanded=${this.expanded}>
        <button class="toggle" type="button" aria-expanded=${this.expanded ? "true" : "false"}
          aria-controls=${this.panelId || nothing} ?disabled=${this.disabled}
          @click=${() => { this.expanded = !this.expanded; }}>
          <span class="chevron" aria-hidden="true">${this.expanded ? "⌄" : "›"}</span>
          <span class="heading">${this.heading}</span>
          ${this.description ? html`<span class="description">${this.description}</span>` : nothing}
        </button>
        ${this.expanded ? html`<div class="content" id=${this.panelId || nothing}><slot></slot></div>` : nothing}
      </section>
    `;
  }

  static override styles = [interactiveSurfaceStyles, css`
    :host { display:block; flex:none; }
    .disclosure { border-top:1px solid var(--pi-border-muted); }
    .toggle { width:100%; min-height:31px; display:flex; align-items:center; gap:7px; padding:4px 10px; border:0; border-radius:0; background:transparent; color:var(--pi-text); text-align:left; font:var(--pi-text-xs) var(--pi-font-ui); }
    .toggle:hover { background:var(--pi-surface-hover); }
    .chevron { width:11px; flex:none; color:var(--pi-muted); font-size:16px; line-height:1; text-align:center; }
    .heading { font-weight:var(--pi-weight-medium); }
    .description { margin-left:auto; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--pi-muted); font-size:var(--pi-text-2xs); }
    .content { max-height:190px; overflow:auto; padding:4px 12px 10px 28px; color:var(--pi-text-secondary); font-size:var(--pi-text-xs); }
  `];
}
