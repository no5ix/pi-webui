import type { FileTreeEntry } from "../api";
import { Icon } from "./icons";

interface Props {
  entriesByDirectory: Readonly<Record<string, readonly FileTreeEntry[]>>;
  expandedPaths: ReadonlySet<string>;
  loadingPaths: ReadonlySet<string>;
  selectedPath: string | undefined;
  onToggleDirectory: (entry: FileTreeEntry) => void;
  onSelectFile: (entry: FileTreeEntry) => void;
}

export function WorkspaceFileTree({ entriesByDirectory, expandedPaths, loadingPaths, selectedPath, onToggleDirectory, onSelectFile }: Props) {
  const renderDirectory = (path: string, depth: number): React.ReactNode => {
    const entries = [...(entriesByDirectory[path] ?? [])]
      .sort((left, right) => Number(right.type === "directory") - Number(left.type === "directory") || left.name.localeCompare(right.name));
    return entries.map(entry => {
      const directory = entry.type === "directory";
      const expanded = expandedPaths.has(entry.path);
      return <div key={entry.path}>
        <button className={selectedPath === entry.path ? "selected" : ""} style={{ paddingLeft: 7 + depth * 14 }} title={entry.path} onClick={() => directory ? onToggleDirectory(entry) : onSelectFile(entry)}>
          <Icon name={directory ? expanded ? "chevron-down" : "chevron-right" : "file-text"}/><span>{entry.name}</span>{loadingPaths.has(entry.path) && <small>Loading…</small>}
        </button>
        {directory && expanded && renderDirectory(entry.path, depth + 1)}
      </div>;
    });
  };
  return <div className="rw-file-tree-list">{renderDirectory("", 0)}</div>;
}
