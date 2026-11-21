import { useEffect, useRef } from "react";

interface Props {
  readonly open: boolean;
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly danger?: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

export function ConfirmDialog({ open, title, description, confirmLabel, danger = false, onConfirm, onCancel }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const completionRef = useRef<"confirm" | "cancel" | undefined>(undefined);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return <dialog ref={dialogRef} className="rw-confirm-dialog" aria-labelledby="rw-confirm-title" aria-describedby="rw-confirm-description" onClose={() => {
    if (completionRef.current === "confirm") onConfirm();
    else onCancel();
    completionRef.current = undefined;
  }}>
    <h2 id="rw-confirm-title">{title}</h2>
    <p id="rw-confirm-description">{description}</p>
    <div className="rw-confirm-actions">
      <button type="button" autoFocus onClick={() => { completionRef.current = "cancel"; dialogRef.current?.close(); }}>Cancel</button>
      <button type="button" className={danger ? "danger" : ""} onClick={() => { completionRef.current = "confirm"; dialogRef.current?.close(); }}>{confirmLabel}</button>
    </div>
  </dialog>;
}
