import type { FileTreeEntry } from "../api";
import { Icon } from "./icons";
import { formatFileSize, sortFileEntries, workspaceBreadcrumbs, workspaceEntryKind, type WorkspaceEntryKind } from "./workspaceFiles";

export interface WorkspaceEntryIconProps {
  readonly entry: Pick<FileTreeEntry, "name" | "type">;
  readonly open?: boolean;
}

export function WorkspaceEntryIcon({ entry, open = false }: WorkspaceEntryIconProps) {
  const kind = workspaceEntryKind(entry);
  if (kind === "directory") return <span className={"rw-entry-icon kind-directory" + (open ? " open" : "")} aria-hidden="true"><Icon name={open ? "folder-open" : "folder"}/></span>;
  return <span className={`rw-entry-icon kind-${kind}`} aria-hidden="true"><Icon name={iconName(kind)}/>{badge(kind)}</span>;
}

function iconName(kind: WorkspaceEntryKind): string {
  if (kind === "json") return "braces";
  if (kind === "code") return "code";
  if (kind === "image") return "image";
  if (kind === "archive") return "archive";
  if (kind === "markdown") return "file-text";
  if (kind === "config") return "file-text";
  return "file-text";
}

function badge(kind: WorkspaceEntryKind): React.ReactNode {
  if (kind === "markdown") return <b>MD</b>;
  if (kind === "text") return <b>TXT</b>;
  if (kind === "config") return <b>CFG</b>;
  return null;
}

export interface WorkspaceBreadcrumbsProps {
  readonly path: string;
  readonly rootLabel: string;
  readonly onNavigate: (path: string) => void;
}

export function WorkspaceBreadcrumbs({ path, rootLabel, onNavigate }: WorkspaceBreadcrumbsProps) {
  const crumbs = workspaceBreadcrumbs(path, rootLabel);
  return <nav className="rw-breadcrumbs" aria-label="Current folder">
    {crumbs.map((crumb, index) => <span key={crumb.path || "root"}>
      {index > 0 && <Icon name="chevron-right"/>}
      <button type="button" title={crumb.path === "" ? "Workspace root" : crumb.path} aria-current={index === crumbs.length - 1 ? "location" : undefined} onClick={() => onNavigate(crumb.path)}>{crumb.label}</button>
    </span>)}
  </nav>;
}

export interface WorkspaceFileTreeProps {
  readonly entriesByDirectory: Readonly<Record<string, readonly FileTreeEntry[]>>;
  readonly expandedPaths: readonly string[];
  readonly loadingPaths: readonly string[];
  readonly errors: Readonly<Record<string, string>>;
  readonly selectedPath: string | undefined;
  readonly currentDirectory: string;
  readonly onToggleDirectory: (entry: FileTreeEntry) => void;
  readonly onSelectFile: (entry: FileTreeEntry) => void;
  readonly onRetryDirectory: (path: string) => void;
}

export function WorkspaceFileTree({ entriesByDirectory, expandedPaths, loadingPaths, errors, selectedPath, currentDirectory, onToggleDirectory, onSelectFile, onRetryDirectory }: WorkspaceFileTreeProps) {
  const renderDirectory = (path: string, depth: number): React.ReactNode => sortFileEntries(entriesByDirectory[path] ?? []).map(entry => {
    const directory = entry.type === "directory";
    const expanded = expandedPaths.includes(entry.path);
    const selected = selectedPath === entry.path;
    const current = directory && currentDirectory === entry.path;
    return <div className="rw-file-node" key={entry.path} role="none">
      <button
        type="button"
        role="treeitem"
        aria-level={depth + 1}
        aria-expanded={directory ? expanded : undefined}
        aria-selected={directory ? current : selected}
        className={"rw-file-row" + (selected ? " selected" : "") + (current ? " current-directory" : "")}
        style={{ "--depth": depth } as React.CSSProperties}
        title={entry.path}
        onClick={() => directory ? onToggleDirectory(entry) : onSelectFile(entry)}
      >
        <span className={"rw-tree-disclosure" + (directory ? "" : " empty")}>{directory && <Icon name={expanded ? "chevron-down" : "chevron-right"}/>}</span>
        <WorkspaceEntryIcon entry={entry} open={expanded}/>
        <span className="rw-file-name">{entry.name}</span>
        {loadingPaths.includes(entry.path) && <small className="rw-file-meta">Loading…</small>}
        {!directory && entry.size !== undefined && <small className="rw-file-meta">{formatFileSize(entry.size)}</small>}
      </button>
      {directory && expanded && <>
        {errors[entry.path] !== undefined && <div className="rw-file-node-error" role="alert"><span>{errors[entry.path]}</span><button type="button" onClick={() => onRetryDirectory(entry.path)}>Retry</button></div>}
        {renderDirectory(entry.path, depth + 1)}
      </>}
    </div>;
  });

  const rootEntries = entriesByDirectory[""] ?? [];
  if (rootEntries.length === 0) return null;
  return <div className="rw-file-tree-list" role="tree" aria-label="Workspace files">{renderDirectory("", 0)}</div>;
}
