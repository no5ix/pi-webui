import type { FileTreeEntry } from "../api";

/**
 * The identity of the workspace a file listing belongs to. Every retained tree,
 * draft and search result travels with this key so a slow answer from a
 * workspace the reader already left can be dropped instead of shown.
 */
export interface WorkspaceFileScope {
  readonly machineId: string;
  readonly projectId: string;
  readonly workspaceId: string;
}

export function workspaceFileScopeKey(scope: WorkspaceFileScope | undefined): string {
  return scope === undefined ? "" : JSON.stringify([scope.machineId, scope.projectId, scope.workspaceId]);
}

export function sameWorkspaceFileScope(left: WorkspaceFileScope | undefined, right: WorkspaceFileScope | undefined): boolean {
  return workspaceFileScopeKey(left) === workspaceFileScopeKey(right);
}

/** The parent folder of a workspace-relative path; `""` is the workspace root. */
export function parentWorkspacePath(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

export function workspaceBaseName(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? path : path.slice(slash + 1);
}

export function joinWorkspacePath(parent: string, name: string): string {
  return parent === "" ? name : `${parent}/${name}`;
}

/** Every folder between the workspace root and `path`, root first (`""` included). */
export function folderAncestors(path: string): string[] {
  const ancestors = [""];
  if (path === "") return ancestors;
  const segments = path.split("/");
  for (let index = 0; index < segments.length; index += 1) {
    ancestors.push(segments.slice(0, index + 1).join("/"));
  }
  return ancestors;
}

export interface WorkspaceBreadcrumb {
  readonly label: string;
  readonly path: string;
}

/** Root first, then one crumb per folder. The last crumb is the current folder. */
export function workspaceBreadcrumbs(path: string, rootLabel: string): WorkspaceBreadcrumb[] {
  const root = { label: rootLabel === "" ? "Workspace" : rootLabel, path: "" };
  if (path === "") return [root];
  return [root, ...folderAncestors(path).slice(1).map(folder => ({
    label: workspaceBaseName(folder),
    path: folder,
  }))];
}

export type WorkspaceNameVerdict =
  | { readonly kind: "valid"; readonly name: string }
  | { readonly kind: "invalid"; readonly message: string };

const MAX_ENTRY_NAME_LENGTH = 255;

/**
 * Validate a single file or folder name entered by the reader. Names may
 * contain spaces, dots, unicode and shell punctuation; separators, traversal
 * segments and control characters are refused before a request is made.
 */
function containsControlCharacter(name: string): boolean {
  for (const character of name) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

export function validateWorkspaceEntryName(raw: string): WorkspaceNameVerdict {
  const name = raw.trim();
  if (name === "") return { kind: "invalid", message: "Enter a name." };
  if (name === "." || name === "..") return { kind: "invalid", message: "A name cannot be . or .." };
  if (name.includes("/") || name.includes("\\")) return { kind: "invalid", message: "A name cannot contain path separators." };
  if (name.startsWith("~")) return { kind: "invalid", message: "A name cannot start with ~." };
  if (containsControlCharacter(name)) return { kind: "invalid", message: "A name cannot contain control characters." };
  if (name.length > MAX_ENTRY_NAME_LENGTH) return { kind: "invalid", message: `A name cannot be longer than ${String(MAX_ENTRY_NAME_LENGTH)} characters.` };
  return { kind: "valid", name };
}

/**
 * Whether a path produced by this client may be sent as a workspace-relative
 * path. Absolute paths and traversal segments are refused; the workspace HTTP
 * boundary repeats the check because this one is not a security boundary.
 */
export function isSafeWorkspaceRelativePath(path: string): boolean {
  if (path === "" || path.startsWith("/") || path.startsWith("\\")) return false;
  if (/^[a-zA-Z]:[\\/]/.test(path)) return false;
  if (path.includes("\u0000") || path.includes("\\")) return false;
  return path.split("/").every(segment => segment !== "" && segment !== "." && segment !== "..");
}

/** Names already present in a listing, used to explain a duplicate before the request. */
export function listingHasName(entries: readonly FileTreeEntry[] | undefined, name: string, exceptPath?: string): boolean {
  return (entries ?? []).some(entry => entry.name === name && entry.path !== exceptPath);
}

export type WorkspaceEntryKind = "directory" | "text" | "code" | "markdown" | "json" | "image" | "archive" | "config" | "other";

const CODE_EXTENSIONS = new Set(["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts", "py", "rs", "go", "c", "h", "cpp", "hpp", "java", "rb", "php", "swift", "kt", "kts", "sh", "bash", "zsh", "fish", "sql", "css", "scss", "sass", "less", "html", "htm", "xml", "svg", "vue", "svelte", "lua", "pl", "r", "dart", "cs", "fs"]);
const CONFIG_EXTENSIONS = new Set(["toml", "ini", "conf", "cfg", "env", "properties"]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico", "tiff"]);
const ARCHIVE_EXTENSIONS = new Set(["zip", "tar", "gz", "tgz", "bz2", "xz", "7z", "rar", "jar", "whl"]);
const TEXT_EXTENSIONS = new Set(["txt", "log", "csv", "tsv", "rst", "adoc"]);

export function workspaceEntryKind(entry: Pick<FileTreeEntry, "name" | "type">): WorkspaceEntryKind {
  if (entry.type === "directory") return "directory";
  const lower = entry.name.toLowerCase();
  if (lower === "dockerfile" || lower === "makefile" || lower === ".gitignore" || lower === ".npmrc" || lower === ".editorconfig") return "config";
  const extension = lower.includes(".") ? lower.split(".").pop() ?? "" : "";
  if (extension === "md" || extension === "mdx") return "markdown";
  if (extension === "json" || extension === "jsonc") return "json";
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (ARCHIVE_EXTENSIONS.has(extension)) return "archive";
  if (CODE_EXTENSIONS.has(extension)) return "code";
  if (CONFIG_EXTENSIONS.has(extension) || lower.startsWith(".")) return "config";
  if (TEXT_EXTENSIONS.has(extension)) return "text";
  return "other";
}

export function sortFileEntries(entries: readonly FileTreeEntry[]): FileTreeEntry[] {
  return [...entries].sort((left, right) => {
    const leftDirectory = left.type === "directory" ? 0 : 1;
    const rightDirectory = right.type === "directory" ? 0 : 1;
    if (leftDirectory !== rightDirectory) return leftDirectory - rightDirectory;
    return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
  });
}

export function filterFileEntries(entries: readonly FileTreeEntry[], query: string): FileTreeEntry[] {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === "") return sortFileEntries(entries);
  return sortFileEntries(entries.filter(entry => entry.name.toLocaleLowerCase().includes(needle) || entry.path.toLocaleLowerCase().includes(needle)));
}

export function formatFileSize(bytes: number | undefined): string {
  if (bytes === undefined) return "";
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type WorkspaceSaveOutcome = "saved" | "unchanged" | "conflict" | "failed";

export interface WorkspaceSaveSummary {
  readonly saved: number;
  readonly failed: number;
  readonly conflicts: number;
}

export function combineSaveOutcomes(outcomes: readonly WorkspaceSaveOutcome[]): WorkspaceSaveSummary {
  return {
    saved: outcomes.filter(outcome => outcome === "saved").length,
    failed: outcomes.filter(outcome => outcome === "failed").length,
    conflicts: outcomes.filter(outcome => outcome === "conflict").length,
  };
}

export interface WorkspaceEditableFile {
  readonly content: string;
  readonly savedContent: string;
  readonly binary: boolean;
  readonly truncated: boolean;
  readonly loading: boolean;
}

/** Whether an open file holds edits that a save would actually write. */
export function workspaceFileIsDirty(file: WorkspaceEditableFile): boolean {
  return !file.loading && !file.binary && !file.truncated && file.content !== file.savedContent;
}

/** The open editor tab's label: the base name, plus an optional parent hint. */
export function workspaceTabLabel(path: string, paths: readonly string[]): string {
  const name = workspaceBaseName(path);
  const sameName = paths.filter(candidate => workspaceBaseName(candidate) === name);
  if (sameName.length < 2) return name;
  return `${name} — ${parentWorkspacePath(path) || "root"}`;
}

export function downloadFileName(path: string): string {
  const name = workspaceBaseName(path);
  return name === "" ? "download" : name;
}
