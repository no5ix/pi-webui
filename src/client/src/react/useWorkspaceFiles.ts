import { useCallback, useEffect, useRef, useState } from "react";
import { filesApi, workspacesApi, type FileSuggestion, type FileTreeEntry } from "../api";
import {
  combineSaveOutcomes,
  folderAncestors,
  isSafeWorkspaceRelativePath,
  joinWorkspacePath,
  listingHasName,
  parentWorkspacePath,
  sameWorkspaceFileScope,
  validateWorkspaceEntryName,
  workspaceFileIsDirty,
  workspaceFileScopeKey,
  type WorkspaceFileScope,
  type WorkspaceSaveOutcome,
  type WorkspaceSaveSummary,
} from "./workspaceFiles";

export interface ExternalFileChange {
  readonly modifiedAt: string;
  readonly content: string | null;
}

export interface OpenWorkspaceFile {
  readonly path: string;
  readonly content: string;
  readonly savedContent: string;
  readonly modifiedAt: string;
  readonly size: number;
  readonly binary: boolean;
  readonly truncated: boolean;
  readonly loading: boolean;
  readonly error: string | undefined;
  readonly externalChange: ExternalFileChange | undefined;
  readonly saveState: "idle" | "saving" | "failed";
  readonly saveError: string | undefined;
}

export interface WorkspaceFileNotice {
  readonly kind: "success" | "error";
  readonly text: string;
}

export interface WorkspaceFileTreeState {
  readonly entries: Readonly<Record<string, readonly FileTreeEntry[]>>;
  readonly expanded: readonly string[];
  readonly loading: readonly string[];
  readonly errors: Readonly<Record<string, string>>;
  readonly truncated: Readonly<Record<string, boolean>>;
  readonly loaded: readonly string[];
}

export interface WorkspaceFileSearchState {
  readonly query: string;
  readonly results: readonly FileSuggestion[];
  readonly loading: boolean;
  readonly error: string | undefined;
}

export interface WorkspaceFilesApi {
  readonly tree: WorkspaceFileTreeState;
  readonly currentDirectory: string;
  readonly openFiles: readonly OpenWorkspaceFile[];
  readonly activePath: string | undefined;
  readonly activeFile: OpenWorkspaceFile | undefined;
  readonly dirtyPaths: readonly string[];
  readonly hasUnsavedChanges: boolean;
  readonly search: WorkspaceFileSearchState;
  readonly notice: WorkspaceFileNotice | undefined;
  readonly refreshing: boolean;
  readonly busy: string | undefined;
  readonly setSearchQuery: (query: string) => void;
  readonly setCurrentDirectory: (path: string) => void;
  readonly refresh: () => Promise<void>;
  readonly toggleDirectory: (path: string) => Promise<void>;
  readonly retryDirectory: (path: string) => Promise<void>;
  readonly openFile: (path: string) => Promise<void>;
  readonly activateFile: (path: string) => void;
  readonly closeFile: (path: string) => void;
  readonly retryFile: (path: string) => Promise<void>;
  readonly changeDraft: (path: string, content: string) => void;
  readonly saveFile: (path: string, options?: { readonly force?: boolean }) => Promise<WorkspaceSaveOutcome>;
  readonly saveAll: () => Promise<WorkspaceSaveSummary>;
  readonly reloadFile: (path: string) => Promise<void>;
  readonly keepLocalChanges: (path: string) => void;
  readonly discardDraft: (path: string) => void;
  readonly discardAll: () => void;
  readonly createFile: (directory: string, name: string) => Promise<{ readonly ok: boolean; readonly error?: string; readonly path?: string }>;
  readonly renameFile: (path: string, name: string) => Promise<{ readonly ok: boolean; readonly error?: string; readonly path?: string }>;
  readonly deleteFile: (path: string) => Promise<{ readonly ok: boolean; readonly error?: string }>;
  readonly uploadFiles: (directory: string, files: readonly File[]) => Promise<{ readonly uploaded: number; readonly failures: readonly string[] }>;
  readonly clearNotice: () => void;
}

interface Options {
  readonly projectId: string | undefined;
  readonly workspaceId: string | undefined;
  readonly machineId: string;
  readonly refreshToken?: number;
}

const EMPTY_TREE: WorkspaceFileTreeState = { entries: {}, expanded: [], loading: [], errors: {}, truncated: {}, loaded: [] };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function addUnique(values: readonly string[], additions: readonly string[]): string[] {
  return [...new Set([...values, ...additions])];
}

/**
 * The React workspace file browser and editor's state. Every read, write and
 * search is bound to the machine/project/workspace it was started for and
 * carries a request generation, so a slow answer from another scope (or an
 * older save) can never settle over newer state. Drafts live in memory per
 * open path and are never replaced by a background read while they are dirty.
 */
export function useWorkspaceFiles({ projectId, workspaceId, machineId, refreshToken = 0 }: Options): WorkspaceFilesApi {
  const scope: WorkspaceFileScope | undefined = projectId === undefined || workspaceId === undefined
    ? undefined
    : { machineId, projectId, workspaceId };
  const scopeKey = workspaceFileScopeKey(scope);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const epochRef = useRef(0);
  const directoryRequests = useRef(new Map<string, number>());
  const fileRequests = useRef(new Map<string, number>());
  const saveRequests = useRef(new Map<string, number>());
  const searchRequest = useRef(0);

  const [tree, setTree] = useState<WorkspaceFileTreeState>(EMPTY_TREE);
  const [currentDirectory, setCurrentDirectoryState] = useState("");
  const [openFiles, setOpenFiles] = useState<readonly OpenWorkspaceFile[]>([]);
  const [activePath, setActivePathState] = useState<string>();
  const [searchQuery, setSearchQueryState] = useState("");
  const [search, setSearch] = useState<WorkspaceFileSearchState>({ query: "", results: [], loading: false, error: undefined });
  const [notice, setNotice] = useState<WorkspaceFileNotice>();
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string>();

  const openFilesRef = useRef(openFiles);
  openFilesRef.current = openFiles;
  const activePathRef = useRef(activePath);
  activePathRef.current = activePath;
  const treeRef = useRef(tree);
  treeRef.current = tree;
  const currentDirectoryRef = useRef(currentDirectory);
  currentDirectoryRef.current = currentDirectory;

  const scopeIsCurrent = (candidate: WorkspaceFileScope, epoch: number) => sameWorkspaceFileScope(candidate, scopeRef.current) && epoch === epochRef.current;

  const updateFile = (path: string, update: (file: OpenWorkspaceFile) => OpenWorkspaceFile) => {
    setOpenFiles(current => current.map(file => file.path === path ? update(file) : file));
  };

  const readDirectory = useCallback(async (target: WorkspaceFileScope, epoch: number, path: string, options?: { readonly quiet?: boolean }) => {
    if (!scopeIsCurrent(target, epoch)) return;
    const requestId = (directoryRequests.current.get(path) ?? 0) + 1;
    directoryRequests.current.set(path, requestId);
    if (options?.quiet !== true) {
      setTree(current => ({ ...current, loading: addUnique(current.loading, [path]), errors: withoutKey(current.errors, path) }));
    }
    try {
      const response = await workspacesApi.workspaceTree(target.projectId, target.workspaceId, path, target.machineId);
      if (!scopeIsCurrent(target, epoch) || directoryRequests.current.get(path) !== requestId) return;
      setTree(current => ({
        ...current,
        entries: { ...current.entries, [path]: response.entries },
        truncated: { ...current.truncated, [path]: response.truncated },
        errors: withoutKey(current.errors, path),
        loaded: addUnique(current.loaded, [path]),
      }));
    } catch (error) {
      if (!scopeIsCurrent(target, epoch) || directoryRequests.current.get(path) !== requestId) return;
      setTree(current => ({
        ...current,
        errors: { ...current.errors, [path]: errorText(error) },
        loaded: addUnique(current.loaded, [path]),
      }));
    } finally {
      if (scopeIsCurrent(target, epoch) && directoryRequests.current.get(path) === requestId) {
        setTree(current => ({ ...current, loading: current.loading.filter(item => item !== path) }));
      }
    }
  }, []);

  const readOpenFile = useCallback(async (target: WorkspaceFileScope, epoch: number, path: string, mode: "load" | "external" = "load") => {
    if (!scopeIsCurrent(target, epoch)) return;
    if (mode === "load") {
      updateFile(path, file => ({ ...file, loading: true, error: undefined }));
    }
    const requestId = (fileRequests.current.get(path) ?? 0) + 1;
    fileRequests.current.set(path, requestId);
    try {
      const response = await workspacesApi.workspaceFile(target.projectId, target.workspaceId, path, target.machineId);
      if (!scopeIsCurrent(target, epoch) || fileRequests.current.get(path) !== requestId) return;
      setOpenFiles(current => current.map(file => {
        if (file.path !== path) return file;
        if (mode === "external") {
          if (file.modifiedAt === response.modifiedAt) return file;
          if (workspaceFileIsDirty(file)) {
            return { ...file, externalChange: { modifiedAt: response.modifiedAt, content: response.content } };
          }
          return { ...file, content: response.content, savedContent: response.content, modifiedAt: response.modifiedAt, size: response.size, binary: response.binary, truncated: response.truncated, error: undefined, externalChange: undefined };
        }
        return {
          ...file,
          content: response.content,
          savedContent: response.content,
          modifiedAt: response.modifiedAt,
          size: response.size,
          binary: response.binary,
          truncated: response.truncated,
          loading: false,
          error: undefined,
          externalChange: undefined,
        };
      }));
    } catch (error) {
      if (!scopeIsCurrent(target, epoch) || fileRequests.current.get(path) !== requestId) return;
      setOpenFiles(current => current.map(file => {
        if (file.path !== path) return file;
        if (mode === "external") {
          if (!workspaceFileIsDirty(file)) return { ...file, error: errorText(error) };
          return { ...file, externalChange: { modifiedAt: "", content: null } };
        }
        return { ...file, loading: false, error: errorText(error) };
      }));
    }
  }, []);

  useEffect(() => {
    epochRef.current += 1;
    const epoch = epochRef.current;
    directoryRequests.current.clear();
    fileRequests.current.clear();
    saveRequests.current.clear();
    searchRequest.current += 1;
    setTree(EMPTY_TREE);
    setOpenFiles([]);
    setActivePathState(undefined);
    setCurrentDirectoryState("");
    setSearchQueryState("");
    setSearch({ query: "", results: [], loading: false, error: undefined });
    setNotice(undefined);
    setBusy(undefined);
    if (scope === undefined) return;
    void readDirectory(scope, epoch, "");
  }, [machineId, projectId, workspaceId, readDirectory]);

  useEffect(() => {
    if (refreshToken === 0) return;
    const target = scopeRef.current;
    if (target === undefined) return;
    const epoch = epochRef.current;
    void Promise.all(addUnique([""], treeRef.current.expanded).map(path => readDirectory(target, epoch, path)));
  }, [refreshToken, readDirectory]);

  useEffect(() => {
    const query = searchQuery.trim();
    searchRequest.current += 1;
    const requestId = searchRequest.current;
    const target = scopeRef.current;
    const epoch = epochRef.current;
    if (query === "" || target === undefined) {
      setSearch({ query: "", results: [], loading: false, error: undefined });
      return;
    }
    setSearch(current => ({ query, results: current.query === query ? current.results : [], loading: true, error: undefined }));
    const timer = setTimeout(() => {
      void filesApi.files(query, { projectId: target.projectId, workspaceId: target.workspaceId, machineId: target.machineId, mode: "file", scope: "all" }).then(results => {
        if (requestId !== searchRequest.current || !scopeIsCurrent(target, epoch)) return;
        setSearch({ query, results, loading: false, error: undefined });
      }).catch((error: unknown) => {
        if (requestId !== searchRequest.current || !scopeIsCurrent(target, epoch)) return;
        setSearch({ query, results: [], loading: false, error: errorText(error) });
      });
    }, 220);
    return () => { clearTimeout(timer); };
  }, [searchQuery, scopeKey]);

  const refresh = useCallback(async () => {
    const target = scopeRef.current;
    if (target === undefined) return;
    const epoch = epochRef.current;
    setRefreshing(true);
    try {
      const paths = addUnique([""], treeRef.current.expanded);
      await Promise.all(paths.map(path => readDirectory(target, epoch, path, { quiet: false })));
      const open = openFilesRef.current.filter(file => !file.loading);
      await Promise.all(open.map(file => readOpenFile(target, epoch, file.path, "external")));
    } finally {
      if (scopeIsCurrent(target, epoch)) setRefreshing(false);
    }
  }, [readDirectory, readOpenFile]);

  const toggleDirectory = useCallback(async (path: string) => {
    const target = scopeRef.current;
    if (target === undefined) return;
    const epoch = epochRef.current;
    if (!isSafeWorkspaceRelativePath(path)) return;
    if (treeRef.current.expanded.includes(path)) {
      setTree(current => ({ ...current, expanded: current.expanded.filter(item => item !== path) }));
      if (currentDirectoryRef.current === path || currentDirectoryRef.current.startsWith(`${path}/`)) {
        setCurrentDirectoryState(parentWorkspacePath(path));
      }
      return;
    }
    setCurrentDirectoryState(path);
    setTree(current => ({
      ...current,
      expanded: addUnique(current.expanded, folderAncestors(path).slice(1)),
    }));
    if (!treeRef.current.loaded.includes(path) && !treeRef.current.loading.includes(path)) {
      await readDirectory(target, epoch, path);
    }
  }, [readDirectory]);

  const retryDirectory = useCallback(async (path: string) => {
    const target = scopeRef.current;
    if (target === undefined) return;
    await readDirectory(target, epochRef.current, path);
  }, [readDirectory]);

  const setCurrentDirectory = useCallback((path: string) => {
    if (path !== "" && !isSafeWorkspaceRelativePath(path)) return;
    setCurrentDirectoryState(path);
    setTree(current => ({ ...current, expanded: addUnique(current.expanded, folderAncestors(path).slice(1)) }));
    const target = scopeRef.current;
    if (target === undefined) return;
    const missing = folderAncestors(path).filter(folder => folder !== "" && !treeRef.current.loaded.includes(folder) && !treeRef.current.loading.includes(folder));
    if (missing.length === 0) return;
    const epoch = epochRef.current;
    void Promise.all(missing.map(folder => readDirectory(target, epoch, folder)));
  }, [readDirectory]);

  const openFile = useCallback(async (path: string) => {
    if (!isSafeWorkspaceRelativePath(path)) {
      setNotice({ kind: "error", text: "That file path is not inside this workspace." });
      return;
    }
    const existing = openFilesRef.current.find(file => file.path === path);
    if (existing !== undefined) {
      setActivePathState(path);
      return;
    }
    const target = scopeRef.current;
    if (target === undefined) return;
    const placeholder: OpenWorkspaceFile = {
      path, content: "", savedContent: "", modifiedAt: "", size: 0, binary: false, truncated: false,
      loading: true, error: undefined, externalChange: undefined, saveState: "idle", saveError: undefined,
    };
    setOpenFiles(current => current.some(file => file.path === path) ? current : [...current, placeholder]);
    setActivePathState(path);
    await readOpenFile(target, epochRef.current, path);
  }, [readOpenFile]);

  const activateFile = useCallback((path: string) => {
    setActivePathState(path);
  }, []);

  const closeFile = useCallback((path: string) => {
    fileRequests.current.set(path, (fileRequests.current.get(path) ?? 0) + 1);
    saveRequests.current.set(path, (saveRequests.current.get(path) ?? 0) + 1);
    setOpenFiles(current => {
      const index = current.findIndex(file => file.path === path);
      if (index === -1) return current;
      const remaining = current.filter(file => file.path !== path);
      if (activePathRef.current === path) {
        const next = remaining[Math.min(index, remaining.length - 1)];
        setActivePathState(next?.path);
      }
      return remaining;
    });
  }, []);

  const retryFile = useCallback(async (path: string) => {
    const target = scopeRef.current;
    if (target === undefined) return;
    await readOpenFile(target, epochRef.current, path);
  }, [readOpenFile]);

  const changeDraft = useCallback((path: string, content: string) => {
    setOpenFiles(current => current.map(file => file.path === path
      ? { ...file, content, saveError: undefined, saveState: file.saveState === "failed" ? "idle" : file.saveState }
      : file));
  }, []);

  const saveFile = useCallback(async (path: string, options?: { readonly force?: boolean }): Promise<WorkspaceSaveOutcome> => {
    const target = scopeRef.current;
    const before = openFilesRef.current.find(file => file.path === path);
    if (target === undefined || before === undefined || before.loading || before.binary || before.truncated) return "failed";
    if (!workspaceFileIsDirty(before)) return "unchanged";
    const epoch = epochRef.current;
    const contentAtStart = before.content;
    const generation = (saveRequests.current.get(path) ?? 0) + 1;
    saveRequests.current.set(path, generation);
    updateFile(path, file => ({ ...file, saveState: "saving", saveError: undefined }));
    try {
      if (options?.force !== true) {
        const latest = await workspacesApi.workspaceFile(target.projectId, target.workspaceId, path, target.machineId).catch(() => undefined);
        if (!scopeIsCurrent(target, epoch)) return "failed";
        if (latest === undefined) {
          updateFile(path, file => ({ ...file, saveState: "idle", externalChange: { modifiedAt: "", content: null } }));
          return "conflict";
        }
        if (latest.modifiedAt !== before.modifiedAt && latest.content !== before.savedContent) {
          updateFile(path, file => ({ ...file, saveState: "idle", externalChange: { modifiedAt: latest.modifiedAt, content: latest.content } }));
          return "conflict";
        }
      }
      const written = await workspacesApi.writeWorkspaceFile(target.projectId, target.workspaceId, path, contentAtStart, { overwrite: true }, target.machineId);
      if (!scopeIsCurrent(target, epoch) || saveRequests.current.get(path) !== generation) return "saved";
      updateFile(path, file => ({
        ...file,
        savedContent: contentAtStart,
        modifiedAt: written.modifiedAt,
        size: written.size,
        saveState: "idle",
        saveError: undefined,
        externalChange: undefined,
      }));
      return "saved";
    } catch (error) {
      if (!scopeIsCurrent(target, epoch) || saveRequests.current.get(path) !== generation) return "failed";
      updateFile(path, file => ({ ...file, saveState: "failed", saveError: errorText(error) }));
      return "failed";
    }
  }, []);

  const saveAll = useCallback(async (): Promise<WorkspaceSaveSummary> => {
    const paths = openFilesRef.current.filter(workspaceFileIsDirty).map(file => file.path);
    const outcomes: WorkspaceSaveOutcome[] = [];
    for (const path of paths) outcomes.push(await saveFile(path));
    const summary = combineSaveOutcomes(outcomes);
    if (summary.conflicts > 0) setNotice({ kind: "error", text: "Some files changed on disk. Resolve them before saving all." });
    else if (summary.failed > 0) setNotice({ kind: "error", text: `Saved ${String(summary.saved)} file${summary.saved === 1 ? "" : "s"}; ${String(summary.failed)} failed. Your drafts are kept.` });
    else if (summary.saved > 0) setNotice({ kind: "success", text: `Saved ${String(summary.saved)} file${summary.saved === 1 ? "" : "s"}.` });
    return summary;
  }, [saveFile]);

  const reloadFile = useCallback(async (path: string) => {
    const target = scopeRef.current;
    if (target === undefined) return;
    await readOpenFile(target, epochRef.current, path);
  }, [readOpenFile]);

  const keepLocalChanges = useCallback((path: string) => {
    updateFile(path, file => file.externalChange === undefined ? file : ({
      ...file,
      modifiedAt: file.externalChange.modifiedAt === "" ? file.modifiedAt : file.externalChange.modifiedAt,
      externalChange: undefined,
    }));
  }, []);

  const discardDraft = useCallback((path: string) => {
    updateFile(path, file => ({ ...file, content: file.savedContent, externalChange: undefined, saveError: undefined, saveState: "idle" }));
  }, []);

  const discardAll = useCallback(() => {
    setOpenFiles(current => current.map(file => ({ ...file, content: file.savedContent, externalChange: undefined, saveError: undefined, saveState: "idle" })));
  }, []);

  const clearNotice = useCallback(() => { setNotice(undefined); }, []);

  const setSearchQuery = useCallback((query: string) => { setSearchQueryState(query); }, []);

  const createFile = useCallback(async (directory: string, rawName: string) => {
    const target = scopeRef.current;
    if (target === undefined) return { ok: false, error: "Select a workspace first." };
    const verdict = validateWorkspaceEntryName(rawName);
    if (verdict.kind === "invalid") return { ok: false, error: verdict.message };
    if (directory !== "" && !isSafeWorkspaceRelativePath(directory)) return { ok: false, error: "That folder is not inside this workspace." };
    if (listingHasName(treeRef.current.entries[directory], verdict.name)) return { ok: false, error: `"${verdict.name}" already exists in this folder.` };
    const path = joinWorkspacePath(directory, verdict.name);
    if (!isSafeWorkspaceRelativePath(path)) return { ok: false, error: "That name would escape this workspace." };
    const epoch = epochRef.current;
    setBusy(`create:${path}`);
    try {
      await workspacesApi.writeWorkspaceFile(target.projectId, target.workspaceId, path, "", { createDirs: false, overwrite: false }, target.machineId);
      if (!scopeIsCurrent(target, epoch)) return { ok: false, error: "The workspace changed before the file was created." };
      setNotice({ kind: "success", text: `Created ${path}.` });
      await readDirectory(target, epoch, directory);
      await openFile(path);
      return { ok: true, path };
    } catch (error) {
      return { ok: false, error: errorText(error) };
    } finally {
      if (scopeIsCurrent(target, epoch)) setBusy(undefined);
    }
  }, [openFile, readDirectory]);

  const renameFile = useCallback(async (path: string, rawName: string) => {
    const target = scopeRef.current;
    if (target === undefined) return { ok: false, error: "Select a workspace first." };
    if (!isSafeWorkspaceRelativePath(path)) return { ok: false, error: "That file path is not inside this workspace." };
    const verdict = validateWorkspaceEntryName(rawName);
    if (verdict.kind === "invalid") return { ok: false, error: verdict.message };
    const directory = parentWorkspacePath(path);
    if (listingHasName(treeRef.current.entries[directory], verdict.name, path)) return { ok: false, error: `"${verdict.name}" already exists in this folder.` };
    const nextPath = joinWorkspacePath(directory, verdict.name);
    if (nextPath === path) return { ok: true, path };
    if (!isSafeWorkspaceRelativePath(nextPath)) return { ok: false, error: "That name would escape this workspace." };
    const epoch = epochRef.current;
    setBusy(`rename:${path}`);
    try {
      await workspacesApi.moveWorkspaceFile(target.projectId, target.workspaceId, path, nextPath, { createDirs: false, overwrite: false }, target.machineId);
      if (!scopeIsCurrent(target, epoch)) return { ok: false, error: "The workspace changed before the file was renamed." };
      setOpenFiles(current => current.map(file => file.path === path ? { ...file, path: nextPath } : file));
      setActivePathState(current => current === path ? nextPath : current);
      setNotice({ kind: "success", text: `Renamed to ${verdict.name}.` });
      await readDirectory(target, epoch, directory);
      return { ok: true, path: nextPath };
    } catch (error) {
      return { ok: false, error: errorText(error) };
    } finally {
      if (scopeIsCurrent(target, epoch)) setBusy(undefined);
    }
  }, [readDirectory]);

  const deleteFile = useCallback(async (path: string) => {
    const target = scopeRef.current;
    if (target === undefined) return { ok: false, error: "Select a workspace first." };
    if (!isSafeWorkspaceRelativePath(path)) return { ok: false, error: "That file path is not inside this workspace." };
    const epoch = epochRef.current;
    setBusy(`delete:${path}`);
    try {
      await workspacesApi.deleteWorkspaceFile(target.projectId, target.workspaceId, path, target.machineId);
      if (!scopeIsCurrent(target, epoch)) return { ok: false, error: "The workspace changed before the file was deleted." };
      closeFile(path);
      setNotice({ kind: "success", text: `Deleted ${path}.` });
      await readDirectory(target, epoch, parentWorkspacePath(path));
      return { ok: true };
    } catch (error) {
      return { ok: false, error: errorText(error) };
    } finally {
      if (scopeIsCurrent(target, epoch)) setBusy(undefined);
    }
  }, [closeFile, openFile, readDirectory]);

  const uploadFiles = useCallback(async (directory: string, files: readonly File[]) => {
    const target = scopeRef.current;
    if (target === undefined || files.length === 0) return { uploaded: 0, failures: [] };
    if (directory !== "" && !isSafeWorkspaceRelativePath(directory)) return { uploaded: 0, failures: ["That folder is not inside this workspace."] };
    const epoch = epochRef.current;
    setBusy("upload");
    const failures: string[] = [];
    let uploaded = 0;
    try {
      for (const file of files) {
        const verdict = validateWorkspaceEntryName(file.name);
        if (verdict.kind === "invalid") {
          failures.push(`${file.name}: ${verdict.message}`);
          continue;
        }
        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          await workspacesApi.writeWorkspaceFile(target.projectId, target.workspaceId, joinWorkspacePath(directory, verdict.name), bytes, { createDirs: true, overwrite: false }, target.machineId);
          if (!scopeIsCurrent(target, epoch)) return { uploaded, failures };
          uploaded += 1;
        } catch (error) {
          failures.push(`${file.name}: ${errorText(error)}`);
        }
      }
      if (scopeIsCurrent(target, epoch)) {
        setNotice(failures.length === 0
          ? { kind: "success", text: `Uploaded ${String(uploaded)} file${uploaded === 1 ? "" : "s"}.` }
          : { kind: "error", text: `Uploaded ${String(uploaded)}; ${String(failures.length)} failed. ${failures.join(" ")}` });
        await readDirectory(target, epoch, directory);
      }
      return { uploaded, failures };
    } finally {
      if (scopeIsCurrent(target, epoch)) setBusy(undefined);
    }
  }, [readDirectory]);

  useEffect(() => {
    const check = () => {
      const target = scopeRef.current;
      if (target === undefined || document.visibilityState === "hidden") return;
      const epoch = epochRef.current;
      for (const file of openFilesRef.current) {
        if (!file.loading) void readOpenFile(target, epoch, file.path, "external");
      }
    };
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [readOpenFile]);

  const activeFile = activePath === undefined ? undefined : openFiles.find(file => file.path === activePath);
  const dirtyPaths = openFiles.filter(workspaceFileIsDirty).map(file => file.path);

  return {
    tree,
    currentDirectory,
    openFiles,
    activePath,
    activeFile,
    dirtyPaths,
    hasUnsavedChanges: dirtyPaths.length > 0,
    search,
    notice,
    refreshing,
    busy,
    setSearchQuery,
    setCurrentDirectory,
    refresh,
    toggleDirectory,
    retryDirectory,
    openFile,
    activateFile,
    closeFile,
    retryFile,
    changeDraft,
    saveFile,
    saveAll,
    reloadFile,
    keepLocalChanges,
    discardDraft,
    discardAll,
    createFile,
    renameFile,
    deleteFile,
    uploadFiles,
    clearNotice,
  };
}

function withoutKey<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([entryKey]) => entryKey !== key));
}
