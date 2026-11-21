import { useEffect, useRef, useState } from "react";
import { workspaceFilePreviewUrl } from "../api/urls";
import { ConfirmDialog } from "./ConfirmDialog";
import { Icon } from "./icons";
import { WorkspaceBreadcrumbs, WorkspaceEntryIcon, WorkspaceFileTree } from "./WorkspaceFileTree";
import { WorkspacePromptDialog, WorkspaceUnsavedDialog } from "./WorkspaceFileDialogs";
import { WorkspaceCodeEditor } from "./WorkspaceCodeEditor";
import type { OpenWorkspaceFile, WorkspaceFilesApi } from "./useWorkspaceFiles";
import { downloadFileName, parentWorkspacePath, workspaceBaseName, workspaceFileIsDirty, workspaceTabLabel } from "./workspaceFiles";

export interface WorkspaceFilesPanelProps {
  readonly files: WorkspaceFilesApi;
  readonly rootLabel: string;
  readonly projectId: string | undefined;
  readonly workspaceId: string | undefined;
  readonly machineId: string;
  readonly hasWorkspace: boolean;
}

function deleteDescription(openFiles: readonly OpenWorkspaceFile[], target: string | undefined): string {
  const file = openFiles.find(item => item.path === target);
  return file !== undefined && workspaceFileIsDirty(file) ? "Unsaved edits in this file will be discarded. " : "";
}

export function WorkspaceFilesPanel({ files, rootLabel, projectId, workspaceId, machineId, hasWorkspace }: WorkspaceFilesPanelProps) {
  const [query, setQuery] = useState("");
  const [showTreeOnMobile, setShowTreeOnMobile] = useState(true);
  const [prompt, setPrompt] = useState<{ readonly kind: "create" | "rename"; readonly path?: string; readonly initial: string; readonly error?: string | undefined; readonly busy: boolean }>();
  const [deleteTarget, setDeleteTarget] = useState<string>();
  const [closeTarget, setCloseTarget] = useState<string>();
  const [closeError, setCloseError] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const [saveAllBusy, setSaveAllBusy] = useState(false);
  const uploadInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setQuery("");
    setPrompt(undefined);
    setDeleteTarget(undefined);
    setCloseTarget(undefined);
    setCloseError(undefined);
    setActionError(undefined);
    setShowTreeOnMobile(true);
  }, [projectId, workspaceId, machineId]);

  const active = files.activeFile;
  const dirtyCount = files.dirtyPaths.length;
  const searchActive = query.trim() !== "";

  const openPath = (path: string) => {
    setShowTreeOnMobile(false);
    void files.openFile(path);
  };

  const beginRename = (path: string) => {
    setActionError(undefined);
    setPrompt({ kind: "rename", path, initial: workspaceBaseName(path), busy: false });
  };

  const submitPrompt = async (value: string) => {
    const current = prompt;
    if (current === undefined || current.busy) return;
    setPrompt({ ...current, busy: true, error: undefined });
    if (current.kind === "create") {
      const result = await files.createFile(files.currentDirectory, value);
      if (result.ok) setPrompt(undefined);
      else setPrompt({ ...current, busy: false, error: result.error });
      return;
    }
    if (current.path === undefined) return;
    const result = await files.renameFile(current.path, value);
    if (result.ok) {
      setPrompt(undefined);
      setShowTreeOnMobile(false);
    } else {
      setPrompt({ ...current, busy: false, error: result.error });
    }
  };

  const requestClose = (path: string) => {
    const file = files.openFiles.find(item => item.path === path);
    if (file === undefined) return;
    const dirty = workspaceFileIsDirty(file);
    if (!dirty) {
      files.closeFile(path);
      if (files.openFiles.length <= 1) setShowTreeOnMobile(true);
      return;
    }
    setCloseError(undefined);
    setCloseTarget(path);
  };

  const saveAndClose = async () => {
    const path = closeTarget;
    if (path === undefined) return;
    const outcome = await files.saveFile(path);
    if (outcome === "saved" || outcome === "unchanged") {
      files.closeFile(path);
      setCloseTarget(undefined);
      setCloseError(undefined);
      if (files.openFiles.length <= 1) setShowTreeOnMobile(true);
    } else if (outcome === "conflict") {
      setCloseError("This file changed on disk. Choose Cancel, then reload or keep your version in the editor.");
    } else {
      setCloseError("The file could not be saved. Your draft is still here.");
    }
  };

  const discardAndClose = () => {
    const path = closeTarget;
    if (path === undefined) return;
    files.discardDraft(path);
    files.closeFile(path);
    setCloseTarget(undefined);
    setCloseError(undefined);
  };

  const deleteFile = async () => {
    const path = deleteTarget;
    if (path === undefined) return;
    setDeleteTarget(undefined);
    setActionError(undefined);
    const result = await files.deleteFile(path);
    if (!result.ok) setActionError(result.error ?? "The file could not be deleted.");
  };

  const saveAll = async () => {
    if (dirtyCount === 0 || saveAllBusy) return;
    setSaveAllBusy(true);
    setActionError(undefined);
    try {
      const summary = await files.saveAll();
      if (summary.failed > 0 || summary.conflicts > 0) {
        setActionError(summary.conflicts > 0
          ? "Some files changed on disk. Open each changed file and reload or keep your version, then save again."
          : `${String(summary.failed)} file${summary.failed === 1 ? "" : "s"} could not be saved. Your drafts are still here.`);
      }
    } finally {
      setSaveAllBusy(false);
    }
  };

  const upload = async (list: FileList | null) => {
    if (list === null || list.length === 0) return;
    setActionError(undefined);
    const result = await files.uploadFiles(files.currentDirectory, Array.from(list));
    if (result.failures.length > 0) setActionError(result.failures.join("\n"));
  };

  const rootLoading = files.tree.loading.includes("");
  const rootError = files.tree.errors[""];

  return <section className={"rw-files-panel" + (active !== undefined ? " has-editor" : "") + (showTreeOnMobile ? " show-tree" : "")}>
    <div className="rw-files-toolbar">
      <label className="rw-files-filter">
        <Icon name="search"/>
        <input aria-label="Filter files" placeholder="Filter files…" value={query} spellCheck={false} onChange={event => { setQuery(event.target.value); files.setSearchQuery(event.target.value); }}/>
        {query !== "" && <button type="button" aria-label="Clear file filter" title="Clear filter" onClick={() => { setQuery(""); files.setSearchQuery(""); }}><Icon name="x"/></button>}
      </label>
      <button type="button" className="rw-icon-button" title={`New file in ${files.currentDirectory || "the workspace root"}`} aria-label="New file" disabled={!hasWorkspace || prompt !== undefined} onClick={() => { setActionError(undefined); setPrompt({ kind: "create", initial: "", busy: false }); }}><Icon name="plus"/></button>
      <button type="button" className="rw-icon-button" title="Creating folders is not supported by this workspace's file backend" aria-label="New folder" disabled><Icon name="folder-plus"/></button>
      <button type="button" className="rw-icon-button" title={`Upload files to ${files.currentDirectory || "the workspace root"}`} aria-label="Upload files" disabled={!hasWorkspace || files.busy !== undefined} onClick={() => uploadInput.current?.click()}><Icon name="upload"/></button>
      <input ref={uploadInput} className="rw-visually-hidden" type="file" multiple aria-label="Files to upload" onChange={event => { const list = event.target.files; event.target.value = ""; void upload(list); }}/>
      <button type="button" className="rw-icon-button" title="Refresh files" aria-label="Refresh files" disabled={!hasWorkspace || files.refreshing} onClick={() => void files.refresh()}><Icon name="refresh-cw"/></button>
    </div>

    {files.notice !== undefined && <div className={"rw-files-notice " + files.notice.kind} role={files.notice.kind === "error" ? "alert" : "status"}>
      <span>{files.notice.text}</span>
      <button type="button" aria-label="Dismiss message" onClick={files.clearNotice}><Icon name="x"/></button>
    </div>}
    {actionError !== undefined && <div className="rw-files-notice error" role="alert">
      <span>{actionError}</span>
      <button type="button" aria-label="Dismiss error" onClick={() => setActionError(undefined)}><Icon name="x"/></button>
    </div>}

    <div className="rw-files-browser">
      {!hasWorkspace && <div className="rw-empty-state">Select a project to browse its files.</div>}
      {hasWorkspace && <>
        <div className="rw-files-location">
          <WorkspaceBreadcrumbs path={files.currentDirectory} rootLabel={rootLabel} onNavigate={path => { setQuery(""); files.setSearchQuery(""); files.setCurrentDirectory(path); }}/>
          <small title="New files and uploads land in this folder">{files.currentDirectory === "" ? "root" : files.currentDirectory}</small>
        </div>
        {files.tree.truncated[files.currentDirectory] === true && <div className="rw-data-state rw-files-truncated" role="status">This folder has more than 1,000 entries; showing the first 1,000. Use filter to narrow it.</div>}

        {searchActive ? <div className="rw-file-search-results" aria-label="File search results">
          {files.search.loading && <div className="rw-data-state" role="status">Searching files…</div>}
          {!files.search.loading && files.search.error !== undefined && <div className="rw-data-error" role="alert">{files.search.error}<button type="button" onClick={() => { setQuery(""); files.setSearchQuery(""); }}>Clear search</button></div>}
          {!files.search.loading && files.search.error === undefined && files.search.results.length === 0 && <div className="rw-data-state">No files match “{query.trim()}”.</div>}
          {!files.search.loading && files.search.results.map(result => <button type="button" key={result.path} className={active?.path === result.path ? "selected" : ""} title={result.path} onClick={() => openPath(result.path)}>
            <WorkspaceEntryIcon entry={{ name: workspaceBaseName(result.path), type: "file" }}/>
            <span>{result.path}</span>
            <small>{result.kind}</small>
          </button>)}
        </div> : <>
          {rootLoading && <div className="rw-data-state" role="status">Loading project files…</div>}
          {!rootLoading && rootError !== undefined && <div className="rw-data-error" role="alert">Could not read this workspace&apos;s files: {rootError}<button type="button" onClick={() => void files.retryDirectory("")}>Retry</button></div>}
          {!rootLoading && rootError === undefined && files.tree.loaded.includes("") && (files.tree.entries[""] ?? []).length === 0 && <div className="rw-empty-state">This workspace has no files yet.</div>}
          {!rootLoading && rootError === undefined && <WorkspaceFileTree
            entriesByDirectory={files.tree.entries}
            expandedPaths={files.tree.expanded}
            loadingPaths={files.tree.loading}
            errors={files.tree.errors}
            selectedPath={active?.path}
            currentDirectory={files.currentDirectory}
            onToggleDirectory={entry => void files.toggleDirectory(entry.path)}
            onSelectFile={entry => openPath(entry.path)}
            onRetryDirectory={path => void files.retryDirectory(path)}
          />}
        </>}
      </>}
    </div>

    {active !== undefined && <section className="rw-file-editor" aria-label={`Editor for ${active.path}`}>
      <div className="rw-editor-toolbar">
        <button type="button" className="rw-icon-button rw-editor-back" aria-label="Back to files" title="Back to files" onClick={() => setShowTreeOnMobile(true)}><Icon name="arrow-left"/></button>
        <div className="rw-editor-heading">
          <strong title={active.path}>{workspaceBaseName(active.path)}</strong>
          <small>{active.loading ? "Loading…" : active.binary ? "Binary file" : active.truncated ? "Truncated preview" : `${String(active.content.split("\n").length)} lines · ${active.saveState === "saving" ? "Saving…" : workspaceFileIsDirty(active) ? "Unsaved changes" : "Saved"}`}</small>
        </div>
        <div className="rw-editor-actions">
          <button type="button" title="Save (⌘S / Ctrl+S)" aria-label="Save file" disabled={!workspaceFileIsDirty(active) || active.saveState === "saving"} onClick={() => void files.saveFile(active.path)}><Icon name="save"/><span>Save</span></button>
          <button type="button" title="Save all (⇧⌘S / Ctrl+Shift+S)" aria-label="Save all files" disabled={dirtyCount === 0 || saveAllBusy} onClick={() => void saveAll()}><span>{saveAllBusy ? "Saving…" : `Save all${dirtyCount > 1 ? ` (${String(dirtyCount)})` : ""}`}</span></button>
          <button type="button" title="Rename file" aria-label="Rename file" disabled={files.busy !== undefined} onClick={() => beginRename(active.path)}><Icon name="pencil"/></button>
          {projectId !== undefined && workspaceId !== undefined && <a className="rw-icon-button" title="Download file" aria-label="Download file" href={workspaceFilePreviewUrl(projectId, workspaceId, active.path, { modifiedAt: active.modifiedAt, download: true, machineId })} download={downloadFileName(active.path)}><Icon name="download"/></a>}
          <button type="button" className="danger" title="Delete file" aria-label="Delete file" disabled={files.busy !== undefined} onClick={() => setDeleteTarget(active.path)}><Icon name="trash"/></button>
          <button type="button" title="Close file" aria-label="Close file" onClick={() => requestClose(active.path)}><Icon name="x"/></button>
        </div>
      </div>

      <div className="rw-editor-tabs" role="tablist" aria-label="Open files">
        {files.openFiles.map(file => {
          const dirty = workspaceFileIsDirty(file);
          const selected = file.path === active.path;
          return <div className={"rw-editor-tab" + (selected ? " active" : "")} key={file.path}>
            <button type="button" role="tab" aria-selected={selected} title={file.path} onClick={() => { files.activateFile(file.path); setShowTreeOnMobile(false); }}>
              <span>{workspaceTabLabel(file.path, files.openFiles.map(item => item.path))}</span>
              {dirty && <i className="rw-dirty-dot" aria-label="Unsaved changes"/>}
              {file.externalChange !== undefined && <i className="rw-external-dot" aria-label="Changed on disk"/>}
            </button>
            <button type="button" className="rw-editor-tab-close" aria-label={`Close ${workspaceBaseName(file.path)}`} title="Close file" onClick={() => requestClose(file.path)}><Icon name="x"/></button>
          </div>;
        })}
      </div>

      {active.externalChange !== undefined && <div className="rw-file-conflict" role="alert">
        <span>{active.externalChange.content === null ? "This file was deleted or can no longer be read on disk." : "This file changed on disk while you were editing."}</span>
        {active.externalChange.content !== null && <button type="button" onClick={() => void files.reloadFile(active.path)}>Reload from disk</button>}
        <button type="button" onClick={() => files.keepLocalChanges(active.path)}>Keep my version</button>
      </div>}
      {active.saveError !== undefined && <div className="rw-file-save-error" role="alert">Could not save this file: {active.saveError}. Your draft is kept and can be saved again.</div>}

      <div className="rw-editor-body">
        {active.loading && <div className="rw-data-state" role="status">Loading {active.path}…</div>}
        {!active.loading && active.error !== undefined && <div className="rw-data-error" role="alert">Could not open {active.path}: {active.error}<button type="button" onClick={() => void files.retryFile(active.path)}>Retry</button></div>}
        {!active.loading && active.error === undefined && active.binary && <div className="rw-data-state">This file is binary and cannot be edited here. Use Download to open it.</div>}
        {!active.loading && active.error === undefined && !active.binary && active.truncated && <div className="rw-data-state">This file is too large to edit here (the preview is truncated). Use Download to open the full file.</div>}
        {!active.loading && active.error === undefined && !active.binary && !active.truncated && <WorkspaceCodeEditor
          path={active.path}
          value={active.content}
          readOnly={active.saveState === "saving"}
          onChange={files.changeDraft}
          onSave={path => { void files.saveFile(path); }}
          onSaveAll={() => void saveAll()}
        />}
      </div>
    </section>}

    <WorkspacePromptDialog
      open={prompt !== undefined}
      title={prompt?.kind === "rename" ? "Rename file" : "New file"}
      description={prompt?.kind === "rename" ? `Enter a new name for ${prompt.path ?? ""}. The file stays in ${parentWorkspacePath(prompt.path ?? "") || "the workspace root"}.` : `Create an empty file in ${files.currentDirectory || "the workspace root"}.`}
      initialValue={prompt?.initial}
      confirmLabel={prompt?.kind === "rename" ? "Rename" : "Create"}
      busy={prompt?.busy ?? false}
      error={prompt?.error}
      onSubmit={value => { void submitPrompt(value); }}
      onCancel={() => { if (prompt?.busy !== true) setPrompt(undefined); }}
    />

    <ConfirmDialog
      open={deleteTarget !== undefined}
      title="Delete file"
      description={`Delete ${deleteTarget ?? ""}? ${deleteDescription(files.openFiles, deleteTarget)}This cannot be undone.`}
      confirmLabel="Delete"
      danger
      onConfirm={() => void deleteFile()}
      onCancel={() => setDeleteTarget(undefined)}
    />

    <WorkspaceUnsavedDialog
      open={closeTarget !== undefined}
      title="Close file with unsaved changes?"
      description={`${closeTarget ?? ""} has edits that are not saved. Save them before closing, discard them, or cancel and keep editing.`}
      saveLabel="Save and close"
      error={closeError}
      onSave={() => void saveAndClose()}
      onDiscard={discardAndClose}
      onCancel={() => { setCloseTarget(undefined); setCloseError(undefined); }}
    />
  </section>;
}
