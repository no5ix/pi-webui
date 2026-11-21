import { useId, useState, type ReactNode } from "react";
import type { Project } from "../../api";

/**
 * The presentation primitives the Pi Packages, Skills and MCP Servers panels are built from.
 *
 * The three surfaces share a shape - a section with a heading and its actions, a card that names a
 * thing and lists what it is, a notice that reports the result of an operation, a scope selector that
 * says which machine or project the panel is about to write to - and they must say those things in the
 * same words and the same places, because a reader moving between them is reading one settings dialog.
 * Structure lives here; the product meaning of a line stays in the pure model of each feature.
 */

export type SettingsNoticeTone = "info" | "success" | "warning" | "danger" | "security";

const noticeRoles: Record<SettingsNoticeTone, "status" | "alert"> = {
  info: "status",
  success: "status",
  warning: "status",
  danger: "alert",
  security: "status",
};

export function SettingsNotice({ tone = "info", children }: { tone?: SettingsNoticeTone; children: ReactNode }) {
  return <p className={`rw-settings-note rw-settings-note-${tone}`} role={noticeRoles[tone]}>{children}</p>;
}

/**
 * A labelled settings control with the note that belongs to it.
 *
 * `wide` spans the MCP form grid. The note sits inside the label, not beside it, because the sentence
 * explains this control and a screen reader reaches it while the control has focus.
 */
export function SettingsField({ label, children, note, wide = false }: { label: string; children: ReactNode; note?: ReactNode; wide?: boolean }) {
  return <label className={wide ? "rw-settings-field rw-mcp-form-wide" : "rw-settings-field"}>
    <span>{label}</span>
    {children}
    {note === undefined ? null : <small>{note}</small>}
  </label>;
}

export function SettingsEmpty({ children }: { children: ReactNode }) {
  return <p className="rw-settings-empty" role="status">{children}</p>;
}

export interface SettingsSectionProps {
  readonly title: string;
  readonly note?: ReactNode;
  readonly actions?: ReactNode;
  readonly children?: ReactNode;
}

export function SettingsSection({ title, note, actions, children }: SettingsSectionProps) {
  return <section className="rw-settings-section">
    <header className="rw-settings-section-head">
      <div>
        <h4>{title}</h4>
        {note === undefined ? null : <small>{note}</small>}
      </div>
      {actions === undefined ? null : <div className="rw-settings-section-actions">{actions}</div>}
    </header>
    {children}
  </section>;
}

export interface SettingsCardProps {
  readonly title: string;
  readonly meta?: readonly ReactNode[];
  readonly diagnostics?: readonly ReactNode[];
  readonly status?: ReactNode;
  readonly statusTone?: "on" | "off" | "warning" | "neutral";
  readonly actions?: ReactNode;
  readonly off?: boolean;
  readonly testId?: string;
}

export function SettingsCard({ title, meta = [], diagnostics = [], status, statusTone = "neutral", actions, off = false, testId }: SettingsCardProps) {
  const details = meta.filter((entry) => entry !== undefined && entry !== null && entry !== "");
  const problems = diagnostics.filter((entry) => entry !== undefined && entry !== null && entry !== "");
  return <article className={`rw-settings-card${off ? " rw-settings-card-off" : ""}`} data-test-id={testId}>
    <div className="rw-settings-card-main">
      <strong>{title}</strong>
      {status === undefined ? null : <span className={`rw-settings-card-status is-${statusTone}`}>{status}</span>}
      {details.map((entry, index) => <small key={index}>{entry}</small>)}
      {problems.map((entry, index) => <small className="rw-settings-card-diagnostic" key={index}>{entry}</small>)}
    </div>
    {actions === undefined ? null : <div className="rw-settings-card-actions">{actions}</div>}
  </article>;
}

/** The project the Skills and MCP panels manage, and the projects this machine has to choose from. */
export interface SettingsProjectScope {
  readonly projects: readonly Project[];
  readonly projectId: string | undefined;
  readonly projectsError?: string;
  readonly projectsLoading?: boolean;
  readonly onSelect: (projectId: string | undefined) => void;
}

export interface SettingsProjectSelectProps {
  readonly scope: SettingsProjectScope;
  readonly label?: string;
  readonly note?: ReactNode;
  readonly disabled?: boolean;
}

export function SettingsProjectSelect({ scope, label = "Project scope", note, disabled = false }: SettingsProjectSelectProps) {
  const id = useId();
  return <div className="rw-settings-scope">
    <label htmlFor={id}>{label}</label>
    <select
      id={id}
      value={scope.projectId ?? ""}
      disabled={disabled || scope.projectsLoading === true}
      onChange={event => scope.onSelect(event.target.value === "" ? undefined : event.target.value)}
    >
      <option value="">No project: this machine's global settings only</option>
      {scope.projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
    </select>
    {note === undefined ? null : <small>{note}</small>}
  </div>;
}

export interface SettingsToggleProps {
  readonly label: string;
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly pending?: boolean;
  readonly title?: string;
  readonly onChange: (checked: boolean) => void;
}

export function SettingsToggle({ label, checked, disabled = false, pending = false, title, onChange }: SettingsToggleProps) {
  return <label className="rw-settings-toggle" title={title}>
    <input type="checkbox" aria-label={label} checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)}/>
    <span>{pending ? "Saving…" : checked ? "On" : "Off"}</span>
  </label>;
}

export interface SettingsConfirmActionProps {
  readonly label: string;
  readonly question: string;
  readonly confirmLabel?: string;
  readonly title?: string;
  readonly disabled?: boolean;
  readonly pending?: boolean;
  readonly onConfirm: () => void;
}

/**
 * A destructive control asked for in two presses.
 *
 * The first press names the file the entry will be taken out of, because a removal that answers
 * immediately tells the reader where the write went only after it has happened.
 */
export function SettingsConfirmAction({ label, question, confirmLabel = "Confirm remove", title, disabled = false, pending = false, onConfirm }: SettingsConfirmActionProps) {
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return <button type="button" className="rw-button-danger" title={title ?? question} disabled={disabled} onClick={() => setArmed(true)}>
      {pending ? `${label}…` : label}
    </button>;
  }
  return <span className="rw-settings-confirm" role="group" aria-label={`Confirm ${label.toLowerCase()}`}>
    <small>{question}</small>
    <button type="button" className="rw-button-danger" disabled={disabled} onClick={() => { setArmed(false); onConfirm(); }}>{pending ? `${confirmLabel}…` : confirmLabel}</button>
    <button type="button" className="rw-button-secondary" disabled={disabled} onClick={() => setArmed(false)}>Cancel</button>
  </span>;
}

export interface SettingsButtonProps {
  readonly label: string;
  readonly onClick?: () => void;
  readonly disabled?: boolean;
  readonly pending?: boolean;
  readonly title?: string;
  readonly tone?: "primary" | "secondary" | "danger";
  readonly type?: "button" | "submit";
}

export function SettingsButton({ label, onClick, disabled = false, pending = false, title, tone = "secondary", type = "button" }: SettingsButtonProps) {
  return <button
    type={type}
    className={tone === "primary" ? "rw-button-primary" : tone === "danger" ? "rw-button-danger" : "rw-button-secondary"}
    title={title}
    disabled={disabled}
    onClick={onClick}
  >{pending ? `${label}…` : label}</button>;
}

export interface NoticeListProps {
  readonly busy?: string | undefined;
  readonly notice?: readonly (string | undefined)[] | undefined;
  readonly error?: readonly (string | undefined)[] | undefined;
}

/**
 * The page's notices: what is running, what happened, what failed.
 *
 * A notice is kept by the panel that asked, because only that panel knows which row was pressed and
 * what the answer said, while the shell's notice carries the scope read it is answering for. An error
 * is announced (`role="alert"`) and never shown as a success, and a notice list is rendered in the order
 * a reader needs it: a failure first, then the running work, then what finished.
 */
export function NoticeList({ busy, notice, error }: NoticeListProps) {
  const failures = (error ?? []).filter((entry): entry is string => entry !== undefined && entry.trim().length > 0);
  const successes = (notice ?? []).filter((entry): entry is string => entry !== undefined && entry.trim().length > 0);
  if (failures.length === 0 && busy === undefined && successes.length === 0) return null;
  return <div className="rw-settings-notices">
    {failures.map((entry, index) => <p className="rw-settings-notice is-danger" key={`error-${String(index)}`} role="alert">{entry}</p>)}
    {busy === undefined ? null : <p className="rw-settings-notice is-info" role="status">{busy}…</p>}
    {successes.map((entry, index) => <p className="rw-settings-notice is-success" key={`notice-${String(index)}`} role="status">{entry}</p>)}
  </div>;
}
