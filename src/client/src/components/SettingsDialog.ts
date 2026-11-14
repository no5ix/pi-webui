import type { ListTilesPerRow } from "../../../shared/apiTypes";
import { barKeyStyles } from "./appShell/panelHeaderStyles";
import { withListTiles, type ListLayout } from "../listTiles";
import { css, html, LitElement, unsafeCSS, type PropertyValues, type TemplateResult } from "lit";
import { renderBackIcon, renderCrossIcon, uiIconStyle } from "./uiIcons.js";
import { disclosureIconStyle, renderDisclosureIcon } from "./disclosureIcon.js";
import { customElement, property, state } from "lit/decorators.js";
import type { AppAction } from "../actions";
import { configApi, notificationsApi, piMcpApi, piPackagesApi, piSkillsApi, pluginsApi, projectsApi, type Machine, type MachineRuntime, type PiMcpListResponse, type PiMcpMutationResponse, type PiMcpServerInfo, type PiMcpWriteTarget, type Project, type PiPackageMutationResponse, type PiPackageScope, type PiPackagesResponse, type PiSkillInfo, type PiSkillsResponse, type PiWebConfigResponse, type PiWebConfigValues, type PiWebPluginsResponse } from "../api";
import type { NtfyConfig, NtfyStatus } from "../../../shared/ntfy";
import type { MachineReachabilityView } from "../machineReachability";
import type { PiWebFleetReport, PiWebFleetRunResponse } from "../../../shared/apiTypes";
import type { FleetStatusRead } from "../fleetMachineOffer";
import type { QualifiedContributionId, QualifiedThemeContribution } from "../plugins/types";
import { isPluginSettingsSection, type SettingsReveal, type SettingsSection } from "../settingsRoute";
import { searchSettings, type SettingsEntry } from "../settingsSearch";
import type { PluginRuntimeContext, QualifiedSettingsSectionContribution } from "../plugins/types";
import { askPluginOr, pluginDrawFailureText } from "../plugins/pluginContainment";
import "./ModalSurface";
import "./settings/SettingsAppearancePanel";
import "./settings/SettingsNotificationsPanel";
import type { NotificationAvailability } from "../notifications/taskNotifications";
import "./settings/SettingsGeneralPanel";
import "./settings/SettingsMachinesPanel";
import "./settings/SettingsPackagesPanel";
import "./settings/SettingsPluginsPanel";
import "./settings/SettingsSkillsPanel";
import "./settings/SettingsMcpPanel";
import "./settings/SettingsShortcutsPanel";
import { friendlyPiPackageErrorMessage, piPackageMutationFollowUpMessage, shouldRefreshGatewayPluginsAfterPiPackageMutation, type PiPackageOperationState } from "./settings/piPackageSettings";
import { piSkillMutationMessage, piSkillToggleRequest, type PiSkillOperationState } from "./settings/piSkillSettings";
import { piMcpMutationMessage, piMcpRemoveRequest, piMcpSetEnabledRequest, piMcpTestRequest, type PiMcpOperationState } from "./settings/piMcpSettings";
import { loadGatewaySettingsData, loadPiMcpData, loadPiPackagesData, loadPiSkillsData } from "./settings/settingsDataLoading";
import { mergeSelectedMachineAccessConfig } from "./settings/settingsMachineAccessConfig";
import { friendlySelectedMachineSettingsErrorMessage, isSelectedMachineSettingsUnsupported, settingsReadFailureWords, pluginLifecycleSupport, selectedMachineSettingsSupportKey, settingsMachineTarget, settingsMachineTargetLabel, type PluginLifecycleSupport, type SettingsMachineTarget } from "./settings/settingsMachineTarget";
import { mergeSelectedMachinePluginConfig, pluginEnabledConfigPatch } from "./settings/settingsPluginConfig";
import { describeError } from "../notice";
import { PHONE_LAYOUT_MEDIA_QUERY } from "../breakpoints";
import { interactiveSurfaceStyles, pageScrollerStyles } from "./shared";
import { instantHiddenIds, piPackageTargetId, type InstantAction } from "../instantActions";
import { SettledRemovals } from "./settings/settledRemovals";
import { LOCAL_MACHINE_ID } from "../machineKeys";
import type { ApprovedMachineOrigin } from "../../../shared/machineAccess";

/** The reads the dialog makes, each read again by itself when it does not answer. */
type SettingsRead = "config" | "access" | "plugins" | "packages" | "skills" | "mcp";

@customElement("settings-dialog")
export class SettingsDialog extends LitElement {
  @state() private phoneLayout = false;
  /** What the reader is looking for; see `searchSettings`. */
  @state() private query = "";
  private readonly phoneQuery: MediaQueryList | undefined = typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(PHONE_LAYOUT_MEDIA_QUERY) : undefined;
  /** Undefined means the drill-down root: the phone shows the section list, the desktop falls back to General. */
  @property({ attribute: false }) section: SettingsSection | undefined = undefined;
  @property({ attribute: false }) actions: AppAction[] = [];
  @property({ attribute: false }) machine: Machine | undefined;
  @property({ attribute: false }) machineRuntime: MachineRuntime | undefined;
  /** This PI WEB's access gate is on, so this browser holds a sign-in cookie it can sign out of. */
  @property({ type: Boolean }) accessGate = false;
  @property({ attribute: false }) machines: readonly Machine[] = [];
  /** Plugins this browser could not load or register, per machine id, then plugin id, with the reason (B38). */
  @property({ attribute: false }) pluginLoadFailures: ReadonlyMap<string, ReadonlyMap<string, string>> = new Map();
  @property({ attribute: false }) machineAvailability: Readonly<Record<string, MachineReachabilityView>> = {};
  @property({ type: Boolean }) machinesForeground = true;
  @property({ attribute: false }) onMachinesVisibilityChange?: (owner: HTMLElement, visible: boolean) => void;
  @property({ attribute: false }) onBackToList?: () => void;
  @property({ attribute: false }) onAddMachine?: () => void;
  @property({ attribute: false }) onRenameMachine?: (machine: Machine, name: string) => void | Promise<void>;
  @property({ attribute: false }) onRemoveMachine?: (machine: Machine) => void | Promise<void>;
  @property({ attribute: false }) themes: readonly QualifiedThemeContribution[] = [];
  @property({ attribute: false }) selectedThemeId?: QualifiedContributionId;
  @property({ attribute: false }) activeThemeId?: QualifiedContributionId;
  @property({ type: Boolean }) followSystemTheme = false;
  @property({ attribute: false }) onSelectTheme?: (themeId: QualifiedContributionId) => void;
  @property({ attribute: false }) onToggleFollowSystem?: (follow: boolean) => void;
  /** Whether this PI WEB shares one theme across its browsers; undefined until its config is read. */
  @property({ attribute: false }) sharedTheme: boolean | undefined;
  @property({ attribute: false }) sharedThemeError = "";
  @property({ attribute: false }) onToggleSharedTheme?: (share: boolean) => void;
  /** Device notifications: what the browser allows, what the reader wants, and how to change it. */
  @property({ attribute: false }) notificationAvailability: NotificationAvailability = "unsupported";
  @property({ attribute: false }) notificationsWanted = false;
  @property({ attribute: false }) onToggleNotifications?: (wanted: boolean) => Promise<NotificationAvailability>;
  @property({ attribute: false }) onTestNotification?: () => Promise<boolean>;
  /**
   * The ntfy channel as this PI WEB describes it. Read when the panel opens, because the answer is
   * the server's: the notices are sent from the machine that runs the tasks, and its topic never
   * reaches a browser, so the panel can only ask.
   */
  @state() private ntfyStatus: NtfyStatus | undefined = undefined;
  @property({ attribute: false }) fleetReport?: PiWebFleetReport;
  /** Each fleet machine's own PI WEB status read, by machine id. */
  @property({ attribute: false }) fleetStatuses: Readonly<Record<string, FleetStatusRead>> = {};
  /** The app's instant actions (instant-actions.md): the packages and pages being removed leave these lists at once. */
  @property({ attribute: false }) instantActions: readonly InstantAction[] = [];
  /** Removes a Pi package of a machine at once, held for the Undo window; the host owns the window. */
  @property({ attribute: false }) onRemovePiPackage?: (target: SettingsMachineTarget, source: string, scope: PiPackageScope) => void;
  /** Forgets a page this machine approved, held for the Undo window. */
  @property({ attribute: false }) onForgetPageAccess?: (entry: ApprovedMachineOrigin) => void;
  private readonly packageRemovals = new SettledRemovals();
  @property({ type: Boolean }) fleetLoading = false;
  @property({ attribute: false }) fleetError?: string;
  @property({ attribute: false }) onRefreshFleet?: () => void | Promise<void>;
  @property({ attribute: false }) onRunFleet?: (operation: "restart" | "update", machineIds?: readonly string[]) => Promise<PiWebFleetRunResponse | undefined>;
  @property({ attribute: false }) onNavigate?: (section: SettingsSection) => void;
  @property({ attribute: false }) pluginSections: readonly QualifiedSettingsSectionContribution[] = [];
  @property({ attribute: false }) pluginRuntimeContext?: PluginRuntimeContext;
  @property({ attribute: false }) onClose?: () => void;
  @property({ attribute: false }) onConfigSaved?: (config: PiWebConfigValues) => void;
  /** A field another page linked to; see SettingsReveal. */
  @property({ attribute: false }) reveal: SettingsReveal | undefined;
  @property({ attribute: false }) onRevealed?: () => void;
  /** A plugin's enablement was saved; the host reloads the page when Settings closes, so its code loads or leaves. */
  @property({ attribute: false }) onPluginsChanged?: () => void;
  @property({ type: Boolean }) reloadOnClose = false;
  @property({ attribute: false }) onRefreshMachineRuntime?: (machineId: string) => void | Promise<void>;
  @state() private configResponse: PiWebConfigResponse | undefined;
  @state() private savingListTiles = false;
  @state() private listTilesError = "";
  @state() private accessConfigResponse: PiWebConfigResponse | undefined;
  @state() private pluginsResponse: PiWebPluginsResponse | undefined;
  @state() private selectedPluginConfigResponse: PiWebConfigResponse | undefined;
  @state() private selectedPluginsResponse: PiWebPluginsResponse | undefined;
  @state() private packagesResponse: PiPackagesResponse | undefined;
  @state() private skillsResponse: PiSkillsResponse | undefined;
  @state() private mcpResponse: PiMcpListResponse | undefined;
  @state() private mcpProjects: Project[] = [];
  @state() private mcpProjectSelection: string | undefined;
  @state() private mcpProjectsLoading = true;
  @state() private mcpProjectsError = "";
  @state() private loading = true;
  @state() private accessLoading = true;
  @state() private pluginLoading = true;
  @state() private packageLoading = true;
  @state() private skillsLoading = true;
  @state() private mcpLoading = true;
  @state() private saving = false;
  @state() private packageOperation: PiPackageOperationState | undefined;
  @state() private skillOperation: PiSkillOperationState | undefined;
  @state() private mcpOperation: PiMcpOperationState | undefined;
  @state() private error = "";
  @state() private accessError = "";
  @state() private pluginError = "";
  @state() private packageError = "";
  @state() private skillsError = "";
  @state() private mcpError = "";
  @state() private savedMessage = "";
  @state() private packageMessage = "";
  @state() private skillsMessage = "";
  @state() private mcpMessage = "";
  private savedMessageTimer: number | undefined;
  private loadRequestSeq = 0;
  private accessLoadRequestSeq = 0;
  private pluginLoadRequestSeq = 0;
  private packageLoadRequestSeq = 0;
  private packageMutationSeq = 0;
  private skillsLoadRequestSeq = 0;
  private skillsMutationSeq = 0;
  private mcpLoadRequestSeq = 0;
  private mcpMutationSeq = 0;
  /**
   * The project each machine's MCP panel is managing, remembered per machine for the open dialog.
   *
   * A project's `mcp.json` is one machine's file, so a selection cannot travel between machines; and a
   * read is answered for the scope it was asked for, so the scope is part of every fence that decides
   * whether an answer may paint.
   */
  private readonly mcpProjectSelections = new Map<string, string | undefined>();
  private mcpProjectsLoadSeq = 0;
  private readonly readAttempts = new Map<SettingsRead, number>();
  private readonly readAgainTimers = new Map<SettingsRead, ReturnType<typeof setTimeout>>();

  private readonly handlePhoneQueryChange = (event: MediaQueryListEvent): void => {
    this.phoneLayout = event.matches;
  };

  override connectedCallback(): void {
    super.connectedCallback();
    this.phoneLayout = this.phoneQuery?.matches ?? false;
    this.phoneQuery?.addEventListener("change", this.handlePhoneQueryChange);
    void this.loadConfig();
    void this.loadNtfyStatus();
    void this.loadAccessConfigForTarget();
    void this.onRefreshMachineRuntime?.(this.settingsTarget().id);
    void this.loadPluginsForTarget();
    void this.loadPackagesForTarget();
    void this.loadSkillsForTarget();
    void this.loadMcpProjectsForTarget();
    void this.loadMcpForTarget();
  }

  override disconnectedCallback(): void {
    this.phoneQuery?.removeEventListener("change", this.handlePhoneQueryChange);
    if (this.savedMessageTimer !== undefined) window.clearTimeout(this.savedMessageTimer);
    this.savedMessageTimer = undefined;
    for (const timer of this.readAgainTimers.values()) clearTimeout(timer);
    this.readAgainTimers.clear();
    super.disconnectedCallback();
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("instantActions") || changed.has("machine")) {
      const target = this.packageTarget();
      this.packageRemovals.update(target.id, instantHiddenIds("remove-package", target.id, this.instantActions), () => this.loadPackagesForTarget(target, "keep"), () => { this.requestUpdate(); });
    }
  }

  /** The packages as the panel draws them: without the ones being removed. */
  private shownPackagesResponse(): PiPackagesResponse | undefined {
    const response = this.packagesResponse;
    if (response === undefined) return undefined;
    const target = this.packageTarget();
    return { ...response, packages: response.packages.filter((entry) => this.packageRemovals.shows(target.id, piPackageTargetId(entry.scope, entry.source))) };
  }

  /**
   * A Pi package removal the machine did (`instantActions.ts`): while the panel shows that machine,
   * its message line says what the removal asks of the reader next, and the gateway's plugins are
   * read again for the local one, as when the panel waited for the removal itself.
   */
  async piPackageRemoved(machineId: string, followUp: string): Promise<void> {
    const target = this.packageTarget();
    if (target.id !== machineId) return;
    const pluginRefreshError = shouldRefreshGatewayPluginsAfterPiPackageMutation(target) ? await this.refreshGatewayPlugins() : undefined;
    if (!this.isCurrentPackageTarget(target)) return;
    if (pluginRefreshError !== undefined) this.packageError = pluginRefreshError;
    this.packageMessage = followUp;
  }

  protected override updated(changed: PropertyValues<this>): void {
    const currentTarget = this.settingsTarget();
    if (changed.has("machine")) {
      const previousTarget = settingsMachineTarget(changed.get("machine"));
      if (previousTarget.id !== currentTarget.id) {
        this.resetAccessStateForTargetChange();
        if (this.isConnected) void this.loadAccessConfigForTarget(currentTarget);
        this.resetPluginStateForTargetChange();
        if (this.isConnected) void this.loadPluginsForTarget(currentTarget);
        this.resetPackageStateForTargetChange();
        if (this.isConnected) void this.loadPackagesForTarget(currentTarget);
        this.resetSkillsStateForTargetChange();
        this.resetMcpStateForTargetChange();
        if (this.isConnected) void this.loadSkillsForTarget(currentTarget);
        if (this.isConnected) void this.loadMcpProjectsForTarget(currentTarget);
        if (this.isConnected) void this.loadMcpForTarget(currentTarget);
        return;
      }
    }

    if (!changed.has("machineRuntime")) return;
    if (!this.pluginLifecycleSupportNeedsReload(changed.get("machineRuntime"), currentTarget)) return;
    this.resetPluginStateForTargetChange();
    if (this.isConnected) void this.loadPluginsForTarget(currentTarget);
  }

  override render(): TemplateResult {
    if (this.phoneLayout && this.section === undefined) return this.renderPhoneList();
    if (this.phoneLayout) return this.renderPhoneDetail();
    return html`
      <modal-surface .onClose=${() => this.onClose?.()} .label=${"PI WEB settings"}>
        <header class="settings-header">
          <div>
            <span class="eyebrow">Settings</span>
            <h1>PI WEB</h1>
          </div>
          <button class="close-button bar-key" title="Close settings" aria-label="Close settings" @click=${() => this.onClose?.()}>${renderCrossIcon()}</button>
        </header>
        <div class="settings-body">
          <nav class="settings-nav page-scroller" aria-label="Settings sections">
            ${this.renderSearchField()}
            ${this.matchedSections().map((entry) => this.renderNavButton(entry.id, entry.label, entry.detail))}
            ${this.renderNoMatch()}
          </nav>
          <main class="settings-content page-scroller">
            ${this.renderActiveSection()}
          </main>
        </div>
      </modal-surface>
    `;
  }

  /** The phone's drill-down root: sections as rows, no tab strip to swipe through. */
  private renderPhoneList(): TemplateResult {
    return html`
      <modal-surface .onClose=${() => this.onClose?.()} .label=${"PI WEB settings"}>
        <header class="settings-header settings-header-phone">
          <h1 class="panel-header-title">Settings</h1>
          <button class="close-button bar-key" title="Close settings" aria-label="Close settings" @click=${() => this.onClose?.()}>${renderCrossIcon()}</button>
        </header>
        <nav class="settings-list page-scroller" aria-label="Settings sections">
          ${this.renderSearchField()}
          ${this.matchedSections().map((entry) => this.renderListRow(entry.id, entry.label, entry.detail))}
          ${this.renderNoMatch()}
        </nav>
      </modal-surface>
    `;
  }

  /** The sections this dialog offers, before any search narrows them. */
  private sectionEntries(): SettingsEntry<SettingsSection>[] {
    return [
      { id: "general", label: "General", detail: "Gateway + selected machine" },
      { id: "appearance", label: "Appearance", detail: "Theme, lists and system preference" },
      { id: "notifications", label: "Notifications", detail: "This browser, ntfy, task events" },
      { id: "machines", label: "Machines", detail: "All connected devices" },
      { id: "packages", label: "Pi Packages", detail: "Selected machine" },
      { id: "skills", label: "Skills", detail: "Selected machine" },
      { id: "mcp", label: "MCP Servers", detail: "Selected machine" },
      { id: "plugins", label: "PI WEB Plugins", detail: "Selected machine" },
      { id: "shortcuts", label: "Keyboard", detail: "Gateway shortcuts" },
      ...this.pluginSections.map((entry) => ({ id: entry.id, label: entry.title, detail: "Plugin" })),
    ];
  }

  private matchedSections(): SettingsEntry<SettingsSection>[] {
    return searchSettings(this.sectionEntries(), this.query);
  }

  private renderSearchField(): TemplateResult {
    return html`
      <div class="settings-search">
        <input
          type="search"
          class="settings-search-input"
          inputmode="search"
          autocomplete="off"
          spellcheck="false"
          aria-label="Search settings"
          placeholder="Search settings"
          .value=${this.query}
          @input=${(event: Event) => { if (event.target instanceof HTMLInputElement) this.query = event.target.value; }}
        >
      </div>
    `;
  }

  private renderNoMatch(): TemplateResult | null {
    if (this.matchedSections().length > 0) return null;
    return html`<p class="settings-no-match" role="status">No setting matches “${this.query.trim()}”.</p>`;
  }

  private renderListRow(section: SettingsSection, label: string, detail: string): TemplateResult {
    return html`
      <button @click=${() => this.onNavigate?.(section)}>
        <span class="settings-list-label">
          <strong>${label}</strong>
          <small>${detail}</small>
        </span>
        <span class="settings-list-chevron">${renderDisclosureIcon(true)}</span>
      </button>
    `;
  }

  private renderPhoneDetail(): TemplateResult {
    return html`
      <modal-surface .onClose=${() => this.onClose?.()} .label=${"PI WEB settings"}>
        <header class="settings-header settings-header-phone">
          <button class="settings-back bar-key" title="Back to Settings" aria-label="Back to Settings" @click=${() => this.onBackToList?.()}>${renderBackIcon()}</button>
          <h1 class="panel-header-title">Settings</h1>
          <button class="close-button bar-key" title="Close settings" aria-label="Close settings" @click=${() => this.onClose?.()}>${renderCrossIcon()}</button>
        </header>
        <main class="settings-content page-scroller">
          ${this.renderActiveSection()}
        </main>
      </modal-surface>
    `;
  }

  private get activeSection(): SettingsSection {
    return this.section ?? "general";
  }

  private detailTitle(): string {
    const section = this.section;
    if (section !== undefined && isPluginSettingsSection(section)) {
      return this.pluginSections.find((entry) => entry.id === section)?.title ?? "Plugin";
    }
    const active = section ?? "general";
    return this.sectionEntries().find((entry) => entry.id === active)?.label ?? "Settings";
  }

  private renderActiveSection(): TemplateResult {
    if (isPluginSettingsSection(this.activeSection)) return this.renderPluginSection(this.activeSection);
    // Keep the section -> panel routing in sync with the public
    // `activeSettingsPanelTag` seam below, which tests assert against instead of
    // scraping this template's markup.
    if (this.activeSection === "machines") {
      return html`
        <settings-machines-panel
          .machines=${this.machines}
          .machineAvailability=${this.machineAvailability}
          .foreground=${this.machinesForeground}
          .onMachinesVisibilityChange=${this.onMachinesVisibilityChange}
          .onAdd=${() => this.onAddMachine?.()}
          .onRename=${(machine: Machine, name: string) => this.onRenameMachine?.(machine, name)}
          .onRemove=${(machine: Machine) => this.onRemoveMachine?.(machine)}
          .hiddenPageAccess=${instantHiddenIds("remove-page-access", LOCAL_MACHINE_ID, this.instantActions)}
          .onForgetPageAccess=${this.onForgetPageAccess}
          .fleetReport=${this.fleetReport}
          .fleetStatuses=${this.fleetStatuses}
          ?fleetLoading=${this.fleetLoading}
          .fleetError=${this.fleetError}
          .onRefreshFleet=${() => this.onRefreshFleet?.()}
          .onRunFleet=${(operation: "restart" | "update", machineIds?: readonly string[]) => this.onRunFleet?.(operation, machineIds) ?? Promise.resolve(undefined)}
        ></settings-machines-panel>
      `;
    }
    if (this.activeSection === "appearance") {
      return html`
        <settings-appearance-panel
          .themes=${this.themes}
          .selectedThemeId=${this.selectedThemeId}
          .activeThemeId=${this.activeThemeId}
          ?followSystem=${this.followSystemTheme}
          .onSelectTheme=${(themeId: QualifiedContributionId) => this.onSelectTheme?.(themeId)}
          .onToggleFollowSystem=${(follow: boolean) => this.onToggleFollowSystem?.(follow)}
          .sharedTheme=${this.sharedTheme}
          .sharedThemeError=${this.sharedThemeError}
          .onToggleSharedTheme=${(share: boolean) => this.onToggleSharedTheme?.(share)}
          .listTiles=${this.configResponse?.config.listTiles}
          ?listTilesReady=${this.configResponse !== undefined}
          ?savingListTiles=${this.savingListTiles}
          .listTilesError=${this.listTilesError}
          .onSelectListTiles=${(layout: ListLayout, tiles: ListTilesPerRow) => { void this.saveListTiles(layout, tiles); }}
        ></settings-appearance-panel>
      `;
    }
    if (this.activeSection === "notifications") {
      return html`
        <settings-notifications-panel
          .availability=${this.notificationAvailability}
          .wanted=${this.notificationsWanted}
          .onToggle=${(wanted: boolean) => this.onToggleNotifications?.(wanted) ?? Promise.resolve(this.notificationAvailability)}
          .onTest=${() => this.onTestNotification?.() ?? Promise.resolve(false)}
          .ntfy=${this.ntfyStatus}
          .onSaveNtfy=${(draft: NtfyConfig, write: { readonly clearTopic?: boolean }) => this.saveNtfy(draft, write)}
          .onTestNtfy=${(draft: NtfyConfig) => this.testNtfy(draft)}
        ></settings-notifications-panel>
      `;
    }
    if (this.activeSection === "shortcuts") {
      return html`
        <settings-shortcuts-panel
          .actions=${this.actions}
          .configResponse=${this.configResponse}
          .loading=${this.loading}
          .saving=${this.saving}
          .error=${this.error}
          .savedMessage=${this.savedMessage}
          .onReload=${() => this.loadConfig()}
          .onSave=${(config: PiWebConfigValues) => this.saveConfig(config)}
        ></settings-shortcuts-panel>
      `;
    }
    if (this.activeSection === "packages") {
      return html`
        <settings-packages-panel
          .packagesResponse=${this.shownPackagesResponse()}
          .targetMachine=${this.packageTarget()}
          .loading=${this.packageLoading}
          .operation=${this.packageOperation}
          .error=${this.packageError}
          .operationMessage=${this.packageMessage}
          .onReload=${() => this.loadPackagesForTarget()}
          .onInstallPackage=${(source: string) => this.installPiPackage(source)}
          .onRemovePackage=${(source: string, scope: PiPackageScope) => { this.removePiPackage(source, scope); }}
          .onUpdatePackage=${(source?: string) => this.updatePiPackage(source)}
          .onTogglePackage=${(source: string, scope: PiPackageScope, enabled: boolean) => this.setPiPackageEnabled(source, scope, enabled)}
        ></settings-packages-panel>
      `;
    }
    if (this.activeSection === "skills") {
      return html`
        <settings-skills-panel
          .skillsResponse=${this.skillsResponse}
          .targetMachine=${this.settingsTarget()}
          .loading=${this.skillsLoading}
          .operation=${this.skillOperation}
          .error=${this.skillsError}
          .operationMessage=${this.skillsMessage}
          .onReload=${() => { void this.loadMcpProjectsForTarget(); void this.loadSkillsForTarget(); }}
          .projects=${this.mcpProjects}
          .projectSelection=${this.mcpProjectSelection}
          .projectsLoading=${this.mcpProjectsLoading}
          .projectsError=${this.mcpProjectsError}
          .onSelectProject=${(projectId: string | undefined) => { this.selectMcpProject(projectId); }}
          .onToggleSkill=${(skill: PiSkillInfo, enabled: boolean) => this.setSkillEnabled(skill, enabled)}
        ></settings-skills-panel>
      `;
    }
    if (this.activeSection === "mcp") {
      return html`
        <settings-mcp-panel
          .mcpResponse=${this.mcpResponse}
          .targetMachine=${this.settingsTarget()}
          .loading=${this.mcpLoading}
          .operation=${this.mcpOperation}
          .error=${this.mcpError}
          .operationMessage=${this.mcpMessage}
          .onReload=${() => { void this.loadMcpProjectsForTarget(); void this.loadMcpForTarget(); }}
          .projects=${this.mcpProjects}
          .projectSelection=${this.mcpProjectSelection}
          .projectsLoading=${this.mcpProjectsLoading}
          .projectsError=${this.mcpProjectsError}
          .onSelectProject=${(projectId: string | undefined) => { this.selectMcpProject(projectId); }}
          .onToggleServer=${(server: PiMcpServerInfo, target: PiMcpWriteTarget, enabled: boolean) => this.setMcpServerEnabled(server, target, enabled)}
          .onRemoveServer=${(server: PiMcpServerInfo, target: PiMcpWriteTarget) => this.removeMcpServer(server, target)}
          .onTestServer=${(server: PiMcpServerInfo) => this.testMcpServer(server)}
        ></settings-mcp-panel>
      `;
    }
    if (this.activeSection === "plugins") {
      return html`
        <settings-plugins-panel
          .configResponse=${this.selectedPluginConfigResponse}
          .pluginsResponse=${this.selectedPluginsResponse}
          .loading=${this.pluginLoading}
          .saving=${this.saving}
          .recoveryCommandsSupported=${this.pluginLifecycleSupport().state === "supported"}
          .error=${this.pluginError}
          .savedMessage=${this.savedMessage}
          ?reloadOnClose=${this.reloadOnClose}
          .targetLabel=${settingsMachineTargetLabel(this.settingsTarget())}
          .onReload=${() => this.loadPluginsForTarget()}
          .onTogglePlugin=${(pluginId: string, enabled: boolean) => this.togglePlugin(pluginId, enabled)}
          .browserFailures=${this.pluginLoadFailures.get(this.settingsTarget().id)}
        ></settings-plugins-panel>
      `;
    }
    return html`
      <settings-general-panel
        .configResponse=${this.configResponse}
        .machineConfigResponse=${this.accessConfigResponse}
        .loading=${this.loading}
        .machineLoading=${this.accessLoading}
        .saving=${this.saving}
        .error=${this.error}
        .machineError=${this.accessError}
        .savedMessage=${this.savedMessage}
        .targetLabel=${settingsMachineTargetLabel(this.settingsTarget())}
        .onReload=${() => this.loadConfig()}
        .onReloadMachine=${() => this.loadAccessConfigForTarget()}
        .onSave=${(config: PiWebConfigValues) => this.saveConfig(config)}
        .onSaveMachineConfig=${(config: PiWebConfigValues) => this.saveMachineAccessConfig(config)}
        .onSaveMachineLogging=${(config: PiWebConfigValues) => this.saveMachinePatch(config, "log settings")}
        .onSaveMachineUpdateCommand=${(config: PiWebConfigValues) => this.saveMachinePatch(config, "the update command")}
        .reveal=${this.reveal}
        .onRevealed=${() => { this.onRevealed?.(); }}
        ?accessGate=${this.accessGate}
      ></settings-general-panel>
    `;
  }

  private renderPluginSection(section: QualifiedContributionId): TemplateResult {
    const entry = this.pluginSections.find((candidate) => candidate.id === section);
    if (entry === undefined) {
      return html`<div class="settings-plugin-section settings-plugin-section-missing">
        <strong>This section is not available</strong>
        <small>No plugin on this machine provides "${section}".</small>
      </div>`;
    }
    return html`<div class="settings-plugin-section">${this.renderPluginSectionBody(entry)}</div>`;
  }

  private renderPluginSectionBody(entry: QualifiedSettingsSectionContribution): TemplateResult {
    const context = this.pluginRuntimeContext;
    if (context === undefined) return html`<small>This section cannot be drawn without a session context.</small>`;
    return askPluginOr(entry, "render", "the section draws a note in its place", () => entry.render(context), (error) => html`<small role="status">${pluginDrawFailureText(entry.title, error)}</small>`);
  }

  private renderNavButton(section: SettingsSection, label: string, detail: string): TemplateResult {
    const selected = this.activeSection === section;
    return html`
      <button class=${selected ? "selected" : ""} aria-current=${selected ? "page" : "false"} @click=${() => { this.navigate(section); }}>
        <strong>${label}</strong>
        <small>${detail}</small>
      </button>
    `;
  }

  private navigate(section: SettingsSection): void {
    this.onNavigate?.(section);
  }

  /**
   * The ntfy channel, read from the machine that will send the notices.
   *
   * A read that fails leaves the status unknown rather than inventing "off": the panel then shows the
   * fields unmarked, and "absent is not negation" - an unanswered question is not a No.
   */
  private async loadNtfyStatus(): Promise<void> {
    try {
      this.ntfyStatus = await notificationsApi.ntfyStatus();
    } catch {
      this.ntfyStatus = undefined;
    }
  }

  /**
   * The ntfy block the panel saved.
   *
   * The write goes to its own endpoint, not to the general config save, for one reason: the general
   * save round-trips the whole config through this browser, and this browser has never seen the topic.
   * Saving the switches that way would delete the channel they are meant to travel on.
   */
  private async saveNtfy(draft: NtfyConfig, write: { readonly clearTopic?: boolean }): Promise<void> {
    const response = await configApi.saveNtfy(draft, write);
    this.configResponse = response;
    this.ntfyStatus = await notificationsApi.ntfyStatus().catch(() => this.ntfyStatus);
  }

  /**
   * One notice, now, from the server, to the block the panel is showing.
   *
   * The draft travels because a reader who has just typed a server and a topic asked whether those
   * work. A test that published the stored block answered a question nobody asked.
   */
  private async testNtfy(draft: NtfyConfig): Promise<{ delivered: boolean; attempts: number; reason?: string }> {
    return await notificationsApi.sendNtfyTest(draft);
  }

  private async loadConfig(): Promise<void> {
    const requestSeq = ++this.loadRequestSeq;
    this.loading = true;
    this.error = "";
    try {
      const result = await loadGatewaySettingsData({
        loadConfig: () => configApi.config(),
        loadPlugins: () => pluginsApi.plugins(),
      });
      if (!this.isCurrentLoad(requestSeq)) return;

      if (result.config !== undefined) this.configResponse = result.config;
      if (result.plugins !== undefined) this.pluginsResponse = result.plugins;
      this.error = result.error;
      this.afterRead("config", result.error === "" ? "answered" : "unanswered", () => this.loadConfig());
    } finally {
      if (this.isCurrentLoad(requestSeq)) this.loading = false;
    }
  }

  private async loadAccessConfigForTarget(target = this.settingsTarget()): Promise<void> {
    const requestSeq = ++this.accessLoadRequestSeq;
    this.accessLoading = true;
    this.accessError = "";
    try {
      const response = await configApi.config(target.id);
      if (!this.isCurrentAccessLoad(requestSeq, target)) return;
      this.accessConfigResponse = response;
      this.afterRead("access", "answered", () => this.loadAccessConfigForTarget(target));
    } catch (error) {
      if (this.isCurrentAccessLoad(requestSeq, target)) {
        this.accessError = `Failed to load file access/upload config from ${settingsMachineTargetLabel(target)}: ${settingsReadFailureWords(describeError(error), target)} · trying again…`;
        this.afterRead("access", "unanswered", () => this.loadAccessConfigForTarget(target));
      }
    } finally {
      if (this.isCurrentAccessLoad(requestSeq, target)) this.accessLoading = false;
    }
  }

  private async loadPluginsForTarget(target = this.settingsTarget()): Promise<void> {
    const requestSeq = ++this.pluginLoadRequestSeq;
    this.pluginLoading = true;
    this.pluginError = "";
    try {
      const lifecycleSupport = this.pluginLifecycleSupport(target);
      if (isSelectedMachineSettingsUnsupported(lifecycleSupport)) {
        try {
          const config = await configApi.config(target.id);
          if (!this.isCurrentPluginLoad(requestSeq, target)) return;
          this.selectedPluginConfigResponse = config;
          this.selectedPluginsResponse = undefined;
          this.pluginError = lifecycleSupport.message ?? `Plugin lifecycle diagnostics are not available on ${settingsMachineTargetLabel(target)}.`;
          this.afterRead("plugins", "answered", () => this.loadPluginsForTarget(target));
        } catch (error) {
          if (!this.isCurrentPluginLoad(requestSeq, target)) return;
          this.pluginError = `Failed to load PI WEB plugin config from ${settingsMachineTargetLabel(target)}: ${settingsReadFailureWords(describeError(error), target)}; ${lifecycleSupport.message ?? "plugin lifecycle diagnostics are unsupported"} · trying again…`;
          this.afterRead("plugins", "unanswered", () => this.loadPluginsForTarget(target));
        }
        return;
      }

      const [config, plugins] = await Promise.allSettled([configApi.config(target.id), pluginsApi.plugins(target.id)]);
      if (!this.isCurrentPluginLoad(requestSeq, target)) return;

      const errors: string[] = [];
      if (config.status === "fulfilled") this.selectedPluginConfigResponse = config.value;
      else errors.push(`config: ${settingsReadFailureWords(describeError(config.reason), target)}`);

      if (plugins.status === "fulfilled") this.selectedPluginsResponse = plugins.value;
      else errors.push(`PI WEB plugins: ${settingsReadFailureWords(describeError(plugins.reason), target)}`);

      this.pluginError = errors.length === 0 ? "" : `Failed to load PI WEB plugin settings from ${settingsMachineTargetLabel(target)}: ${errors.join("; ")} · trying again…`;
      this.afterRead("plugins", errors.length === 0 ? "answered" : "unanswered", () => this.loadPluginsForTarget(target));
    } finally {
      if (this.isCurrentPluginLoad(requestSeq, target)) this.pluginLoading = false;
    }
  }

  /** Read the packages; a read after a removal settled keeps the message line, which may say what that removal asks next. */
  private async loadPackagesForTarget(target = this.packageTarget(), message: "clear" | "keep" = "clear"): Promise<void> {
    const requestSeq = ++this.packageLoadRequestSeq;
    this.packageLoading = true;
    this.packageError = "";
    if (message === "clear") this.packageMessage = "";
    try {
      const result = await loadPiPackagesData(target, (targetId) => piPackagesApi.packages(targetId));
      if (!this.isCurrentPackageLoad(requestSeq, target)) return;

      this.packagesResponse = result.packagesResponse;
      this.packageError = result.error;
      this.afterRead("packages", result.error === "" ? "answered" : "unanswered", () => this.loadPackagesForTarget(target));
    } finally {
      if (this.isCurrentPackageLoad(requestSeq, target)) this.packageLoading = false;
    }
  }

  /**
   * The skills of the selected machine, for the project selected in the shared resource scope.
   * A response belongs to both its machine and project; an answer for a project the reader left
   * must never paint over the newly selected project's list.
   */
  private async loadSkillsForTarget(target = this.settingsTarget(), projectId = this.mcpProjectSelection): Promise<void> {
    const requestSeq = ++this.skillsLoadRequestSeq;
    this.skillsLoading = true;
    this.skillsError = "";
    try {
      const result = await loadPiSkillsData(target, (targetId) => piSkillsApi.list(projectId, targetId));
      if (!this.isCurrentSkillsLoad(requestSeq, target, projectId)) return;

      this.skillsResponse = result.skillsResponse;
      this.skillsError = result.error;
      this.afterRead("skills", result.error === "" ? "answered" : "unanswered", () => this.loadSkillsForTarget(target, projectId));
    } finally {
      if (this.isCurrentSkillsLoad(requestSeq, target, projectId)) this.skillsLoading = false;
    }
  }

  /**
   * The MCP servers of the selected machine, for the project the panel is managing.
   *
   * The project is part of the request, so the answer carries that project's own servers and its
   * overrides, and it is part of the fence, so an answer for the project the reader left cannot paint
   * over the one now on screen.
   */
  private async loadMcpForTarget(target = this.settingsTarget(), projectId = this.mcpProjectSelection): Promise<void> {
    const requestSeq = ++this.mcpLoadRequestSeq;
    this.mcpLoading = true;
    this.mcpError = "";
    try {
      const result = await loadPiMcpData(target, (targetId) => piMcpApi.list(projectId, targetId));
      if (!this.isCurrentMcpLoad(requestSeq, target, projectId)) return;

      this.mcpResponse = result.mcpResponse;
      this.mcpError = result.error;
      this.afterRead("mcp", result.error === "" ? "answered" : "unanswered", () => this.loadMcpForTarget(target, projectId));
    } finally {
      if (this.isCurrentMcpLoad(requestSeq, target, projectId)) this.mcpLoading = false;
    }
  }

  /** The projects this machine has, which is what the MCP panel is allowed to name as a scope. */
  private async loadMcpProjectsForTarget(target = this.settingsTarget()): Promise<void> {
    const requestSeq = ++this.mcpProjectsLoadSeq;
    this.mcpProjectsLoading = true;
    this.mcpProjectsError = "";
    try {
      const projects = await projectsApi.projects(target.id);
      if (!this.isCurrentMcpTarget(target, requestSeq)) return;
      this.mcpProjects = projects;
      const selected = this.mcpProjectSelection;
      if (selected !== undefined && !projects.some((project) => project.id === selected)) {
        this.mcpProjectSelection = undefined;
        this.mcpProjectSelections.set(target.id, undefined);
        void this.loadMcpForTarget(target, undefined);
        this.resetSkillsScopeState();
        void this.loadSkillsForTarget(target, undefined);
      }
    } catch (error) {
      if (!this.isCurrentMcpTarget(target, requestSeq)) return;
      this.mcpProjectsError = `The projects of ${settingsMachineTargetLabel(target)} did not load: ${friendlySelectedMachineSettingsErrorMessage(describeError(error), target)}`;
    } finally {
      if (this.isCurrentMcpTarget(target, requestSeq)) this.mcpProjectsLoading = false;
    }
  }

  /**
   * Changing the project scope the MCP panel manages.
   *
   * The rows of the project just left are dropped before the new read starts, and the reads and writes
   * in flight are fenced by the scope they were asked for, so a project's answer lands on its own page.
   */
  private selectMcpProject(projectId: string | undefined): void {
    const target = this.settingsTarget();
    if (this.mcpProjectSelection === projectId) return;
    this.mcpProjectSelections.set(target.id, projectId);
    this.mcpProjectSelection = projectId;
    this.resetMcpScopeState();
    this.resetSkillsScopeState();
    if (this.isConnected) {
      void this.loadMcpForTarget(target, projectId);
      void this.loadSkillsForTarget(target, projectId);
    }
  }

  /**
   * A settings read that did not answer is read again by itself, sooner first and then no longer
   * than 15 s apart, while the dialog is open (B48: the reader is never told to press Reload).
   */
  private afterRead(read: SettingsRead, outcome: "answered" | "unanswered", again: () => Promise<void>): void {
    clearTimeout(this.readAgainTimers.get(read));
    this.readAgainTimers.delete(read);
    this.readAfter[outcome](read, again);
  }

  private readonly readAfter: Readonly<Record<"answered" | "unanswered", (read: SettingsRead, again: () => Promise<void>) => void>> = {
    answered: (read) => { this.readAttempts.delete(read); },
    unanswered: (read, again) => {
      const attempt = this.readAttempts.get(read) ?? 0;
      this.readAttempts.set(read, attempt + 1);
      this.readAgainTimers.set(read, setTimeout(() => { if (this.isConnected) void again(); }, Math.min(1_000 * 2 ** attempt, 15_000)));
    },
  };

  private async togglePlugin(pluginId: string, enabled: boolean): Promise<void> {
    if (this.saving) return;
    const target = this.settingsTarget();
    const lifecycleSupport = this.pluginLifecycleSupport(target);
    if (this.selectedPluginConfigResponse === undefined) {
      this.pluginError = `Plugin config is not loaded for ${settingsMachineTargetLabel(target)}. Reload before changing plugin enablement.`;
      return;
    }
    const patch = pluginEnabledConfigPatch(this.selectedPluginConfigResponse.config, pluginId, enabled);
    this.saving = true;
    this.pluginError = "";
    this.savedMessage = "";
    try {
      const response = await configApi.saveConfig(patch, target.id);
      if (!this.isCurrentSettingsTarget(target)) return;
      this.selectedPluginConfigResponse = response;
      this.onPluginsChanged?.();
      if (target.kind === "local" && this.configResponse !== undefined) {
        this.configResponse = mergeSelectedMachinePluginConfig(this.configResponse, response);
        this.onConfigSaved?.(this.configResponse.effectiveConfig);
      }
      let pluginRefreshError: string | undefined;
      if (isSelectedMachineSettingsUnsupported(lifecycleSupport)) {
        this.selectedPluginsResponse = undefined;
        pluginRefreshError = lifecycleSupport.message ?? `Plugin lifecycle diagnostics are not available on ${settingsMachineTargetLabel(target)}.`;
      } else {
        pluginRefreshError = await this.refreshPluginsForTarget(target);
      }
      if (!this.isCurrentSettingsTarget(target)) return;
      if (pluginRefreshError !== undefined) this.pluginError = pluginRefreshError;
      this.showSavedMessage();
    } catch (error) {
      if (this.isCurrentSettingsTarget(target)) {
        this.pluginError = `Failed to save PI WEB plugin config on ${settingsMachineTargetLabel(target)}: ${friendlySelectedMachineSettingsErrorMessage(describeError(error), target)}`;
      }
    } finally {
      this.saving = false;
    }
  }

  /**
   * One layout's tiles per row, saved with the rest of the gateway config unchanged (the write
   * replaces every known key). Its saving flag and error are the Lists card's own: the dialog-wide
   * error also carries load failures and other cards' saves.
   */
  private async saveListTiles(layout: ListLayout, tiles: ListTilesPerRow): Promise<void> {
    const current = this.configResponse;
    if (current === undefined || this.savingListTiles) return;
    this.savingListTiles = true;
    this.listTilesError = "";
    try {
      const response = await configApi.saveConfig({ ...current.config, listTiles: withListTiles(current.config.listTiles, layout, tiles) });
      this.configResponse = response;
      this.onConfigSaved?.(response.effectiveConfig);
    } catch (error) {
      this.listTilesError = `The list layout was not saved: ${describeError(error)}`;
    } finally {
      this.savingListTiles = false;
    }
  }

  private async saveConfig(config: PiWebConfigValues): Promise<void> {
    if (this.saving) return;
    this.saving = true;
    this.error = "";
    this.savedMessage = "";
    try {
      const response = await configApi.saveConfig(config);
      this.configResponse = response;
      this.onConfigSaved?.(response.effectiveConfig);
      this.showSavedMessage();
    } catch (error) {
      this.error = `Failed to save config: ${describeError(error)}`;
    } finally {
      this.saving = false;
    }
  }

  private async saveMachineAccessConfig(config: PiWebConfigValues): Promise<void> {
    if (this.saving) return;
    const target = this.settingsTarget();
    this.saving = true;
    this.accessError = "";
    this.savedMessage = "";
    try {
      const response = await configApi.saveConfig(config, target.id);
      if (!this.isCurrentSettingsTarget(target)) return;
      this.accessConfigResponse = response;
      if (target.kind === "local" && this.configResponse !== undefined) {
        this.configResponse = mergeSelectedMachineAccessConfig(this.configResponse, response);
        this.onConfigSaved?.(this.configResponse.effectiveConfig);
      }
      this.showSavedMessage();
    } catch (error) {
      if (this.isCurrentSettingsTarget(target)) {
        this.accessError = `Failed to save file access/upload config on ${settingsMachineTargetLabel(target)}: ${friendlySelectedMachineSettingsErrorMessage(describeError(error), target)}`;
      }
    } finally {
      this.saving = false;
    }
  }

/** A machine card's own save (Logs, Updates). A failure is thrown back to the card, which says it in place, instead of landing in another card's message. */
  private async saveMachinePatch(config: PiWebConfigValues, what: string): Promise<void> {
    if (this.saving) throw new Error(`Another settings save is still running; save ${what} again in a moment.`);
    const target = this.settingsTarget();
    this.saving = true;
    this.savedMessage = "";
    try {
      const response = await configApi.saveConfig(config, target.id);
      if (!this.isCurrentSettingsTarget(target)) return;
      this.accessConfigResponse = response;
      if (target.kind === "local" && this.configResponse !== undefined) this.configResponse = mergeSelectedMachineAccessConfig(this.configResponse, response);
      this.showSavedMessage();
    } catch (error) {
      throw new Error(`Failed to save ${what} on ${settingsMachineTargetLabel(target)}: ${friendlySelectedMachineSettingsErrorMessage(describeError(error), target)}`, { cause: error });
    } finally {
      this.saving = false;
    }
  }

  private async installPiPackage(source: string): Promise<void> {
    const target = this.packageTarget();
    await this.runPiPackageMutation({ kind: "install", source }, "install Pi package", target, () => piPackagesApi.install(source, target.id));
  }

  private removePiPackage(source: string, scope: PiPackageScope): void {
    this.onRemovePiPackage?.(this.packageTarget(), source, scope);
  }

  private async updatePiPackage(source?: string): Promise<void> {
    const target = this.packageTarget();
    await this.runPiPackageMutation(source === undefined ? { kind: "update-all" } : { kind: "update", source }, "update Pi packages", target, () => piPackagesApi.update(source, target.id));
  }

  /**
   * A package that stays installed and contributes nothing (Pi's own package filter).
   *
   * The scope travels with the row: the same source can be configured at user and project scope, and
   * only the row the reader pressed is written.
   */
  private async setPiPackageEnabled(source: string, scope: PiPackageScope, enabled: boolean): Promise<void> {
    const target = this.packageTarget();
    await this.runPiPackageMutation({ kind: "set-enabled", source, scope }, "change the Pi package's enabled state", target, () => piPackagesApi.setEnabled({ source, scope, enabled }, target.id));
  }

  /**
   * One skill switch, written to the scope the row was read for.
   *
   * The answer is the whole skill list, so the rows the reader sees are the machine's answer to the
   * write, and the message says what a running session has to do to pick the new list up.
   */
  private async setSkillEnabled(skill: PiSkillInfo, enabled: boolean): Promise<void> {
    if (this.saving) return;
    const target = this.settingsTarget();
    const projectId = this.mcpProjectSelection;
    const toggle = piSkillToggleRequest(skill, enabled, this.skillsResponse?.scopes ?? [], projectId);
    const requestSeq = ++this.skillsMutationSeq;
    this.skillsLoadRequestSeq += 1;
    this.skillsLoading = false;
    this.saving = true;
    this.skillOperation = { name: toggle.name, scope: toggle.scope, enabled };
    this.skillsError = "";
    this.skillsMessage = "";
    try {
      const response = await piSkillsApi.setEnabled(toggle, target.id);
      if (!this.isCurrentSkillsMutation(requestSeq, target, projectId)) return;
      this.skillsResponse = response;
      this.skillsMessage = piSkillMutationMessage(toggle.scope, toggle.name, enabled, target);
    } catch (error) {
      if (this.isCurrentSkillsMutation(requestSeq, target, projectId)) {
        this.skillsError = `Failed to change the skill ${toggle.name} on ${settingsMachineTargetLabel(target)}: ${friendlySelectedMachineSettingsErrorMessage(describeError(error), target)}`;
      }
    } finally {
      if (this.skillsMutationSeq === requestSeq) {
        this.skillOperation = undefined;
        this.saving = false;
      }
    }
  }

  private async setMcpServerEnabled(server: PiMcpServerInfo, target: PiMcpWriteTarget, enabled: boolean): Promise<void> {
    const projectId = this.mcpProjectSelection;
    await this.runPiMcpMutation({ kind: "set-enabled", name: server.name, target: target.kind }, `set the MCP server ${server.name} ${enabled ? "on" : "off"}`, projectId, () => piMcpApi.setEnabled(piMcpSetEnabledRequest(server, target, enabled, projectId), this.settingsTarget().id));
  }

  private async removeMcpServer(server: PiMcpServerInfo, target: PiMcpWriteTarget): Promise<void> {
    const projectId = this.mcpProjectSelection;
    const what = target.kind === "override" ? "project override of the MCP server" : "MCP server";
    await this.runPiMcpMutation({ kind: "remove", name: server.name, target: target.kind }, `remove the ${what} ${server.name}`, projectId, () => piMcpApi.remove(piMcpRemoveRequest(server, target, projectId), this.settingsTarget().id));
  }

  /** A probe is a read that answers in seconds and changes nothing, so it carries no reload note. */
  private async testMcpServer(server: PiMcpServerInfo): Promise<void> {
    const projectId = this.mcpProjectSelection;
    await this.runPiMcpMutation({ kind: "test", name: server.name }, `test the MCP server ${server.name}`, projectId, () => piMcpApi.test(piMcpTestRequest(server, projectId), this.settingsTarget().id));
  }

  /**
   * One MCP write, answered by the whole list.
   *
   * A response from a machine the reader has left is dropped: its rows belong to that machine, not to
   * the one now on screen.
   */
  private async runPiMcpMutation(operation: PiMcpOperationState, label: string, projectId: string | undefined, mutate: () => Promise<PiMcpMutationResponse>): Promise<void> {
    if (this.saving) return;
    const target = this.settingsTarget();
    const requestSeq = ++this.mcpMutationSeq;
    this.mcpLoadRequestSeq += 1;
    this.mcpLoading = false;
    this.saving = true;
    this.mcpOperation = operation;
    this.mcpError = "";
    this.mcpMessage = "";
    try {
      const response = await mutate();
      if (!this.isCurrentMcpMutation(requestSeq, target, projectId)) return;
      this.mcpResponse = response;
      this.mcpMessage = piMcpMutationMessage(response, target);
    } catch (error) {
      if (this.isCurrentMcpMutation(requestSeq, target, projectId)) {
        this.mcpError = `Failed to ${label} on ${settingsMachineTargetLabel(target)}: ${friendlySelectedMachineSettingsErrorMessage(describeError(error), target)}`;
      }
    } finally {
      if (this.mcpMutationSeq === requestSeq) {
        this.mcpOperation = undefined;
        this.saving = false;
      }
    }
  }

  private async runPiPackageMutation(operation: PiPackageOperationState, label: string, target: SettingsMachineTarget, mutate: () => Promise<PiPackageMutationResponse>): Promise<void> {
    if (this.saving) throw new Error("A settings operation is already running.");
    const requestSeq = ++this.packageMutationSeq;
    this.packageLoadRequestSeq += 1;
    this.packageLoading = false;
    this.saving = true;
    this.packageOperation = operation;
    this.packageError = "";
    this.packageMessage = "";
    try {
      const response = await mutate();
      if (!this.isCurrentPackageMutation(requestSeq, target)) return;
      this.packagesResponse = { packages: response.packages };
      const pluginRefreshError = shouldRefreshGatewayPluginsAfterPiPackageMutation(target) ? await this.refreshGatewayPlugins() : undefined;
      if (!this.isCurrentPackageMutation(requestSeq, target)) return;
      if (pluginRefreshError !== undefined) this.packageError = pluginRefreshError;
      this.packageMessage = piPackageMutationFollowUpMessage(response.action, target);
    } catch (error) {
      if (this.isCurrentPackageMutation(requestSeq, target)) this.packageError = `Failed to ${label} on ${settingsMachineTargetLabel(target)}: ${friendlyPiPackageErrorMessage(describeError(error), target)}`;
      throw error;
    } finally {
      if (this.packageMutationSeq === requestSeq) {
        this.packageOperation = undefined;
        this.saving = false;
      }
    }
  }

  private async refreshGatewayPlugins(): Promise<string | undefined> {
    try {
      this.pluginsResponse = await pluginsApi.plugins();
      return undefined;
    } catch (error) {
      return `Failed to refresh gateway PI WEB plugins: ${describeError(error)}`;
    }
  }

  private async refreshPluginsForTarget(target: SettingsMachineTarget): Promise<string | undefined> {
    try {
      const response = await pluginsApi.plugins(target.id);
      if (this.isCurrentSettingsTarget(target)) this.selectedPluginsResponse = response;
      return undefined;
    } catch (error) {
      if (this.isCurrentSettingsTarget(target)) this.selectedPluginsResponse = undefined;
      return `Config saved, but failed to refresh PI WEB plugins from ${settingsMachineTargetLabel(target)}: ${friendlySelectedMachineSettingsErrorMessage(describeError(error), target)}`;
    }
  }

  private settingsTarget(): SettingsMachineTarget {
    return settingsMachineTarget(this.machine);
  }

  private packageTarget(): SettingsMachineTarget {
    return this.settingsTarget();
  }

  private pluginLifecycleSupport(target = this.settingsTarget()): PluginLifecycleSupport {
    return pluginLifecycleSupport(target, this.machineRuntime);
  }

  private pluginLifecycleSupportNeedsReload(previousRuntime: MachineRuntime | undefined, target: SettingsMachineTarget): boolean {
    const previousSupport = pluginLifecycleSupport(target, previousRuntime);
    const currentSupport = this.pluginLifecycleSupport(target);
    return selectedMachineSettingsSupportKey(previousSupport) !== selectedMachineSettingsSupportKey(currentSupport);
  }

  private isCurrentLoad(requestSeq: number): boolean {
    return requestSeq === this.loadRequestSeq;
  }

  private isCurrentAccessLoad(requestSeq: number, target: SettingsMachineTarget): boolean {
    return requestSeq === this.accessLoadRequestSeq && this.isCurrentSettingsTarget(target);
  }

  private isCurrentPluginLoad(requestSeq: number, target: SettingsMachineTarget): boolean {
    return requestSeq === this.pluginLoadRequestSeq && this.isCurrentSettingsTarget(target);
  }

  private isCurrentPackageLoad(requestSeq: number, target: SettingsMachineTarget): boolean {
    return requestSeq === this.packageLoadRequestSeq && this.isCurrentPackageTarget(target);
  }

  private isCurrentPackageMutation(requestSeq: number, target: SettingsMachineTarget): boolean {
    return requestSeq === this.packageMutationSeq && this.isCurrentPackageTarget(target);
  }

  private isCurrentSkillsMutation(requestSeq: number, target: SettingsMachineTarget, projectId: string | undefined): boolean {
    return requestSeq === this.skillsMutationSeq && this.isCurrentSkillsScope(target, projectId);
  }

  private isCurrentSkillsLoad(requestSeq: number, target: SettingsMachineTarget, projectId: string | undefined): boolean {
    return requestSeq === this.skillsLoadRequestSeq && this.isCurrentSkillsScope(target, projectId);
  }

  private isCurrentSkillsScope(target: SettingsMachineTarget, projectId: string | undefined): boolean {
    return this.isCurrentSkillsTarget(target) && this.mcpProjectSelection === projectId;
  }

  private isCurrentMcpMutation(requestSeq: number, target: SettingsMachineTarget, projectId: string | undefined): boolean {
    return requestSeq === this.mcpMutationSeq && this.isCurrentMcpScope(target, projectId);
  }
  private isCurrentMcpLoad(requestSeq: number, target: SettingsMachineTarget, projectId: string | undefined): boolean {
    return requestSeq === this.mcpLoadRequestSeq && this.isCurrentMcpScope(target, projectId);
  }
  /** An MCP answer belongs to the machine and the project it was read for, not to the screen. */
  private isCurrentMcpScope(target: SettingsMachineTarget, projectId: string | undefined): boolean {
    return this.isCurrentMcpTarget(target) && this.mcpProjectSelection === projectId;
  }

  private isCurrentSkillsTarget(target: SettingsMachineTarget): boolean {
    return this.settingsTarget().id === target.id;
  }

  private isCurrentMcpTarget(target: SettingsMachineTarget, requestSeq?: number): boolean {
    if (requestSeq !== undefined && requestSeq !== this.mcpProjectsLoadSeq) return false;
    return this.settingsTarget().id === target.id;
  }

  private isCurrentPackageTarget(target: SettingsMachineTarget): boolean {
    return this.packageTarget().id === target.id;
  }

  private isCurrentSettingsTarget(target: SettingsMachineTarget): boolean {
    return this.settingsTarget().id === target.id;
  }

  private resetAccessStateForTargetChange(): void {
    this.accessLoadRequestSeq += 1;
    this.accessLoading = false;
    this.accessError = "";
    this.accessConfigResponse = undefined;
    this.savedMessage = "";
  }

  private resetPluginStateForTargetChange(): void {
    this.pluginLoadRequestSeq += 1;
    this.pluginLoading = false;
    this.pluginError = "";
    this.selectedPluginConfigResponse = undefined;
    this.selectedPluginsResponse = undefined;
    this.savedMessage = "";
  }

  private resetPackageStateForTargetChange(): void {
    const hadPackageOperation = this.packageOperation !== undefined;
    this.packageLoadRequestSeq += 1;
    this.packageMutationSeq += 1;
    this.packageLoading = false;
    this.packageOperation = undefined;
    this.packageMessage = "";
    this.packageError = "";
    this.packagesResponse = undefined;
    if (hadPackageOperation) this.saving = false;
  }

  /** The skills of the machine the reader left are never the skills of the machine they entered. */
  private resetSkillsStateForTargetChange(): void {
    const hadSkillOperation = this.skillOperation !== undefined;
    this.skillsLoadRequestSeq += 1;
    this.skillsMutationSeq += 1;
    this.skillsLoading = false;
    this.skillOperation = undefined;
    this.skillsMessage = "";
    this.skillsError = "";
    this.skillsResponse = undefined;
    if (hadSkillOperation) this.saving = false;
  }

  private resetMcpStateForTargetChange(): void {
    this.resetMcpScopeState();
    this.mcpProjectsLoadSeq += 1;
    this.mcpProjects = [];
    this.mcpProjectsLoading = true;
    this.mcpProjectsError = "";
    this.mcpProjectSelection = this.mcpProjectSelections.get(this.settingsTarget().id);
  }

  /** The rows, messages and in-flight work of the Skills scope the reader is leaving. */
  private resetSkillsScopeState(): void {
    const hadSkillOperation = this.skillOperation !== undefined;
    this.skillsLoadRequestSeq += 1;
    this.skillsMutationSeq += 1;
    this.skillsLoading = false;
    this.skillOperation = undefined;
    this.skillsMessage = "";
    this.skillsError = "";
    this.skillsResponse = undefined;
    if (hadSkillOperation) this.saving = false;
  }

  /** The rows, messages and in-flight work of the MCP scope the reader is leaving. */
  private resetMcpScopeState(): void {
    const hadMcpOperation = this.mcpOperation !== undefined;
    this.mcpLoadRequestSeq += 1;
    this.mcpMutationSeq += 1;
    this.mcpLoading = false;
    this.mcpOperation = undefined;
    this.mcpMessage = "";
    this.mcpError = "";
    this.mcpResponse = undefined;
    if (hadMcpOperation) this.saving = false;
  }

  private showSavedMessage(): void {
    this.savedMessage = "Config saved.";
    if (this.savedMessageTimer !== undefined) window.clearTimeout(this.savedMessageTimer);
    this.savedMessageTimer = window.setTimeout(() => {
      if (this.savedMessage === "Config saved.") this.savedMessage = "";
      this.savedMessageTimer = undefined;
    }, 3000);
  }

  static override styles = [css`${unsafeCSS(uiIconStyle)}`, css`${unsafeCSS(disclosureIconStyle)}`, interactiveSurfaceStyles, pageScrollerStyles, css`
    :host { position: fixed; inset: 0; z-index: var(--pi-layer-dialog); color: var(--pi-text); font: var(--pi-text-base) var(--pi-font-ui, system-ui, sans-serif); line-height: inherit; }
    modal-surface { --modal-surface-backdrop-padding: max(var(--pi-space-8), env(safe-area-inset-top)) max(var(--pi-space-8), env(safe-area-inset-right)) max(var(--pi-space-8), env(safe-area-inset-bottom)) max(var(--pi-space-8), env(safe-area-inset-left)); --modal-surface-width: min(980px, 100%); --modal-surface-max-height: min(760px, 100%); --modal-surface-min-height: min(620px, 100%); --modal-surface-radius: var(--pi-radius-lg); }
    .settings-header { display: flex; align-items: center; justify-content: space-between; gap: var(--pi-space-6); padding: var(--pi-space-7) var(--pi-space-7); border-bottom: 1px solid var(--pi-border); }
    .eyebrow { display: block; color: var(--pi-muted); font-size: var(--pi-text-xs); font-weight: var(--pi-weight-semibold); }
    h1 { margin: 0; font-size: var(--pi-text-xl); line-height: 1.2; }
    button { border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text); padding: var(--pi-space-4) var(--pi-space-5); font: inherit; cursor: pointer; }
    .settings-body { flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: 220px minmax(0, 1fr); }
    .settings-search { padding: 0 0 var(--pi-space-4); }
    .settings-search-input { box-sizing: border-box; width: 100%; min-height: var(--pi-control-height-comfort); padding: 0 var(--pi-space-4); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-bg); color: var(--pi-text); font: inherit; }
    @media (pointer: coarse) { .settings-search-input { min-height: var(--pi-control-height-touch); } }
    .settings-no-match { margin: var(--pi-space-4) 0; color: var(--pi-muted); font-size: var(--pi-text-xs); }
    .settings-nav { min-height: 0; padding: var(--pi-space-5); border-right: 1px solid var(--pi-border); background: var(--pi-surface); overflow: auto; }
    .settings-nav button { display: grid; gap: var(--pi-space-1); box-sizing: border-box; width: 100%; margin: 0 0 var(--pi-space-3); text-align: left; border-color: transparent; background: transparent; }
    .settings-nav button:focus { background: var(--pi-surface-hover); }
    @media (hover: hover) { .settings-nav button:hover { background: var(--pi-surface-hover); } }
    .settings-nav button.selected { border-color: var(--pi-accent); background: var(--pi-selection-bg); }
    .settings-nav small { font-size: var(--pi-text-xs); color: var(--pi-muted); }
    .settings-content { min-width: 0; min-height: 0; overflow: auto; padding: var(--pi-space-8); }

    @media ${unsafeCSS(PHONE_LAYOUT_MEDIA_QUERY)} {
      modal-surface { --modal-surface-backdrop-padding: 0; --modal-surface-place-items: stretch; --modal-surface-width: 100%; --modal-surface-max-height: none; --modal-surface-min-height: 0; --modal-surface-border: 0; --modal-surface-radius: 0; }
      .settings-header { box-sizing: border-box; min-height: var(--pi-panel-header-height); padding: 0 max(var(--pi-chat-gutter), env(safe-area-inset-right)) 0 max(var(--pi-chat-gutter), env(safe-area-inset-left)); padding-top: max(0px, env(safe-area-inset-top)); }
      .settings-header-phone .panel-header-title { font-size: var(--pi-text-sm); font-weight: var(--pi-weight-semibold); }
      /* The same Back key as over a page opened from Go to, the name after it (owner, 2026-10-16:
         keep the UI one). */
      .settings-header-phone { justify-content: flex-start; }
      .settings-header-phone .close-button { margin-left: auto; }
      .settings-content { padding: var(--pi-space-5) var(--pi-reading-edge) calc(var(--pi-space-6) + env(safe-area-inset-bottom)); }
      .settings-body { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
      .settings-list { display: grid; gap: var(--pi-space-3); align-content: start; overflow-y: auto; padding: var(--pi-space-4) var(--pi-reading-edge) calc(var(--pi-space-6) + env(safe-area-inset-bottom)); }
      .settings-list button { font: inherit; box-sizing: border-box; display: flex; align-items: center; justify-content: space-between; gap: var(--pi-space-6); width: 100%; min-height: var(--pi-row-min-height); margin: 0; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-lg); background: var(--pi-surface); padding: var(--pi-space-3) var(--pi-space-5); text-align: start; }
      .settings-list-label { display: flex; flex-direction: column; gap: var(--pi-space-1); min-width: 0; }
      .settings-list-label strong { font-size: var(--pi-text-base); font-weight: var(--pi-weight-medium); color: var(--pi-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .settings-list-label small { font-size: var(--pi-text-xs); color: var(--pi-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .settings-list-chevron { display: inline-flex; color: var(--pi-muted); }
    }
  `, barKeyStyles];
}

export type SettingsPanelTag =
  | "settings-machines-panel"
  | "settings-general-panel"
  | "settings-packages-panel"
  | "settings-skills-panel"
  | "settings-mcp-panel"
  | "settings-plugins-panel"
  | "settings-appearance-panel"
  | "settings-notifications-panel"
  | "settings-shortcuts-panel"
  | "settings-plugin-section";

/**
 * The single custom-element panel the settings dialog renders for a section.
 *
 * This is the public routing contract behind `renderActiveSection`: each section
 * maps to exactly one panel element and nothing else (no per-tab "scope note"
 * wrapper). Tests assert this mapping instead of inspecting the rendered
 * `TemplateResult`'s markup.
 */
export function activeSettingsPanelTag(section: SettingsSection): SettingsPanelTag {
  if (isPluginSettingsSection(section)) return "settings-plugin-section";
  switch (section) {
    case "appearance":
      return "settings-appearance-panel";
    case "notifications":
      return "settings-notifications-panel";
    case "packages":
      return "settings-packages-panel";
    case "skills":
      return "settings-skills-panel";
    case "mcp":
      return "settings-mcp-panel";
    case "plugins":
      return "settings-plugins-panel";
    case "shortcuts":
      return "settings-shortcuts-panel";
    case "general":
      return "settings-general-panel";
    case "machines":
      return "settings-machines-panel";
  }
}
