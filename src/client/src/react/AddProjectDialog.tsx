import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import { projectsApi, trustApi, type FileSuggestion, type WorkspaceTrustResponse } from "../api";
import type { ProjectFolderListing } from "../../../shared/pluginApiTypes";
import type { ProjectTrustChoice } from "../controllers/projectController";

interface Props {
  open: boolean;
  machineId: string;
  machineName: string;
  initialPath?: string;
  pickerNotice?: string;
  onClose: () => void;
  onSubmit: (path: string, create: boolean, trust: ProjectTrustChoice | undefined, machineId: string) => Promise<string | undefined>;
}

export function AddProjectDialog({ open, machineId, machineName, initialPath = "", pickerNotice, onClose, onSubmit }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [path, setPath] = useState("");
  const [create, setCreate] = useState(true);
  const [trust, setTrust] = useState<WorkspaceTrustResponse>();
  const [trustValue, setTrustValue] = useState(true);
  const [suggestions, setSuggestions] = useState<FileSuggestion[]>([]);
  const [trustError, setTrustError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [busy, setBusy] = useState(false);
  const [folderListing, setFolderListing] = useState<ProjectFolderListing>();
  const [browsePath, setBrowsePath] = useState(".");
  const [folderLoading, setFolderLoading] = useState(false);
  const [folderError, setFolderError] = useState("");
  const [trustLoading, setTrustLoading] = useState(false);
  const trustRequest = useRef(0);
  const parentPath = folderListing?.parent ?? "";
  const canBrowseParent = parentPath !== "";

  useEffect(() => { if (open) { setPath(initialPath); setBrowsePath(initialPath || "."); setFolderListing(undefined); setFolderError(pickerNotice ?? ""); } }, [open, initialPath, pickerNotice]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (open && dialog !== null && !dialog.open) dialog.showModal();
    if (!open && dialog?.open === true) dialog.close();
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
        trustApi.projectTrust(query, machineId).then(value => ({ kind: "trust" as const, value })).catch((error: unknown) => ({ kind: "trust-error" as const, error })),
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


  useEffect(() => {
    if (!open) { setFolderListing(undefined); setFolderError(""); setFolderLoading(false); return; }
    if (folderListing !== undefined) return;
    const controller = new AbortController();
    setFolderLoading(true); setFolderError("");
    void projectsApi.projectFolder({ path: browsePath }, machineId, { signal: controller.signal }).then(listing => {
      if (!controller.signal.aborted) { setFolderListing(listing); setBrowsePath(listing.path); setPath(listing.path); }
    }).catch((error: unknown) => { if (!controller.signal.aborted) setFolderError(error instanceof Error ? error.message : String(error)); })
      .finally(() => { if (!controller.signal.aborted) setFolderLoading(false); });
    return () => controller.abort();
  }, [browsePath, folderListing, machineId, open]);

  const browse = async (target: string) => {
    setFolderLoading(true); setFolderError("");
    try { const listing = await projectsApi.projectFolder({ path: target }, machineId); setFolderListing(listing); setBrowsePath(listing.path); setPath(listing.path); }
    catch (error) { setFolderError(error instanceof Error ? error.message : String(error)); }
    finally { setFolderLoading(false); }
  };

  const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
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
      if (error !== undefined && error !== "") setSubmitError(error);
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
      {pickerNotice !== undefined && pickerNotice !== "" && <p role="status" className="rw-folder-picker-notice">{pickerNotice}</p>}
      <section className="rw-folder-browser" aria-label="Browse folders">
        <div className="rw-folder-browser-toolbar"><button type="button" onClick={() => { if (canBrowseParent) void browse(parentPath); }} disabled={busy || folderLoading || !canBrowseParent}>‹</button><strong>{folderListing?.path ?? "Choose a folder"}</strong><button type="button" onClick={() => folderListing && void browse(folderListing.path)} disabled={busy || folderLoading}>↻</button></div>
        {folderListing && <nav className="rw-folder-crumbs" aria-label="Folder location">{folderListing.crumbs.map(crumb => <button type="button" key={crumb.path} onClick={() => void browse(crumb.path)} disabled={busy || folderLoading}>{crumb.name || folderListing.separator}</button>)}</nav>}
        <div className="rw-folder-list">{folderLoading ? <p role="status">Loading folders…</p> : folderError ? <p role="alert">{folderError}</p> : folderListing?.contents.kind === "unreadable" ? <p role="alert">{folderListing.contents.detail ?? "This folder cannot be opened."}</p> : folderListing?.contents.kind === "missing" ? <p>This folder does not exist yet.</p> : (folderListing?.contents.kind === "complete" || folderListing?.contents.kind === "truncated" || folderListing?.contents.kind === "incomplete") ? folderListing.contents.folders.map(folder => <button type="button" key={folder.path} onClick={() => void browse(folder.path)} disabled={busy}><span>▸</span>{folder.name}</button>) : null}</div>
        {folderListing && <button className="rw-folder-choose" type="button" onClick={() => setPath(folderListing.path)} disabled={busy}>Choose this folder</button>}
      </section>
      <label className="rw-add-project-check"><input type="checkbox" checked={create} onChange={event => setCreate(event.target.checked)} disabled={busy}/> Create the folder if it does not exist</label>
      {trust !== undefined && <label className="rw-add-project-check"><input type="checkbox" checked={trustValue} onChange={event => setTrustValue(event.target.checked)} disabled={busy || trustLoading}/> Trust this project folder</label>}
      {trustLoading && <p role="status">Checking folder settings…</p>}
      {trustError && <p role="status">Trust settings could not be read: {trustError}</p>}
      {submitError && <p role="alert">{submitError}</p>}
      <footer><button type="button" onClick={() => dialogRef.current?.close()} disabled={busy}>Cancel</button><button className="primary" type="submit" disabled={!path.trim() || busy || trustLoading}>{busy ? "Adding…" : "Add project"}</button></footer>
    </form>
  </dialog>;
}
