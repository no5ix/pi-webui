import { css, html, LitElement, nothing, type TemplateResult } from "lit";
import { settingsControlStyles } from "./settingsControlStyles.js";
import { customElement, property } from "lit/decorators.js";
import { interactiveSurfaceStyles } from "../shared";

export const SETTINGS_NOTICE_TONES = ["error", "success", "warning", "info"] as const;
export type SettingsNoticeTone = (typeof SETTINGS_NOTICE_TONES)[number];

export const SETTINGS_NOTICE_TYPES = ["availability", "error", "success", "security", "warning", "info"] as const;
export type SettingsNoticeType = (typeof SETTINGS_NOTICE_TYPES)[number];

export type SettingsNoticeRole = "alert" | "note" | "status";
export type SettingsNoticeContent = string | TemplateResult;

export interface SettingsNotice {
  readonly type: SettingsNoticeType;
  readonly content: SettingsNoticeContent;
  readonly tone?: SettingsNoticeTone;
  readonly title?: string;
  readonly role?: SettingsNoticeRole;
}

const DEFAULT_NOTICE_TONE: Record<SettingsNoticeType, SettingsNoticeTone> = {
  availability: "error",
  error: "error",
  success: "success",
  security: "warning",
  warning: "warning",
  info: "info",
};

export function settingsNoticeTone(notice: SettingsNotice): SettingsNoticeTone {
  return notice.tone ?? DEFAULT_NOTICE_TONE[notice.type];
}

@customElement("settings-panel-frame")
export class SettingsPanelFrame extends LitElement {
  @property() heading = "";
  @property({ attribute: false }) description: SettingsNoticeContent = "";
  @property() actionLabel = "";
  @property() actionTitle = "";
  @property({ type: Boolean }) actionDisabled = false;
  @property({ attribute: false }) notices: readonly SettingsNotice[] = [];
  @property({ attribute: false }) onAction?: () => void | Promise<void>;

  override render(): TemplateResult {
    return html`
      <section class="panel" aria-label=${this.heading || "Settings panel"}>
        <header class="section-heading">
          <div class="title-row">
            ${this.heading === "" ? html`<span></span>` : html`<h2>${this.heading}</h2>`}
            <div class="heading-actions"><slot name="actions">${this.renderDefaultAction()}</slot></div>
          </div>
          <div class="description unframed"><slot name="description">${this.description}</slot></div>
        </header>
        ${this.renderNoticeStack()}
        <div class="content"><slot></slot></div>
      </section>
    `;
  }

  private renderDefaultAction(): TemplateResult | typeof nothing {
    if (this.actionLabel === "") return nothing;
    return html`
      <button
        class="secondary"
        title=${this.actionTitle || this.actionLabel}
        ?disabled=${this.actionDisabled}
        @click=${() => { void this.onAction?.(); }}
      >${this.actionLabel}</button>
    `;
  }

  private renderNoticeStack(): TemplateResult | typeof nothing {
    if (this.notices.length === 0) return nothing;
    return html`
      <div class="notice-stack" aria-label="Settings notices">
        ${this.notices.map((notice) => this.renderNotice(notice))}
      </div>
    `;
  }

  private renderNotice(notice: SettingsNotice): TemplateResult {
    const tone = settingsNoticeTone(notice);
    const role = notice.role ?? defaultNoticeRole(tone);
    const title = notice.title;
    return html`
      <article class=${`notice ${tone}`} role=${role}>
        ${title === undefined || title === "" ? nothing : html`<strong class="notice-title">${title}</strong>`}
        <div class="notice-content">${notice.content}</div>
      </article>
    `;
  }

  static override styles = [interactiveSurfaceStyles, settingsControlStyles, css`
    :host { display: block; }
    .panel { display: block; }
    /* One edge for frames, one for words (owner, 2026-10-16: the page read as going in and out).
       Every framed thing - a card, a notice, the page's own key - spans to the cards' border; every
       unframed word stands on the cards' inner edge. So the title starts on that inner edge and the
       page's key ends on the cards' right border, on the title's row at every width. */
    .section-heading { display: grid; gap: var(--pi-space-3); margin-bottom: var(--pi-space-7); }
    .title-row { display: flex; align-items: center; justify-content: space-between; gap: var(--pi-space-6); min-height: var(--pi-control-height); padding-left: var(--pi-settings-inner-edge); }
    .heading-actions { flex: 0 0 auto; display: flex; align-items: center; gap: var(--pi-space-4); }
    h2 { margin: 0; color: var(--pi-text-bright); font-family: var(--pi-font-display); font-size: var(--pi-text-xl); font-weight: var(--pi-weight-strong); letter-spacing: var(--pi-tracking-tight); line-height: var(--pi-leading-tight); }
    .description { color: var(--pi-muted); font-size: var(--pi-text-sm); line-height: var(--pi-leading-normal); }
    .description ::slotted(*) { margin: 0; }
    button { border: 1px solid var(--pi-chip-border); border-radius: var(--pi-radius-md); background: var(--pi-chip-bg); color: var(--pi-text); padding: var(--pi-space-4) var(--pi-space-5); font: inherit; cursor: pointer; }
    @media (hover: hover) { button:hover:not(:disabled) { background: var(--pi-row-hover); border-color: var(--pi-accent); } }
    button:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-focus-ring); outline-offset: var(--pi-focus-ring-offset); }
    /* A panel states its one primary action as an accent fill; everything else in
       the panel is a chip beside it. */
    .primary { border-color: var(--pi-accent); background: var(--pi-accent); color: var(--pi-on-accent); font-weight: var(--pi-weight-strong); }
    @media (hover: hover) { .primary:hover:not(:disabled) { border-color: var(--pi-accent); background: color-mix(in srgb, var(--pi-accent) 88%, var(--pi-text)); color: var(--pi-on-accent); } }
    button:disabled { opacity: var(--pi-disabled-opacity); cursor: not-allowed; }
    .secondary { flex: 0 0 auto; }
    .notice-stack { display: grid; gap: var(--pi-space-6); margin-bottom: var(--pi-space-7); }
    /* A notice is a rail, a surface and words - not a card with a card inside
       it. The rail is what says which kind of news this is. */
    .notice { display: grid; gap: var(--pi-space-2); border: 0; border-inline-start: var(--pi-rail-width) solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-chip-bg); padding: var(--pi-space-5); line-height: var(--pi-leading-normal); }
    .notice.error { border-inline-start-color: var(--pi-danger); color: var(--pi-danger); background: color-mix(in srgb, var(--pi-danger) 8%, var(--pi-surface)); }
    .notice.success { border-inline-start-color: var(--pi-success); color: var(--pi-success); background: var(--pi-success-surface); }
    .notice.warning { border-inline-start-color: var(--pi-warning); color: var(--pi-text); background: var(--pi-warning-surface); }
    .notice.info { color: var(--pi-muted); }
    .notice-title { display: block; margin-bottom: var(--pi-space-2); color: inherit; }
    .notice-content { min-width: 0; }
    .content { display: grid; gap: var(--pi-space-6); min-width: 0; }
    .content ::slotted(*) { min-width: 0; }

  `];
}

function defaultNoticeRole(tone: SettingsNoticeTone): SettingsNoticeRole {
  switch (tone) {
    case "error": return "alert";
    case "success": return "status";
    case "warning":
    case "info": return "note";
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "settings-panel-frame": SettingsPanelFrame;
  }
}
