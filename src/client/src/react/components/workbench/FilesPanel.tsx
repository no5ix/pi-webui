import { useEffect, useState, type ReactNode } from "react";
import { workspacesApi } from "../../../api";
import { Icon, IconButton } from "../common/icons";
import { ContextMenu, type ContextMenuItem } from "../common/ContextMenu";
import { ConfirmDialog } from "../common/Dialog";
import { registerShellCommands } from "../../state/shellCommands";
import { writeClipboardText } from "../../../clipboard";
import {
  closeFile,
  deleteFile,
  editFile,
  moveFile,
  openFile,
  readTree,
  sameScope,
  saveOpenFile,
  setFileFilter,
  toggleDirectory,
  useFiles,
  type FileNode,
  type FileScope,
} from "../../state/filesStore";

/**
 * The Files tab.
 *
 * A directory at a time, a file opened on demand, and a plain editor that says
 * what it is: the text is saved through the workspace file route, the dirty mark
 * and the save time are the shell's, and a file whose content the machine does
 * not send as text is said to be unread here rather than shown as empty.
 */
export interface FilesPanelProps {
  scope: FileScope | undefined;
}

interface MenuState {
  anchor: DOMRect;
  node: FileNode;
}

export function FilesPanel(props: FilesPanelProps): ReactNode {
  const files = useFiles();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [confirming, setConfirming] = useState<FileNode | undefined>(undefined);
  const [renaming, setRenaming] = useState<FileNode | undefined>(undefined);
  const [renameValue, setRenameValue] = useState("");
  const [upload, setUpload] = useState<{ name: string; problem: string | undefined } | undefined>(undefined);

  useEffect(() => {
    if (props.scope === undefined) return;
    void readTree(props.scope, "");
  }, [props.scope?.machineId, props.scope?.projectId, props.scope?.workspaceId]);

  useEffect(() => {
    const listener = (event: Event): void => {
      const detail: unknown = event instanceof CustomEvent ? event.detail : undefined;
      if (typeof detail !== "object" || detail === null) return;
      const path: unknown = Reflect.get(detail, "path");
      if (typeof path !== "string" || props.scope === undefined) return;
      void openFile(props.scope, path);
    };
    window.addEventListener("pi-web-open-file", listener);
    return () => { window.removeEventListener("pi-web-open-file", listener); };
  }, [props.scope?.machineId, props.scope?.projectId, props.scope?.workspaceId]);

  useEffect(() => {
    const scope = props.scope;
    if (scope === undefined) return;
    const unsubscribe = registerShellCommands([
      { id: "files.refresh", title: "Refresh the file tree", group: "Files", run: () => { void readTree(scope, ""); }},
      { id: "files.refreshRoot", title: "Reload the workspace root", group: "Files", run: () => { void readTree(scope, ""); }},
      {
        id: "files.save",
        title: "Save the open file",
        group: "Files",
        disabled: files.open?.content === files.open?.baseline ? "Nothing to save" : undefined,
        run: () => { void saveOpenFile(); },
      },
      {
        id: "files.newFile",
        title: "Create a new file at the workspace root",
        group: "Files",
        run: () => {
          void workspacesApi.writeWorkspaceFile(scope.projectId, scope.workspaceId, "new-file.txt", "", undefined, scope.machineId).then(() => readTree(scope, ""));
        },
      },
      {
        id: "files.copyPath",
        title: "Copy the open file's path",
        group: "Files",
        disabled: files.open === undefined ? "No file is open" : undefined,
        run: () => {
          if (files.open !== undefined) void writeClipboardText(files.open.path);
        },
      },
    ]);
    return unsubscribe;
  }, [props.scope, files.open?.path, files.open?.content, files.open?.baseline]);

  const root = files.trees[treeKeyFor(props.scope, "")];

  return (
    <div className="piw-files" data-testid="files-panel">
      {props.scope === undefined ? (
        <p className="piw-empty">No workspace is chosen, so there are no files to list.</p>
      ) : (
        <>
          <div className="piw-files__filter">
            <Icon label="" name="search" size="small" />
            <input
              aria-label="Filter files"
              className="piw-files__filter-input"
              onChange={(event) => { setFileFilter(event.target.value); }}
              onKeyDown={(event) => {
                if (event.key === "Escape") setFileFilter("");
              }}
              placeholder="Filter files…"
              type="search"
              value={files.filter}
            />
            <label className="piw-icon-button" title="Upload a file into the workspace root">
              <Icon label="" name="upload" />
              <input
                onChange={(event) => {
                  const node = event.target.files?.[0];
                  if (node === undefined || props.scope === undefined) return;
                  void uploadFile(props.scope, node, setUpload);
                  event.target.value = "";
                }}
                style={{ display: "none" }}
                type="file"
              />
            </label>
          </div>
          {upload === undefined ? null : (
            <p className="piw-files__progress" role="status">
              {upload.problem === undefined ? `Uploading ${upload.name}…` : `${upload.name}: ${upload.problem}`}
            </p>
          )}
          <div className="piw-files__tree">
            {root === undefined || root.phase === "loading" ? <p className="piw-empty">Reading the workspace…</p> : null}
            {root?.phase === "failed" ? <p className="piw-empty">{`The file tree did not answer: ${root.error ?? "no reason given"}`}</p> : null}
            {root?.phase === "ready" ? (
              <FileLevel
                depth={0}
                nodes={filterNodes(root.value ?? [], files.filter)}
                scope={props.scope}
                onMenu={(anchor, node) => { setMenu({ anchor, node }); }}
                selectedPath={files.open?.path}
              />
            ) : null}
            {root?.phase === "ready" && (root.value?.length ?? 0) === 0 ? <p className="piw-empty">The workspace root is empty.</p> : null}
          </div>
          <FileSurface scope={props.scope} />
        </>
      )}

      <ContextMenu
        anchor={menu?.anchor ?? null}
        items={menu === null || props.scope === undefined ? [] : nodeMenu(menu.node, props.scope, setConfirming, setRenaming, setRenameValue)}
        onClose={() => { setMenu(null); }}
        open={menu !== null}
      />

      <ConfirmDialog
        body={<p>{`Delete “${confirming?.path ?? ""}”? The machine removes the file; it cannot be undone from here.`}</p>}
        confirmLabel="Delete"
        danger={true}
        onClose={() => { setConfirming(undefined); }}
        onConfirm={() => {
          if (confirming !== undefined && props.scope !== undefined) void deleteFile(props.scope, confirming.path);
          setConfirming(undefined);
        }}
        open={confirming !== undefined}
        title="Delete file"
      />

      {renaming === undefined ? null : (
        <RenameFile
          onCancel={() => { setRenaming(undefined); }}
          node={renaming}
          onSubmit={(target) => {
            if (props.scope === undefined) return;
            void moveFile(props.scope, renaming.path, target);
            setRenaming(undefined);
          }}
          renameValue={renameValue}
          setRenameValue={setRenameValue}
        />
      )}
    </div>
  );
}

function FileLevel(props: { nodes: readonly FileNode[]; depth: number; scope: FileScope; selectedPath: string | undefined; onMenu: (anchor: DOMRect, node: FileNode) => void }): ReactNode {
  const files = useFiles();
  return (
    <ul className={props.depth === 0 ? "piw-files__level piw-files__level--root" : "piw-files__level"}>
      {props.nodes.map((node) => {
        const expanded = files.expanded.includes(node.path);
        const selected = props.selectedPath === node.path;
        return (
          <li key={node.path}>
            <div className={selected ? "piw-files__row piw-files__row--selected" : "piw-files__row"}>
              <button
                className="piw-files__row-button"
                onClick={() => {
                  if (node.directory) {
                    toggleDirectory(node.path);
                    if (!expanded) void readTree(props.scope, node.path);
                    return;
                  }
                  void openFile(props.scope, node.path);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  props.onMenu(event.currentTarget.getBoundingClientRect(), node);
                }}
                type="button"
              >
                {node.directory ? <Icon className="piw-files__row-twisty" label="" name={expanded ? "chevronDown" : "chevronRight"} size="small" /> : null}
                <Icon label="" name={node.directory ? "folderOpen" : "file"} size="small" />
                <span className="piw-files__row-name piw-mono" dir="auto">{node.name}</span>
              </button>
            </div>
            {node.directory && expanded ? (
              <FileLevel
                depth={props.depth + 1}
                nodes={filterNodes(files.trees[treeKeyFor(props.scope, node.path)]?.value ?? [], files.filter)}
                onMenu={props.onMenu}
                scope={props.scope}
                selectedPath={props.selectedPath}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function FileSurface({ scope }: { scope: FileScope }): ReactNode {
  const files = useFiles();
  const open = files.open;
  if (open === undefined) return <p className="piw-empty">Choose a file to read it.</p>;
  if (!sameScope(open.scope, scope)) return <p className="piw-empty">That file belongs to another workspace.</p>;
  const dirty = open.content !== open.baseline;
  return (
    <div className="piw-files__surface">
      <div className="piw-files__surface-header">
        <span className="piw-mono" dir="auto">{open.path}</span>
        {dirty ? <span className="piw-badge">unsaved</span> : null}
        {open.savedAt === undefined ? null : <span className="piw-row__meta">saved</span>}
        <span className="piw-workbench__toolbar-spacer" />
        <IconButton icon="close" label="Close the file" onClick={() => { closeFile(); }} />
        <IconButton disabled={!dirty || open.saving} icon="upload" label="Save the file" onClick={() => { void saveOpenFile(); }} />
      </div>
      {open.read.phase === "loading" ? <p className="piw-empty">Reading the file…</p> : null}
      {open.read.phase === "failed" || open.read.phase === "refused" ? <p className="piw-empty">{open.read.error ?? "The file did not answer."}</p> : null}
      {open.read.phase === "ready" ? (
        <textarea
          aria-label={`Edit ${open.path}`}
          className="piw-files__editor piw-mono"
          onChange={(event) => { editFile(event.target.value); }}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "s") {
              event.preventDefault();
              void saveOpenFile();
            }
          }}
          spellCheck={false}
          value={open.content}
        />
      ) : null}
    </div>
  );
}

function RenameFile(props: { node: FileNode; renameValue: string; setRenameValue(set: string): void; onCancel(): void; onSubmit(target: string): void }): ReactNode {
  return (
    <div className="piw-files__menu" role="dialog" aria-label={`Rename ${props.node.path}`}>
      <label className="piw-field">
        <span className="piw-label">New path</span>
        <input className="piw-input" onChange={(event) => { props.setRenameValue(event.target.value); }} value={props.renameValue === "" ? props.node.path : props.renameValue} />
      </label>
      <div className="piw-files__menu-actions">
        <button className="piw-button" onClick={() => { props.onCancel(); }} type="button">
          Cancel
        </button>
        <button
          className="piw-button piw-button--primary"
          onClick={() => { props.onSubmit(props.renameValue === "" ? props.node.path : props.renameValue); }}
          type="button"
        >
          Move
        </button>
      </div>
    </div>
  );
}

function nodeMenu(node: FileNode, scope: FileScope, setConfirming: (node: FileNode) => void, setRenaming: (node: FileNode) => void, setRenameValue: (value: string) => void): ContextMenuItem[] {
  return [
    { label: "Open", icon: "play", onSelect: () => { void openFile(scope, node.path); }},
    { label: "Copy path", icon: "copy", onSelect: () => { void writeClipboardText(node.path); }},
    {
      label: "Rename / move",
      icon: "edit",
      onSelect: () => {
        setRenaming(node);
        setRenameValue(node.path);
      },
    },
    { label: "Refresh folder", icon: "refresh", onSelect: () => { void readTree(scope, parentOf(node.path)); }},
    { label: "Delete", icon: "trash", danger: true, disabled: node.directory, onSelect: () => { setConfirming(node); }},
  ];
}

async function uploadFile(scope: FileScope, file: File, report: (value: { name: string; problem: string | undefined } | undefined) => void): Promise<void> {
  report({ name: file.name, problem: undefined });
  const buffer = await file.arrayBuffer();
  try {
    await workspacesApi.writeWorkspaceFile(scope.projectId, scope.workspaceId, file.name, new Uint8Array(buffer), undefined, scope.machineId);
    await readTree(scope, "");
    report(undefined);
  } catch (error) {
    report({ name: file.name, problem: error instanceof Error ? error.message : String(error) });
  }
}

function parentOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

function treeKeyFor(scope: FileScope | undefined, path: string): string {
  if (scope === undefined) return "";
  return `${scope.machineId}|${scope.projectId}|${scope.workspaceId}|${path}`;
}

function filterNodes(nodes: readonly FileNode[], filter: string): readonly FileNode[] {
  if (filter === "") return nodes;
  const needle = filter.toLowerCase();
  return nodes.filter((node) => node.name.toLowerCase().includes(needle));
}
