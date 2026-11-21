import { useEffect, useRef, useState } from "react";

export interface WorkspaceUnsavedDialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly description: string;
  readonly saveLabel: string;
  readonly busy?: boolean | undefined;
  readonly error?: string | undefined;
  readonly onSave: () => void;
  readonly onDiscard: () => void;
  readonly onCancel: () => void;
}

/**
 * The save/discard/cancel choice shown before an action would drop drafts.
 * Cancelling is always the escape route; the dialog never resolves an action
 * by itself, so its owner decides when the work is actually safe.
 */
export function WorkspaceUnsavedDialog({ open, title, description, saveLabel, busy = false, error, onSave, onDiscard, onCancel }: WorkspaceUnsavedDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return <dialog ref={dialogRef} className="rw-confirm-dialog rw-unsaved-dialog" aria-labelledby="rw-unsaved-title" aria-describedby="rw-unsaved-description" onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}>
    <h2 id="rw-unsaved-title">{title}</h2>
    <p id="rw-unsaved-description">{description}</p>
    {error !== undefined && <p className="rw-unsaved-error" role="alert">{error}</p>}
    <div className="rw-confirm-actions">
      <button type="button" disabled={busy} onClick={onCancel}>Cancel</button>
      <button type="button" className="danger" disabled={busy} onClick={onDiscard}>Discard</button>
      <button type="button" className="primary" autoFocus disabled={busy} onClick={onSave}>{busy ? "Saving…" : saveLabel}</button>
    </div>
  </dialog>;
}

export interface WorkspacePromptDialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly description: string;
  readonly initialValue?: string | undefined;
  readonly confirmLabel: string;
  readonly busy?: boolean | undefined;
  readonly error?: string | undefined;
  readonly onSubmit: (value: string) => void;
  readonly onCancel: () => void;
}

/** A one-field name prompt for create and rename, with its refusal kept in view. */
export function WorkspacePromptDialog({ open, title, description, initialValue = "", confirmLabel, busy = false, error, onSubmit, onCancel }: WorkspacePromptDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (open) setValue(initialValue);
  }, [open, initialValue]);

  return <dialog ref={dialogRef} className="rw-prompt-dialog" aria-labelledby="rw-prompt-title" onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}>
    <form onSubmit={event => { event.preventDefault(); if (!busy) onSubmit(value); }}>
      <h2 id="rw-prompt-title">{title}</h2>
      <p>{description}</p>
      <label>
        <span>Name</span>
        <input autoFocus value={value} disabled={busy} spellCheck={false} autoComplete="off" onChange={event => setValue(event.target.value)}/>
      </label>
      {error !== undefined && <p className="rw-prompt-error" role="alert">{error}</p>}
      <footer>
        <button type="button" disabled={busy} onClick={onCancel}>Cancel</button>
        <button type="submit" className="primary" disabled={busy}>{busy ? "Working…" : confirmLabel}</button>
      </footer>
    </form>
  </dialog>;
}
