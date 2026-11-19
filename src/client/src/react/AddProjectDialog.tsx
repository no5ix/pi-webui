import { useEffect, useRef, useState, type FormEvent } from "react";
import { projectsApi, trustApi, type FileSuggestion, type WorkspaceTrustResponse } from "../api";
import type { ProjectTrustChoice } from "../controllers/projectController";

type Props = {
  open: boolean;
  machineId: string;
  machineName: string;
  onClose: () => void;
  onSubmit: (path: string, create: boolean, trust: ProjectTrustChoice | undefined, machineId: string) => Promise<string | undefined>;
};

export function AddProjectDialog({ open, machineId, machineName, onClose, onSubmit }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [path, setPath] = useState("");
  const [create, setCreate] = useState(true);
  const [trust, setTrust] = useState<WorkspaceTrustResponse>();
  const [trustValue, setTrustValue] = useState(true);
  const [suggestions, setSuggestions] = useState<FileSuggestion[]>([]);
  const [trustError, setTrustError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [busy, setBusy] = useState(false);
  const [trustLoading, setTrustLoading] = useState(false);
  const trustRequest = useRef(0);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (open && dialog !== null && !dialog.open) dialog.showModal();
    if (!open && dialog?.open) dialog.close();
    if (open) queueMicrotask(() => dialog?.querySelector<HTMLInputElement>("input[name=path]")?.focus());
  }, [open]);

  useEffect(() => {
    if (!open || path.trim() === "") {
      setTrust(undefined);
      setSuggestions([]);
      setTrustError("");
      setTrustLoading(false);
      return;
    }
    const request = ++trustRequest.current;
    const query = path.trim();
    setTrust(undefined);
    setSuggestions([]);
    setTrustLoading(true);
    setTrustError("");
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void Promise.all([
        trustApi.projectTrust(query, machineId).then(value => ({ kind: "trust" as const, value })).catch(error => ({ kind: "trust-error" as const, error })),
        projectsApi.projectDirectories(query, machineId, { signal: controller.signal }).then(value => ({ kind: "suggestions" as const, value })).catch(() => ({ kind: "suggestions-error" as const })),
      ]).then(results => {
        if (request !== trustRequest.current) return;
        for (const result of results) {
          if (result.kind === "trust") {
            setTrust(result.value);
            const defaultChecked = result.value.defaultTrust !== "never";
            setTrustValue(result.value.decision ?? defaultChecked);
          } else if (result.kind === "trust-error") setTrustError(result.error instanceof Error ? result.error.message : String(result.error));
          else if (result.kind === "suggestions") setSuggestions(result.value);
        }
        setTrustLoading(false);
      });
    }, 180);
    return () => { clearTimeout(timer); controller.abort(); trustRequest.current += 1; };
  }, [machineId, open, path]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const target = path.trim();
    if (!target || busy || trustLoading) return;
    setBusy(true);
    setSubmitError("");
    const defaultChecked = trust?.defaultTrust !== "never";
    const choice = trust === undefined ? undefined : {
      trusted: trustValue,
      changed: trustValue !== (trust.decision ?? defaultChecked) || (trust.decision === null && defaultChecked),
    };
    try {
      const error = await onSubmit(target, create, choice, machineId);
      if (error) setSubmitError(error);
      else onClose();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return <dialog ref={dialogRef} className="rw-add-project-dialog" aria-labelledby="rw-add-project-title" onClose={onClose} onCancel={event => { if (busy) event.preventDefault(); }}>
    <form onSubmit={event => void submit(event)}>
      <header><div><h2 id="rw-add-project-title">Add project</h2><small>On {machineName}</small></div><button type="button" aria-label="Close add project" onClick={() => dialogRef.current?.close()} disabled={busy}>×</button></header>
      <label>Project folder<input name="path" value={path} onChange={event => setPath(event.target.value)} list="rw-project-directory-suggestions" autoComplete="off" spellCheck={false} placeholder="/path/to/project" required disabled={busy}/></label>
      <datalist id="rw-project-directory-suggestions">{suggestions.map(item => <option key={item.path} value={item.path}/>)}</datalist>
      <label className="rw-add-project-check"><input type="checkbox" checked={create} onChange={event => setCreate(event.target.checked)} disabled={busy}/> Create the folder if it does not exist</label>
      {trust !== undefined && <label className="rw-add-project-check"><input type="checkbox" checked={trustValue} onChange={event => setTrustValue(event.target.checked)} disabled={busy || trustLoading}/> Trust this project folder</label>}
      {trustLoading && <p role="status">Checking folder settings…</p>}
      {trustError && <p role="status">Trust settings could not be read: {trustError}</p>}
      {submitError && <p role="alert">{submitError}</p>}
      <footer><button type="button" onClick={() => dialogRef.current?.close()} disabled={busy}>Cancel</button><button className="primary" type="submit" disabled={!path.trim() || busy || trustLoading}>{busy ? "Adding…" : "Add project"}</button></footer>
    </form>
  </dialog>;
}
