import { LitElement, css, html, nothing, unsafeCSS, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { interactiveSurfaceStyles } from "../shared";
import { renderBranchIcon, renderGoalIcon, renderProjectIcon, renderTerminalIcon, uiIconStyle } from "../uiIcons";
import type { WorkbenchKind, WorkbenchTab } from "../../workspace/workbenchTabs";

/** The mark a tab wears when its panel brings none of its own. */
const FALLBACK_ICONS: Record<WorkbenchKind, () => TemplateResult> = {
  git: renderBranchIcon,
  files: renderProjectIcon,
  terminal: renderTerminalIcon,
  goals: renderGoalIcon,
};

/**
 * The workbench's one tab strip: Git, Files, Terminal, Goals.
 *
 * The strip is the panel's identity: it stays put while the content under it
 * changes, so the four tools are four tabs and never four pages with a way back.
 * Tabs are left-aligned and named by the panel under them; the active tab is a
 * raised pill in the interaction accent, which is the same mark the app uses
 * wherever a reader has chosen something.
 *
 * A tab whose panel is not registered is shown disabled with the reason in its
 * tooltip. Removing the tab would be the app telling the reader it has no Git
 * while its badge says it counted changes; the disabled tab is the honest state.
 */
@customElement("workbench-tab-bar")
export class WorkbenchTabBar extends LitElement {
  @property({ attribute: false }) tabs: readonly WorkbenchTab[] = [];
  /** Each panel's own icon, when it declares one. */
  @property({ attribute: false }) icons: Partial<Record<WorkbenchKind, TemplateResult>> = {};
  @property({ attribute: false }) onSelect?: (kind: WorkbenchKind) => void;

  override render() {
    return html`
      <nav class="tabs" role="tablist" aria-label="Workspace tools">
        ${this.tabs.map((tab) => html`
          <button type="button" role="tab" class="tab" data-selected=${tab.selected ? "true" : "false"}
            aria-selected=${tab.selected ? "true" : "false"} ?disabled=${tab.disabled}
            title=${tab.disabled ? tab.detail : `${tab.label} · ${tab.detail}`}
            @click=${() => this.onSelect?.(tab.kind)}>
            <span class="icon" aria-hidden="true">${this.icons[tab.kind] ?? FALLBACK_ICONS[tab.kind]()}</span>
            <span class="label">${tab.label}</span>
            ${tab.badge === undefined ? nothing : html`<span class="badge" title=${`${String(tab.badge)} changed files`}>${String(tab.badge)}</span>`}
          </button>`)}
      </nav>
    `;
  }

  static override styles = [
    interactiveSurfaceStyles,
    css`${unsafeCSS(uiIconStyle)}`,
    css`
      :host { display: block; flex: none; border-bottom: 1px solid var(--pi-border-muted); background: var(--pi-workbench-bg, var(--pi-surface-panel)); }
      .tabs { display: flex; align-items: center; gap: var(--pi-space-2); min-height: 54px; padding: 0 var(--pi-space-5); }
      .tab { box-sizing: border-box; min-width: 0; min-height: var(--pi-control-height-comfort); display: inline-flex; align-items: center; gap: var(--pi-space-3); padding: 0 var(--pi-space-4); border: 1px solid transparent; border-radius: var(--pi-radius-md); background: transparent; color: var(--pi-text-secondary); font: var(--pi-text-xs) var(--pi-font-ui); white-space: nowrap; cursor: pointer; }
@media (hover: hover) { .tab:hover:not(:disabled) { background: var(--pi-surface-hover); color: var(--pi-text); } }
      .tab[data-selected="true"] { background: var(--pi-accent-soft); border-color: var(--pi-accent-border); color: var(--pi-purple); font-weight: var(--pi-weight-semibold); }
      .tab:disabled { opacity: var(--pi-disabled-opacity); cursor: default; }
      .icon { display: inline-flex; }
      .icon .ui-icon { width: 15px; height: 15px; }
      .badge { display: inline-flex; align-items: center; justify-content: center; min-width: width: 18px; height: height: 18px; padding: 0 5px; border-radius: var(--pi-radius-pill); background: var(--pi-danger); color: color-mix(in srgb, var(--pi-danger) 12%, #100d14); font-size: var(--pi-text-2xs); font-weight: var(--pi-weight-semibold); font-variant-numeric: tabular-nums; line-height: 1; }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "workbench-tab-bar": WorkbenchTabBar;
  }
}
