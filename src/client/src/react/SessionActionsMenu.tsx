import { useRef, useState } from "react";
import type { SessionInfo } from "../api";
import { Icon } from "./icons";
import { ConfirmDialog } from "./ConfirmDialog";

interface Props {
  readonly session: SessionInfo | undefined;
  readonly machineId: string;
  readonly pending: boolean;
  readonly rename: (name: string) => Promise<void>;
  readonly archive: (session: SessionInfo, machineId: string) => Promise<void>;
  readonly restore: (session: SessionInfo, machineId: string) => Promise<void>;
  readonly deleteArchived: (session: SessionInfo, machineId: string) => Promise<void>;
}

interface Confirmation { readonly kind: "archive" | "delete"; readonly session: SessionInfo; readonly machineId: string }

export function SessionActionsMenu({ session, machineId, pending, rename, archive, restore, deleteArchived }: Props) {
  const disclosureRef = useRef<HTMLDetailsElement>(null);
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const renameSession = () => {
    if (session === undefined) return;
    const current = session.name ?? session.firstMessage;
    const name = window.prompt("Session name", current);
    if (name !== null && name.trim() !== "" && name.trim() !== current) void run(() => rename(name.trim()));
  };
  return <details ref={disclosureRef} className="rw-session-actions" open={menuOpen} onToggle={event => setMenuOpen(event.currentTarget.open)} onKeyDown={event => {
    if (event.key !== "Escape") return;
    if (event.target instanceof Element && event.target.closest("dialog") !== null) return;
    event.preventDefault();
    const disclosure = disclosureRef.current;
    if (disclosure === null) return;
    setMenuOpen(false);
    disclosure.querySelector("summary")?.focus();
  }}>
    <summary aria-label="Session actions"><Icon name="more-horizontal"/></summary>
    <div className="rw-session-actions-menu" role="group" aria-label="Session actions">
      <button type="button" disabled={session === undefined || busy || pending || session.archived === true} onClick={renameSession}>Rename session</button>
      {session?.archived === true
        ? <>
          <button type="button" disabled={busy || pending} onClick={() => void run(() => restore(session, machineId))}>Restore session</button>
          <button type="button" disabled={busy || pending} onClick={() => setConfirmation({ kind: "delete", session, machineId })}>Delete archived session</button>
        </>
        : <button type="button" disabled={session === undefined || busy || pending} onClick={() => { if (session !== undefined) setConfirmation({ kind: "archive", session, machineId }); }}>Archive session</button>}
      {busy && <span role="status">Updating session…</span>}
      {pending && <span role="status">A session change is still in progress.</span>}
      {error !== undefined && error !== "" && <span role="alert">{error}</span>}
      {confirmation !== undefined && <ConfirmDialog
        open
        title={confirmation.kind === "delete" ? "Delete archived session?" : "Archive session?"}
        description={confirmation.kind === "delete" ? `Permanently delete “${confirmation.session.name ?? confirmation.session.firstMessage}” after the undo window? This cannot be undone.` : `Archive “${confirmation.session.name ?? confirmation.session.firstMessage}”? You can restore it later.`}
        confirmLabel={confirmation.kind === "delete" ? "Delete permanently" : "Archive session"}
        danger={confirmation.kind === "delete"}
        onCancel={() => setConfirmation(undefined)}
        onConfirm={() => {
          const action = confirmation.kind === "delete" ? deleteArchived : archive;
          const target = confirmation.session;
          const targetMachineId = confirmation.machineId;
          setConfirmation(undefined);
          const disclosure = disclosureRef.current;
          if (disclosure !== null) {
            setMenuOpen(false);
            disclosure.querySelector("summary")?.focus();
          }
          void run(() => action(target, targetMachineId));
        }}
      />}
    </div>
  </details>;
}
