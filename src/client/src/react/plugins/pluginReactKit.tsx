import { useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import {
  SettingsButton,
  SettingsCard,
  SettingsEmpty,
  SettingsField,
  SettingsNotice,
  SettingsSection,
  SettingsToggle,
} from "../settings/SettingsKit";
import { Icon } from "../icons";
import { asReactNode } from "./pluginReactNode";
import type { PluginReactNode } from "../../../../shared/pluginReactTypes";
import type {
  PluginReactButtonProps,
  PluginReactCardProps,
  PluginReactEmptyProps,
  PluginReactExpandableRowProps,
  PluginReactFieldProps,
  PluginReactMessageFieldProps,
  PluginReactNoticeProps,
  PluginReactOutputProps,
  PluginReactSectionProps,
  PluginReactToggleProps,
} from "../../../../plugin-api";

/**
 * The React components a plugin composes its interface from.
 *
 * Each of these is a decision this project has already paid for. The buttons carry the press feedback
 * that keeps a tapped surface from flashing and the label a reader hears; the cards keep the height, the
 * meta line and the status wording the built-in panels use; the notice is the one that reaches a screen
 * reader. A plugin that redraws them drifts from the built-in surfaces the moment either side changes,
 * so the host owns them and hands them out.
 *
 * They are plain function components over the host's own stylesheet — no shadow root, no second design
 * system — which is what lets a plugin's panel and PI WEB's own panels sit in one layout and follow the
 * theme the reader chose.
 */
export function PluginReactButton({ label, onClick, disabled = false, pending = false, tone = "secondary", title, type = "button", testId }: PluginReactButtonProps) {
  return (
    <span className="plugin-react-button" {...(testId === undefined ? {} : { "data-test-id": testId })}>
      <SettingsButton label={label} onClick={onClick} disabled={disabled} pending={pending} tone={tone} type={type} {...(title === undefined ? {} : { title })} />
    </span>
  );
}

export function PluginReactToggle({ label, checked, onChange, disabled = false, pending = false, title }: PluginReactToggleProps) {
  return <SettingsToggle label={label} checked={checked} onChange={onChange} disabled={disabled} pending={pending} {...(title === undefined ? {} : { title })} />;
}

export function PluginReactSection({ title, note, count, actions, children }: PluginReactSectionProps) {
  const heading = count === undefined ? title : `${title} (${String(count)})`;
  return <SettingsSection title={heading} note={note} actions={node(actions, "Section.actions")}>{node(children, "Section.children")}</SettingsSection>;
}

export function PluginReactCard({ title, meta, diagnostics, status, statusTone, off = false, actions, children, testId }: PluginReactCardProps) {
  const tone = statusTone ?? "neutral";
  // The host's card is a row: a title, a status, a meta line, actions. A plugin's body goes under it,
  // in the same block, because a plugin's panel is allowed to be taller than a settings row.
  return (
    <>
      <SettingsCard title={title} {...(meta === undefined ? {} : { meta })} {...(diagnostics === undefined ? {} : { diagnostics })} {...(status === undefined ? {} : { status })} statusTone={tone} off={off} actions={node(actions, "Card.actions")} {...(testId === undefined ? {} : { testId })} />
      {children === undefined ? null : <div className="plugin-react-card-body">{node(children, "Card.children")}</div>}
    </>
  );
}

export function PluginReactEmpty({ children }: PluginReactEmptyProps) {
  return <SettingsEmpty>{node(children, "Empty.children")}</SettingsEmpty>;
}

export function PluginReactNotice({ tone = "info", children }: PluginReactNoticeProps) {
  return <SettingsNotice tone={tone}>{node(children, "Notice.children")}</SettingsNotice>;
}

export function PluginReactField({ label, note, wide = false, children }: PluginReactFieldProps) {
  return <SettingsField label={label} note={note} wide={wide}>{node(children, "Field.children")}</SettingsField>;
}

/** Monospace text a plugin read from a machine, in its own scrolling view. */
export function PluginReactOutput({ text, title, empty = "Nothing to show." }: PluginReactOutputProps) {
  const trimmed = text.trim();
  return (
    <>
      <style>{PLUGIN_REACT_STYLES}</style>
      <pre className="plugin-react-output" {...(title === undefined ? {} : { "aria-label": title })} tabIndex={0}>
        {trimmed === "" ? empty : text}
      </pre>
    </>
  );
}

/**
 * A prompt a plugin sends: Enter sends, Shift+Enter is a newline, and the same Send key answers both.
 * That is the composer's rule, and a plugin's field that broke it would train the reader to type the
 * wrong key in the wrong panel.
 */
export function PluginReactMessageField({ value, onChange, onSend, placeholder = "Message", disabled = false, title }: PluginReactMessageFieldProps) {
  const [busy, setBusy] = useState(false);

  const send = () => {
    const text = value.trim();
    if (text === "" || busy) return;
    setBusy(true);
    void Promise.resolve(onSend(text)).finally(() => setBusy(false));
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    send();
  };

  const keys = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  };

  return (
    <form className="plugin-react-message-field" onSubmit={submit}>
      <style>{PLUGIN_REACT_STYLES}</style>
      <textarea
        className="plugin-react-message-input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={keys}
        placeholder={placeholder}
        rows={2}
        disabled={disabled || busy}
        {...(title === undefined ? {} : { "aria-label": title })}
      />
      <SettingsButton label="Send" type="submit" tone="primary" disabled={disabled || busy || value.trim() === ""} pending={busy} />
    </form>
  );
}

export function PluginReactExpandableRow({ title, expanded, onToggle, meta = [], children }: PluginReactExpandableRowProps) {
  return (
    <div className="plugin-react-expandable">
      <style>{PLUGIN_REACT_STYLES}</style>
      <button type="button" className="plugin-react-expandable-head pressable" onClick={onToggle} aria-expanded={expanded}>
        <PluginReactDisclosureIcon collapsed={!expanded} />
        <span className="plugin-react-expandable-title">{title}</span>
        {meta.length === 0 ? null : <span className="plugin-react-expandable-meta">{meta.join(" · ")}</span>}
      </button>
      {expanded ? <div className="plugin-react-expandable-body">{node(children, "ExpandableRow.children")}</div> : null}
    </div>
  );
}

export function PluginReactDisclosureIcon({ collapsed }: { readonly collapsed: boolean }) {
  return <Icon name={collapsed ? "chevron-right" : "chevron-down"} className="plugin-react-disclosure" width={14} height={14} />;
}

export function PluginReactCloseIcon() {
  return <Icon name="close" width={14} height={14} />;
}

/** A contributed node, at the point a host component hands it to React. */
function node(value: PluginReactNode | undefined, contributionId: string): ReactNode {
  return asReactNode(value, contributionId);
}

const PLUGIN_REACT_STYLES = `
.plugin-react-output { margin: 0.5rem 0 0; padding: 0.5rem 0.625rem; max-height: 18rem; overflow: auto; border: 1px solid var(--line, #2a2f3a); border-radius: 6px; background: var(--surface-sunken, #14171d); color: var(--text, #e8ebf0); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.78rem; white-space: pre-wrap; word-break: break-word; }
.plugin-react-message-field { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 0.5rem; align-items: end; margin-top: 0.5rem; }
.plugin-react-message-input { width: 100%; min-height: 2.5rem; padding: 0.4rem 0.5rem; border: 1px solid var(--line, #2a2f3a); border-radius: 6px; background: var(--surface, #1b1f27); color: inherit; font: inherit; resize: vertical; }
.plugin-react-expandable { border-top: 1px solid var(--line, #2a2f3a); }
.plugin-react-expandable-head { display: flex; align-items: center; gap: 0.4rem; width: 100%; min-height: 2.25rem; padding: 0.25rem 0.375rem; border: 0; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.plugin-react-expandable-title { font-weight: 600; }
.plugin-react-expandable-meta { color: var(--text-dim, #9aa4b2); font-size: 0.78rem; }
.plugin-react-expandable-body { padding: 0 0.5rem 0.5rem; }
.plugin-react-card-body { padding: 0 0 0.5rem; }
.plugin-react-failure { margin: 0.5rem 0; padding: 0.5rem 0.625rem; border-left: 3px solid var(--danger, #d9534f); background: var(--surface-sunken, #14171d); color: var(--text, #e8ebf0); font-size: 0.82rem; }
`;

