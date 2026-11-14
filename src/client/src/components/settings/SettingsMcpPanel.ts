import { css, html, LitElement, nothing, type TemplateResult } from "lit";
import { settingsControlStyles } from "./settingsControlStyles.js";
import { customElement, property, state } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import type { PiMcpListResponse, PiMcpServerInfo, PiMcpWriteTarget, Project } from "../../api";
import "./SettingsPanelFrame";
import type { SettingsNotice } from "./SettingsPanelFrame";
import {
  PI_MCP_SECRETS_NEVER_SHOWN_NOTE,
  isPiMcpOperationPending,
  piMcpConfigPathLine,
  piMcpConfiguredLabel,
  piMcpDefinitionLine,
  piMcpEmptyListNote,
  piMcpExposureLabel,
  piMcpProbeLabel,
  piMcpProbeLine,
  piMcpProbeTone,
  piMcpOverrideLine,
  piMcpProjectChooserNote,
  piMcpProjectScopeNote,
  piMcpReloadNote,
  piMcpRemovalLabel,
  piMcpRemovalQuestion,
  piMcpScopeLabel,
  piMcpSecretNameLines,
  piMcpSwitchTarget,
  piMcpSwitchTargetLine,
  piMcpSwitchTargetNote,
  piMcpTargetLine,
  piMcpTransportLabel,
  piMcpWriteBlockedReason,
  piMcpWriteTarget,
  type PiMcpOperationState,
} from "./piMcpSettings";
import { settingsMachineTarget, settingsMachineTargetLabel, type SettingsMachineTarget } from "./settingsMachineTarget";
import { interactiveSurfaceStyles } from "../shared";

/**
 * MCP servers as pi's `mcp.json` files define them, on the selected machine.
 *
 * The panel states two facts separately and never blends them: what the config file says, and what
 * a probe answered. It shows a server's env and header names only - the values never reach a browser
 * - and a switch that writes the file says plainly that a running session has to reload before it
 * connects.
 */
@customElement("settings-mcp-panel")
export class SettingsMcpPanel extends LitElement {
  @property({ attribute: false }) mcpResponse: PiMcpListResponse | undefined;
  @property({ attribute: false }) targetMachine: SettingsMachineTarget | undefined;
  @property({ type: Boolean }) loading = false;
  @property({ attribute: false }) operation: PiMcpOperationState | undefined;
  @property() error = "";
  @property() operationMessage = "";
  @property({ attribute: false }) onReload?: () => void | Promise<void>;
  @property({ attribute: false }) onToggleServer?: (server: PiMcpServerInfo, target: PiMcpWriteTarget, enabled: boolean) => void | Promise<void>;
  @property({ attribute: false }) onRemoveServer?: (server: PiMcpServerInfo, target: PiMcpWriteTarget) => void | Promise<void>;
  @property({ attribute: false }) onTestServer?: (server: PiMcpServerInfo) => void | Promise<void>;
  /**
   * The projects this machine has, for the project scope the panel is allowed to manage.
   *
   * A project's `mcp.json` is that machine's file, so the choices come from the machine the panel is
   * reading, and the selection travels with it. No selection is a real answer: it means the global
   * servers, and the panel says so.
   */
  @property({ attribute: false }) projects: readonly Project[] = [];
  @property({ attribute: false }) projectSelection: string | undefined;
  @property({ type: Boolean }) projectsLoading = false;
  @property() projectsError = "";
  @property({ attribute: false }) onSelectProject?: (projectId: string | undefined) => void | Promise<void>;
  /**
   * The row whose removal the reader has confirmed the first press of, keyed by the machine the
   * answer was read from as well as the scope and name.
   *
   * The two-press guard is a promise about one machine. The panel element is reused when the reader
   * switches machines, so a key without the target would hand the second press to the next machine's
   * same-named server, and one press would delete a server nobody confirmed there.
   */
  @state() private confirmingRemoval: string | undefined;

  /** The project whose scope this answer is about, which decides what a press writes. */
  private get projectSelected(): boolean {
    return this.projectSelection !== undefined;
  }

  override render(): TemplateResult {
    const target = this.panelTarget;
    const targetLabel = settingsMachineTargetLabel(target);
    return html`
      <settings-panel-frame
        heading="MCP Servers"
        .description=${mcpDescription(targetLabel)}
        actionLabel="Reload"
        actionTitle=${`Reload MCP servers from ${targetLabel}`}
        .actionDisabled=${this.loading || this.isOperating}
        .notices=${this.panelNotices(target)}
        .onAction=${this.onReload}
      >
        ${this.renderPanelContent(targetLabel)}
      </settings-panel-frame>
    `;
  }

  private panelNotices(target: SettingsMachineTarget): readonly SettingsNotice[] {
    const notices: SettingsNotice[] = [];
    if (this.error !== "") notices.push({ type: "error", content: this.error });
    if (this.operationMessage !== "") notices.push({ type: "success", content: this.operationMessage });
    const response = this.mcpResponse;
    if (response !== undefined) {
      notices.push({ type: "info", content: piMcpReloadNote(target) });
      notices.push({ type: "security", content: PI_MCP_SECRETS_NEVER_SHOWN_NOTE });
      for (const message of response.errors) {
        notices.push({ type: "error", title: "MCP config error", content: message });
      }
    }
    return notices;
  }

  private renderPanelContent(targetLabel: string): TemplateResult {
    const response = this.mcpResponse;
    if (response === undefined) {
      return html`<div class="loading-card">${this.loading ? `Loading MCP servers from ${targetLabel}…` : `MCP server list not loaded yet for ${targetLabel} · trying again…`}</div>`;
    }
    return html`
      ${this.renderProjectChooser()}
      <div class="scope-note">${piMcpProjectScopeNote(response)}</div>
      <div class="config-paths">
        <small>Global config: <code>${response.globalConfigPath}</code></small>
        ${response.projectConfigPath === undefined ? nothing : html`<small>Project config: <code>${response.projectConfigPath}</code></small>`}
      </div>
      ${this.renderServerList(response, targetLabel)}
    `;
  }

  /** The project the panel is managing, chosen from the projects this machine has. */
  private renderProjectChooser(): TemplateResult {
    const selected = this.projectSelection ?? "";
    return html`
      <div class="project-chooser">
        <label for="mcp-project">Project scope</label>
        <select
          id="mcp-project"
          .value=${selected}
          ?disabled=${this.projectsLoading || this.onSelectProject === undefined}
          @change=${(event: Event) => {
            const value = event.target instanceof HTMLSelectElement ? event.target.value : "";
            void this.onSelectProject?.(value === "" ? undefined : value);
          }}
        >
          <option value="">No project: this machine's global servers only</option>
          ${this.projects.map((project) => html`<option value=${project.id} ?selected=${project.id === this.projectSelection}>${project.name}</option>`)}
        </select>
        <small>${piMcpProjectChooserNote(this.projectsLoading, this.projects.length, this.projectSelection, this.projectsError)}</small>
      </div>
    `;
  }

  private renderServerList(response: PiMcpListResponse, targetLabel: string): TemplateResult {
    if (this.loading && response.servers.length === 0) {
      return html`<p class="section-note">Refreshing MCP servers from ${targetLabel}…</p>`;
    }
    const projectServers = response.servers.filter((server) => server.scope === "project");
    const globalServers = response.servers.filter((server) => server.scope !== "project");
    if (!this.projectSelected) {
      return html`
        <section class="section-card resource-scope" aria-label="Global MCP servers">
          <header class="scope-heading"><h3>Global MCP servers</h3><small>Available across all projects on ${targetLabel}.</small></header>
          ${globalServers.length === 0 ? html`<p class="section-note">${piMcpEmptyListNote({ ...response, servers: globalServers }, targetLabel)}</p>` : this.renderServerCards(globalServers)}
        </section>
      `;
    }
    return html`
      <section class="section-card resource-scope" aria-label="Project MCP servers">
        <header class="scope-heading"><h3>Project MCP servers</h3><small>Defined in this project's MCP configuration.</small></header>
        ${projectServers.length === 0 ? html`<p class="section-note">No project-specific MCP servers are configured for this project.</p>` : this.renderServerCards(projectServers)}
      </section>
      <section class="section-card resource-scope" aria-label="Global MCP servers">
        <header class="scope-heading"><h3>Global MCP servers</h3><small>Available across all projects; project overrides remain attached to their global definitions.</small></header>
        ${globalServers.length === 0 ? html`<p class="section-note">No global MCP servers are configured on this machine.</p>` : this.renderServerCards(globalServers)}
      </section>
    `;
  }

  private renderServerCards(servers: readonly PiMcpServerInfo[]): TemplateResult {
    return html`<div class="server-list">${servers.map((server) => this.renderServer(server))}</div>`;
  }

  private renderServer(server: PiMcpServerInfo): TemplateResult {
    const blocked = piMcpWriteBlockedReason(server);
    const switchTarget = piMcpSwitchTarget(server, this.projectSelected);
    const toggling = isPiMcpOperationPending(this.operation, "set-enabled", server, switchTarget?.kind);
    const testing = isPiMcpOperationPending(this.operation, "test", server);
    const probeState = server.probe?.state ?? "unprobed";
    return html`
      <article class=${`server-card${server.enabled ? "" : " off"}`}>
        <div class="server-main">
          <strong>${server.name}</strong>
          ${server.description === undefined ? nothing : html`<small>${server.description}</small>`}
          <small>${piMcpScopeLabel(server.scope)} · ${piMcpTransportLabel(server.transport)} · ${piMcpConfiguredLabel(server)}</small>
          <small>${piMcpTargetLine(server)}</small>
          <small>${piMcpDefinitionLine(server)}</small>
          ${piMcpOverrideLine(server, this.projectSelected) === undefined ? nothing : html`<small class="diagnostic">${piMcpOverrideLine(server, this.projectSelected)}</small>`}
          ${server.exposure === undefined ? nothing : html`<small>${piMcpExposureLabel(server.exposure)}</small>`}
          ${server.timeout === undefined ? nothing : html`<small>Probe timeout: ${String(server.timeout)} s</small>`}
          ${server.cwd === undefined ? nothing : html`<small>Working directory: <code>${server.cwd}</code></small>`}
          ${piMcpSecretNameLines(server).map((line) => html`<small>${line}</small>`)}
          ${server.usesSecrets === true ? html`<small>The config carries secret values; PI WEB reads their names, never their values.</small>` : nothing}
          ${server.authProvider === undefined ? nothing : html`<small>Credential from pi auth provider: <code>${server.authProvider}</code></small>`}
          ${server.oauthConfigured === true ? html`<small>An OAuth client is configured.</small>` : nothing}
          <small>Config file: <code>${piMcpConfigPathLine(server)}</code></small>
          ${server.overrideOnly === true ? html`<small class="diagnostic">This project entry only overrides a global server of the same name.</small>` : nothing}
          <span class=${`probe ${piMcpProbeTone(probeState)}`}>${piMcpProbeLabel(probeState)}</span>
          <small class="probe-line">${piMcpProbeLine(server)}</small>
          ${blocked === undefined ? nothing : html`<small class="diagnostic">${blocked}</small>`}
        </div>
        <div class="server-actions">
          <label class="toggle">
            <input
              type="checkbox"
              aria-label=${`${piMcpScopeLabel(server.scope)} MCP server ${server.name}: ${piMcpSwitchTargetNote(server, this.projectSelected)}`}
              .checked=${live(server.enabled)}
              ?disabled=${this.isOperating || blocked !== undefined || piMcpSwitchTarget(server, this.projectSelected) === undefined}
              title=${blocked ?? (piMcpSwitchTargetLine(piMcpSwitchTarget(server, this.projectSelected)) ?? "Turn this MCP server on or off")}
              @change=${(event: Event) => { void this.toggleServer(server, event); }}
            >
            <span>${toggling ? "Saving…" : server.enabled ? "On" : "Off"}</span>
          </label>
          ${piMcpSwitchTargetLine(piMcpSwitchTarget(server, this.projectSelected)) === undefined ? nothing : html`<small class="switch-target">${piMcpSwitchTargetLine(piMcpSwitchTarget(server, this.projectSelected))}</small>`}
          <button class="secondary" title=${`Probe ${server.name} now`} ?disabled=${this.isOperating} @click=${() => { void this.testServer(server); }}>${testing ? "Testing…" : "Test Connection"}</button>
          ${this.renderRemovals(server, blocked)}
        </div>
      </article>
    `;
  }

  /**
   * Removal, once per entry the row can be written to.
   *
   * A row can carry two removals, and they are not the same act: taking out a project's override
   * leaves the machine's server in place, and taking out the definition removes the server. Each press
   * names the file it opens, so the difference is on the screen before the second press, not after it.
   */
  private renderRemovals(server: PiMcpServerInfo, blocked: string | undefined): TemplateResult {
    const targets = this.removalTargets(server);
    if (targets.length === 0) {
      return html`<button class="danger" title=${blocked ?? "This server has no entry PI WEB may remove"} disabled>Remove</button>`;
    }
    return html`${targets.map((target) => this.renderRemoval(server, target, blocked))}`;
  }

  /**
   * The removals this row offers.
   *
   * An override that does not exist cannot be removed, so the override's button appears only when the
   * project file carries the entry; the definition's button is the server itself.
   */
  private removalTargets(server: PiMcpServerInfo): PiMcpWriteTarget[] {
    const targets: PiMcpWriteTarget[] = [];
    const definition = piMcpWriteTarget(server, "definition");
    if (server.overridePath !== undefined) {
      const override = piMcpWriteTarget(server, "override");
      if (override !== undefined) targets.push(override);
    }
    if (definition !== undefined) targets.push(definition);
    return targets;
  }

  /** Removal is asked for in two presses: the first names the file the entry will be taken out of. */
  private renderRemoval(server: PiMcpServerInfo, target: PiMcpWriteTarget, blocked: string | undefined): TemplateResult {
    const armKey = this.armKey(server, target);
    const removing = isPiMcpOperationPending(this.operation, "remove", server, target.kind);
    const label = piMcpRemovalLabel(target.kind);
    if (this.confirmingRemoval !== armKey) {
      return html`<button class="danger" title=${blocked ?? `${label}: ${piMcpRemovalQuestion(server.name, target)}`} ?disabled=${this.isOperating || blocked !== undefined} @click=${() => { this.confirmingRemoval = armKey; }}>${removing ? "Removing…" : label}</button>`;
    }
    return html`
      <span class="removal-confirm" role="group" aria-label=${`Confirm ${label.toLowerCase()} of ${server.name}`}>
        <small>${piMcpRemovalQuestion(server.name, target)}</small>
        <button class="danger" title=${`${label}: ${piMcpRemovalQuestion(server.name, target)}`} ?disabled=${this.isOperating} @click=${() => { void this.removeServer(server, target); }}>${removing ? "Removing…" : "Confirm remove"}</button>
        <button class="secondary" title="Keep this server" ?disabled=${this.isOperating} @click=${() => { this.confirmingRemoval = undefined; }}>Cancel</button>
      </span>
    `;
  }

  private async toggleServer(server: PiMcpServerInfo, event: Event): Promise<void> {
    const target = piMcpSwitchTarget(server, this.projectSelected);
    if (target === undefined) return;
    const enabled = event.target instanceof HTMLInputElement ? event.target.checked : server.enabled;
    await this.onToggleServer?.(server, target, enabled);
  }

  private async testServer(server: PiMcpServerInfo): Promise<void> {
    try {
      await this.onTestServer?.(server);
    } catch {
      // The parent owns network error presentation, so MCP errors read the same in every panel.
    }
  }

  private async removeServer(server: PiMcpServerInfo, target: PiMcpWriteTarget): Promise<void> {
    try {
      await this.onRemoveServer?.(server, target);
      this.confirmingRemoval = undefined;
    } catch {
      // The parent owns network error presentation, so MCP errors read the same in every panel.
    }
  }

  /** The armed row, keyed by the machine it was armed on: a target change drops the confirmation. */
  private armKey(server: PiMcpServerInfo, target: PiMcpWriteTarget): string {
    return `${this.panelTarget.id}\u0000${removalKey(server)}\u0000${target.kind}`;
  }

  private get panelTarget(): SettingsMachineTarget {
    return this.targetMachine ?? settingsMachineTarget(undefined);
  }

  private get isOperating(): boolean {
    return this.operation !== undefined;
  }

  static override styles = [interactiveSurfaceStyles, settingsControlStyles, css`
    :host { display: block; }
    input:disabled { opacity: var(--pi-disabled-opacity); cursor: not-allowed; }
    p, small { color: var(--pi-muted); line-height: 1.45; }
    p { margin: 0; }
    .loading-card, .server-card { border: 1px solid var(--pi-border); border-radius: var(--pi-radius-lg); background: var(--pi-surface); padding: var(--pi-space-6); }
    .project-chooser { display: grid; gap: var(--pi-space-2); margin-block-end: var(--pi-space-4); }
    .project-chooser label { font-size: var(--pi-text-sm); font-weight: var(--pi-weight-semibold); }
    .project-chooser select { box-sizing: border-box; width: 100%; min-width: 0; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-bg); color: var(--pi-text); padding-block: var(--pi-space-3); font: var(--pi-control-font-size, 16px) var(--pi-control-font-family, system-ui, sans-serif); }
    .project-chooser small { color: var(--pi-muted); font-size: var(--pi-text-xs); }
    .switch-target { color: var(--pi-muted); }
    .loading-card, .scope-note, .section-note, .config-paths { color: var(--pi-muted); }
    .scope-note, .config-paths { display: grid; gap: var(--pi-space-2); font-size: var(--pi-text-xs); }
    .server-list { display: grid; gap: var(--pi-space-5); }
    .resource-scope { display: grid; gap: var(--pi-space-5); }
    .scope-heading { display: grid; gap: var(--pi-space-2); }
    .scope-heading h3 { margin: 0; font-size: var(--pi-text-md); }
    .server-card { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--pi-space-6); align-items: center; }
    .server-card.off { opacity: .82; }
    .server-main { min-width: 0; display: grid; gap: var(--pi-space-2); }
    .server-main > strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .server-main small, .config-paths small { overflow-wrap: anywhere; }
    .diagnostic { color: var(--pi-text); }
    .probe { border: 1px solid var(--pi-border-muted); border-radius: var(--pi-radius-pill); padding: var(--pi-space-1) var(--pi-space-4); color: var(--pi-muted); font-size: var(--pi-text-2xs); line-height: 1.3; justify-self: start; }
    .probe.success { border-color: var(--pi-success-border); color: var(--pi-success); background: var(--pi-success-surface); }
    .probe.warning { border-color: var(--pi-warning-border); color: var(--pi-text); background: var(--pi-warning-surface); }
    .probe.error { border-color: var(--pi-danger); color: var(--pi-danger); }
    .probe.neutral { color: var(--pi-muted); }
    .probe-line { color: var(--pi-text); }
    .server-actions { display: grid; gap: var(--pi-space-4); justify-items: start; }
    .toggle { display: inline-flex; align-items: center; gap: var(--pi-space-4); white-space: nowrap; }
    .toggle input { box-sizing: border-box; width: var(--pi-checkbox-size); height: var(--pi-checkbox-size); accent-color: var(--pi-accent); }
    .removal-confirm { display: grid; gap: var(--pi-space-3); }
    .danger { border-color: color-mix(in srgb, var(--pi-danger) 55%, var(--pi-border)); color: var(--pi-danger); }

    @media (max-width: 760px) {
      .server-card { grid-template-columns: minmax(0, 1fr); align-items: start; }
      .server-main > strong { white-space: normal; }
    }
  `];
}

function removalKey(server: PiMcpServerInfo): string {
  return `${server.scope}\u0000${server.name}`;
}

function mcpDescription(targetLabel: string): TemplateResult {
  return html`Turn MCP servers on or off, probe one, and see which file defines it, on <strong>${targetLabel}</strong>. PI WEB reads pi's own <code>mcp.json</code>; a running session keeps the connections it opened, so a change reaches it after a reload.`;
}
