import { css, html, LitElement, nothing, type TemplateResult } from "lit";
import { settingsControlStyles } from "./settingsControlStyles.js";
import { customElement, property } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import type { PiSkillInfo, PiSkillsResponse } from "../../api";
import "./SettingsPanelFrame";
import type { SettingsNotice } from "./SettingsPanelFrame";
import {
  isPiSkillTogglePending,
  piSkillEffectiveLabel,
  piSkillEmptyScopeNote,
  piSkillOffReasonNote,
  piSkillOriginLabel,
  piSkillPreferenceLabel,
  piSkillProjectScopeNote,
  piSkillScopeGroups,
  piSkillScopeLabel,
  piSkillShadowedNote,
  piSkillValidationNote,
  type PiSkillOperationState,
} from "./piSkillSettings";
import { settingsMachineTarget, settingsMachineTargetLabel, type SettingsMachineTarget } from "./settingsMachineTarget";
import { interactiveSurfaceStyles } from "../shared";

/**
 * Skills as this machine's Pi install has them.
 *
 * The panel draws what the response says and nothing else: a scope it did not read is named as not
 * read, a skill kept out of the list by its package says which package, and a preference is shown
 * beside what Pi actually loaded, because those are two facts and a switch answers only the second.
 */
@customElement("settings-skills-panel")
export class SettingsSkillsPanel extends LitElement {
  @property({ attribute: false }) skillsResponse: PiSkillsResponse | undefined;
  @property({ attribute: false }) targetMachine: SettingsMachineTarget | undefined;
  @property({ type: Boolean }) loading = false;
  @property({ attribute: false }) operation: PiSkillOperationState | undefined;
  @property() error = "";
  @property() operationMessage = "";
  @property({ attribute: false }) onReload?: () => void | Promise<void>;
  /** The row's own scope travels with the request: a browser never names a path. */
  @property({ attribute: false }) onToggleSkill?: (skill: PiSkillInfo, enabled: boolean) => void | Promise<void>;

  override render(): TemplateResult {
    const target = this.panelTarget;
    const targetLabel = settingsMachineTargetLabel(target);
    return html`
      <settings-panel-frame
        heading="Skills"
        .description=${skillsDescription(targetLabel)}
        actionLabel="Reload"
        actionTitle=${`Reload skills from ${targetLabel}`}
        .actionDisabled=${this.loading || this.isOperating}
        .notices=${this.panelNotices()}
        .onAction=${this.onReload}
      >
        ${this.renderPanelContent(targetLabel)}
      </settings-panel-frame>
    `;
  }

  private panelNotices(): readonly SettingsNotice[] {
    const notices: SettingsNotice[] = [];
    if (this.error !== "") notices.push({ type: "error", content: this.error });
    if (this.operationMessage !== "") notices.push({ type: "success", content: this.operationMessage });
    if (this.skillsResponse !== undefined) {
      notices.push({
        type: "info",
        content: "A switch saves PI WEB's preference for one skill name and rewrites the list Pi is given. A running session keeps the skills it loaded: type /reload to load the new list.",
      });
    }
    for (const diagnostic of this.skillsResponse?.diagnostics ?? []) {
      notices.push({ type: "warning", title: "Skill diagnostic", content: diagnostic.path === undefined ? diagnostic.message : `${diagnostic.message} (${diagnostic.path})` });
    }
    for (const unreadable of this.skillsResponse?.unreadablePaths ?? []) {
      notices.push({ type: "warning", title: "Skill path not readable", content: unreadable.path === undefined ? unreadable.message : `${unreadable.message} (${unreadable.path})` });
    }
    return notices;
  }

  private renderPanelContent(targetLabel: string): TemplateResult {
    const response = this.skillsResponse;
    if (response === undefined) {
      return html`<div class="loading-card">${this.loading ? `Loading skills from ${targetLabel}…` : `Skill list not loaded yet for ${targetLabel} · trying again…`}</div>`;
    }
    const groups = piSkillScopeGroups(response.skills, response.scopes);
    return html`
      <div class="scope-note">${piSkillProjectScopeNote(response.scopes)}</div>
      ${groups.map((group) => this.renderScopeGroup(group, targetLabel))}
    `;
  }

  private renderScopeGroup(group: ReturnType<typeof piSkillScopeGroups>[number], targetLabel: string): TemplateResult {
    const scopeInfo = group.scopeInfo;
    return html`
      <section class="section-card scope-section" aria-label=${`${piSkillScopeLabel(group.scope)} skills`}>
        <div class="scope-heading">
          <h3>${piSkillScopeLabel(group.scope)} skills</h3>
          <small>On ${targetLabel}.</small>
          ${scopeInfo === undefined
            ? html`<small class="diagnostic">This scope was not read, so its list is not known.</small>`
            : html`
                ${scopeInfo.skillsDir === "" ? nothing : html`<small>Skills directory: <code>${scopeInfo.skillsDir}</code></small>`}
                <small>Saved preference: <code>${scopeInfo.configPath}</code></small>
              `}
        </div>
        ${this.renderScopeRows(group)}
      </section>
    `;
  }

  private renderScopeRows(group: ReturnType<typeof piSkillScopeGroups>[number]): TemplateResult {
    const scopeInfo = group.scopeInfo;
    if (scopeInfo?.projectTrusted === false) {
      return html`<p class="section-note">Project skills are not read: ${scopeInfo.projectPath ?? "this project"} is not trusted, so Pi loads none of them.</p>`;
    }
    if (group.skills.length === 0) {
      return html`<p class="section-note">${piSkillEmptyScopeNote(group.scope, scopeInfo, this.skillsResponse?.unreadablePaths)}</p>`;
    }
    return html`
      <div class="skill-list">
        ${group.skills.map((skill) => this.renderSkill(skill))}
      </div>
    `;
  }

  private renderSkill(skill: PiSkillInfo): TemplateResult {
    const offReason = piSkillOffReasonNote(skill);
    const shadowed = piSkillShadowedNote(skill);
    const validation = piSkillValidationNote(skill);
    const pending = isPiSkillTogglePending(this.operation, skill);
    return html`
      <article class=${`skill-card${skill.enabled ? "" : " off"}`}>
        <div class="skill-main">
          <strong>${skill.name}</strong>
          <small>${skill.description}</small>
          <small>${piSkillOriginLabel(skill.origin)} · ${piSkillScopeLabel(skill.scope)} · Pi source: <code>${skill.source}</code></small>
          <small>Skill file: <code>${skill.filePath}</code></small>
          <small>Base directory: <code>${skill.baseDir}</code></small>
          <small>${piSkillPreferenceLabel(skill.preference)} · ${piSkillEffectiveLabel(skill.enabled)}</small>
          ${skill.packageSource === undefined ? nothing : html`<small>Supplied by Pi package: <code>${skill.packageSource}</code></small>`}
          ${offReason === undefined ? nothing : html`<small class="diagnostic">${offReason}</small>`}
          ${shadowed === undefined ? nothing : html`<small class="diagnostic">${shadowed}</small>`}
          ${validation === undefined ? nothing : html`<small class="diagnostic">${validation}</small>`}
          ${skill.disableModelInvocation === true ? html`<small class="diagnostic">This skill asks Pi to keep it out of the model's skill list.</small>` : nothing}
        </div>
        <label class="toggle">
          <input
            type="checkbox"
            aria-label=${`${piSkillScopeLabel(skill.scope)} skill ${skill.name}`}
            .checked=${live(skill.enabled)}
            ?disabled=${this.isOperating}
            @change=${(event: Event) => { void this.toggleSkill(skill, event); }}
          >
          <span>${pending ? "Saving…" : skill.enabled ? "On" : "Off"}</span>
        </label>
      </article>
    `;
  }

  private async toggleSkill(skill: PiSkillInfo, event: Event): Promise<void> {
    const enabled = event.target instanceof HTMLInputElement ? event.target.checked : skill.enabled;
    await this.onToggleSkill?.(skill, enabled);
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
    .loading-card, .skill-card { border: 1px solid var(--pi-border); border-radius: var(--pi-radius-lg); background: var(--pi-surface); padding: var(--pi-space-6); }
    .loading-card, .scope-note, .section-note { color: var(--pi-muted); }
    .scope-note { font-size: var(--pi-text-xs); }
    .scope-section { display: grid; gap: var(--pi-space-5); }
    .scope-heading { display: grid; gap: var(--pi-space-2); }
    .skill-list { display: grid; gap: var(--pi-space-5); }
    .skill-card { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--pi-space-6); align-items: center; }
    .skill-card.off { opacity: .82; }
    .skill-main { min-width: 0; display: grid; gap: var(--pi-space-2); }
    .skill-main > strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .skill-main small, .scope-heading small { overflow-wrap: anywhere; }
    .diagnostic { color: var(--pi-text); }
    .toggle { display: inline-flex; align-items: center; gap: var(--pi-space-4); white-space: nowrap; }
    .toggle input { box-sizing: border-box; width: var(--pi-checkbox-size); height: var(--pi-checkbox-size); accent-color: var(--pi-accent); }

    @media (max-width: 760px) {
      .skill-card { grid-template-columns: minmax(0, 1fr); align-items: start; }
      .toggle { justify-self: start; }
      .skill-main > strong { white-space: normal; }
    }
  `];
}

function skillsDescription(targetLabel: string): TemplateResult {
  return html`Turn the skills Pi finds on <strong>${targetLabel}</strong> on or off, and see where each one came from: a Pi skill folder, a Pi package, or a configured path. This writes PI WEB's saved preference for a skill name; it never moves or deletes a skill file.`;
}
