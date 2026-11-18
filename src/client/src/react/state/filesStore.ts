import { workspacesApi } from "../../api/clients";
import { isRecord } from "../../../../shared/unknownValues";
import { createStore, readFailed, useStoreSelect, type ReadState } from "./store";

/**
 * The files surface's reads.
 *
 * The tree is read a directory at a time, so a deep workspace is not pulled
 * whole; a file's content is read when it is opened. Every entry keeps the scope
 * it was fetched for (machine, project, workspace), because a file list read for
 * one workspace must never render inside another.
 */
export interface FileScope {
  readonly machineId: string;
  readonly projectId: string;
  readonly workspaceId: string;
}

export interface FileNode {
  readonly name: string;
  readonly path: string;
  readonly directory: boolean;
}

export interface OpenFile {
  readonly path: string;
  readonly scope: FileScope;
  readonly read: ReadState<string>;
  readonly content: string;
  readonly baseline: string;
  readonly saving: boolean;
  readonly savedAt: number | undefined;
}

export interface FilesState {
  readonly scope: FileScope | undefined;
  readonly trees: Readonly<Record<string, ReadState<readonly FileNode[]>>>;
  readonly expanded: readonly string[];
  readonly open: OpenFile | undefined;
  readonly filter: string;
}

export const filesStore = createStore<FilesState>({ scope: undefined, trees: {}, expanded: [], open: undefined, filter: "" });

export function useFiles(): FilesState {
  return useStoreSelect(filesStore, (value) => value);
}

export function setFileFilter(filter: string): void {
  filesStore.update((current) => ({ ...current, filter }));
}

export function toggleDirectory(path: string): void {
  filesStore.update((current) => ({
    ...current,
    expanded: current.expanded.includes(path) ? current.expanded.filter((entry) => entry !== path) : [...current.expanded, path],
  }));
}

export async function readTree(scope: FileScope, path = ""): Promise<void> {
  const key = treeKey(scope, path);
  filesStore.update((current) => ({
    ...current,
    scope,
    trees: { ...current.trees, [key]: { value: current.trees[key]?.value, phase: "loading", error: undefined } },
  }));
  try {
    const answer = await workspacesApi.workspaceTree(scope.projectId, scope.workspaceId, path, scope.machineId);
    filesStore.update((current) => ({ ...current, trees: { ...current.trees, [key]: { value: nodesOf(answer), phase: "ready", error: undefined } } }));
  } catch (error) {
    filesStore.update((current) => ({ ...current, trees: { ...current.trees, [key]: readFailed(error) } }));
  }
}

export async function openFile(scope: FileScope, path: string): Promise<void> {
  filesStore.update((current) => ({
    ...current,
    scope,
    open: { path, scope, read: { value: undefined, phase: "loading", error: undefined }, content: "", baseline: "", saving: false, savedAt: undefined },
  }));
  try {
    const answer = await workspacesApi.workspaceFile(scope.projectId, scope.workspaceId, path, scope.machineId);
    const content = contentOf(answer);
    if (content === undefined) {
      filesStore.update((current) => ({
        ...current,
        open: { path, scope, read: { value: undefined, phase: "refused", error: "This file is not text; PI WEB shows it read-only in the workspace panel." }, content: "", baseline: "", saving: false, savedAt: undefined },
      }));
      return;
    }
    filesStore.update((current) => ({
      ...current,
      open: { path, scope, read: { value: content, phase: "ready", error: undefined }, content, baseline: content, saving: false, savedAt: undefined },
    }));
  } catch (error) {
    filesStore.update((current) => ({
      ...current,
      open: { path, scope, read: readFailed(error), content: "", baseline: "", saving: false, savedAt: undefined },
    }));
  }
}

export function editFile(content: string): void {
  filesStore.update((current) => (current.open === undefined ? current : { ...current, open: { ...current.open, content } }));
}

export async function saveOpenFile(): Promise<void> {
  const open = filesStore.get().open;
  if (open?.read.phase !== "ready") return;
  filesStore.update((current) => (current.open === undefined ? current : { ...current, open: { ...current.open, saving: true } }));
  try {
    await workspacesApi.writeWorkspaceFile(open.scope.projectId, open.scope.workspaceId, open.path, open.content, undefined, open.scope.machineId);
    const at = Date.now();
    filesStore.update((current) =>
      current.open === undefined
        ? current
        : { ...current, open: { ...current.open, baseline: current.open.content, saving: false, savedAt: at, read: { value: current.open.content, phase: "ready", error: undefined } } },
    );
  } catch (error) {
    filesStore.update((current) => (current.open === undefined ? current : { ...current, open: { ...current.open, saving: false, read: readFailed(error) } }));
  }
}

export async function deleteFile(scope: FileScope, path: string): Promise<void> {
  await workspacesApi.deleteWorkspaceFile(scope.projectId, scope.workspaceId, path, scope.machineId);
  await readTree(scope, parentPath(path));
}

export async function moveFile(scope: FileScope, fromPath: string, toPath: string): Promise<void> {
  await workspacesApi.moveWorkspaceFile(scope.projectId, scope.workspaceId, fromPath, toPath, undefined, scope.machineId);
  await readTree(scope, parentPath(fromPath));
  filesStore.update((current) => (current.open?.path === fromPath ? { ...current, open: undefined } : current));
}

export function closeFile(): void {
  filesStore.update((current) => ({ ...current, open: undefined }));
}

export function sameScope(a: FileScope | undefined, b: FileScope): boolean {
  return a?.machineId === b.machineId && a.projectId === b.projectId && a.workspaceId === b.workspaceId;
}

function treeKey(scope: FileScope, path: string): string {
  return `${scope.machineId}|${scope.projectId}|${scope.workspaceId}|${path}`;
}

function parentPath(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

function nodesOf(answer: unknown): readonly FileNode[] {
  if (!isRecord(answer)) return [];
  const entries = answer["entries"];
  if (!Array.isArray(entries)) return [];
  const nodes: FileNode[] = [];
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const name = entry["name"];
    const path = entry["path"];
    if (typeof name !== "string" || typeof path !== "string") continue;
    const kind = entry["type"] ?? entry["kind"];
    const directory = kind === "directory" || kind === "dir" || entry["directory"] === true;
    nodes.push({ name, path, directory });
  }
  return nodes.sort((a, b) => (a.directory === b.directory ? a.name.localeCompare(b.name) : a.directory ? -1 : 1));
}

function contentOf(answer: unknown): string | undefined {
  if (!isRecord(answer)) return undefined;
  const content = answer["content"];
  if (typeof content === "string") return content;
  const encoding = answer["encoding"];
  if (encoding === "base64" || encoding === "binary") return undefined;
  return undefined;
}
