import { pluginsApi, requestPluginBackend } from "../../api";
import { isRecord } from "../../../../shared/unknownValues";
import type { JsonValue } from "../../../../shared/pluginApiTypes";
import { createStore, idleRead, readFailed, useStoreSelect, type ReadState, type Store } from "./store";

/**
 * The Git page's read model.
 *
 * Today's Git page is the Git plugin's browser element, and the plugin's server
 * half answers exactly four operations — `status`, `diff`, `history`,
 * `commit-diff` (plus `worktree-add`) — over the plugin backend route
 * `api[/machines/<machine>]/plugin-backends/git/projects/<project>/workspaces/<workspace>/<operation>`.
 * There is no PI WEB route that stages, discards, commits, fetches, pulls,
 * pushes or checks out: the plugin runs `git` read-only and the product never
 * offered a write. This store therefore reads, and the panel states plainly
 * that writes have no endpoint, instead of drawing buttons that would lie.
 *
 * A snapshot always carries the scope it was read for, so a page never renders
 * another workspace's branch, ahead/behind, or diff.
 */

/** The Git plugin's catalog id; the backend route addresses the plugin by it. */
export const gitPluginId = "git";

/** The operations the Git plugin's backend answers, and nothing else. */
export const gitOperations = {
  status: "status",
  diff: "diff",
  history: "history",
  commitDiff: "commit-diff",
  worktreeAdd: "worktree-add",
} as const;

/** Why a Git write command cannot run: stated once, reused by every caller. */
export const gitWriteUnavailableReason =
  "The Git plugin answers status, diff, history and worktree-add only; PI WEB has no endpoint that stages, discards, commits, fetches, pulls, pushes or switches branches.";

export interface GitScope {
  readonly machineId: string;
  readonly projectId: string;
  readonly workspaceId: string;
}

export type GitFileState =
  | "unmodified"
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "copied"
  | "untracked"
  | "ignored"
  | "conflicted";

const gitFileStates: readonly GitFileState[] = ["unmodified", "modified", "added", "deleted", "renamed", "copied", "untracked", "ignored", "conflicted"];

export interface GitStatusFile {
  readonly path: string;
  readonly oldPath: string | undefined;
  readonly index: GitFileState;
  readonly workingTree: GitFileState;
}

export interface GitStatus {
  readonly isGitRepo: boolean;
  readonly branch: string | undefined;
  readonly upstream: string | undefined;
  readonly ahead: number | undefined;
  readonly behind: number | undefined;
  readonly files: readonly GitStatusFile[];
  readonly submodules: readonly string[];
}

export interface GitDiff {
  readonly path: string | undefined;
  readonly staged: boolean;
  readonly diff: string;
  readonly truncated: boolean;
}

/** Which list a changed file belongs to; one classifier so the panel groups, and the diff ask, agree. */
export type GitFileGroup = "staged" | "unstaged" | "untracked";

export function gitFileGroup(file: GitStatusFile): GitFileGroup {
  if (file.index === "untracked" || file.workingTree === "untracked") return "untracked";
  if (file.index !== "unmodified") return "staged";
  return "unstaged";
}

/** The diff a row asks for: a staged file is compared against HEAD, everything else against the index. */
export function gitFileDiffRequest(file: GitStatusFile): { path: string; staged: boolean } {
  return { path: file.path, staged: gitFileGroup(file) === "staged" };
}

export interface GitSnapshot {
  readonly scope: GitScope | undefined;
  readonly status: ReadState<GitStatus>;
  readonly diff: ReadState<GitDiff>;
  readonly diffKey: string | undefined;
}

export function gitDiffKey(path: string, staged: boolean): string {
  return `${path}\u0000${staged ? "staged" : "unstaged"}`;
}

const initialSnapshot: GitSnapshot = { scope: undefined, status: idleRead, diff: idleRead, diffKey: undefined };

const gitStore: Store<GitSnapshot> = createStore<GitSnapshot>(initialSnapshot);

function selectSelf(value: GitSnapshot): GitSnapshot {
  return value;
}

export function useGit(): GitSnapshot {
  return useStoreSelect(gitStore, selectSelf);
}



export function selectGitDiff(scope: GitScope, request: { path: string; staged: boolean }): void {
  const key = gitDiffKey(request.path, request.staged);
  gitStore.update((current) => ({
    ...current,
    scope,
    diffKey: key,
    diff: { value: current.diffKey === key ? current.diff.value : undefined, phase: "loading", error: undefined },
  }));
  void runGitDiff(scope, request, key);
}

/**
 * Reads the worktree's status. The plugin's status operation accepts a null
 * input and rejects an object, so nothing is sent for it; a failure keeps the
 * last answer for the same scope and states the reason.
 */
export async function readGitStatus(scope: GitScope): Promise<void> {
  gitStore.update((current) => ({
    ...current,
    scope,
    status: { value: sameScope(current, scope) ? current.status.value : undefined, phase: "loading", error: undefined },
  }));
  try {
    const answer = await callGitBackend(scope, gitOperations.status, null);
    const status = parseGitStatus(answer);
    gitStore.update((current) => ({ ...current, scope, status: { value: status, phase: "ready", error: undefined } }));
  } catch (error) {
    gitStore.update((current) => ({
      ...current,
      scope,
      status: { value: sameScope(current, scope) ? current.status.value : undefined, phase: "failed", error: readFailed(error).error },
    }));
  }
}

async function runGitDiff(scope: GitScope, request: { path: string; staged: boolean }, key: string): Promise<void> {
  try {
    const answer = await callGitBackend(scope, gitOperations.diff, { path: request.path, staged: request.staged });
    const diff = parseGitDiff(answer);
    gitStore.update((current) => (current.diffKey === key ? { ...current, diff: { value: diff, phase: "ready", error: undefined } } : current));
  } catch (error) {
    const failure = readFailed(error);
    gitStore.update((current) => (current.diffKey === key ? { ...current, diff: { value: undefined, phase: "failed", error: failure.error } } : current));
  }
}

function sameScope(current: GitSnapshot, scope: GitScope): boolean {
  const previous = current.scope;
  return previous?.machineId === scope.machineId && previous.projectId === scope.projectId && previous.workspaceId === scope.workspaceId;
}

/** The plugin backend needs the revision of the server plugin that is live on the machine. */
export async function gitBackendRevision(machineId: string): Promise<string> {
  const catalog = await pluginsApi.plugins(machineId);
  const entry = catalog.plugins.find((plugin) => plugin.id === gitPluginId);
  if (entry === undefined) throw new Error(`The Git plugin is not installed on machine ${machineId}.`);
  if (!entry.enabled) throw new Error("The Git plugin is disabled on this machine.");
  const revision = entry.server?.activeRevision;
  if (revision === undefined) throw new Error("The Git plugin's server backend has not started on this machine.");
  return revision;
}

async function callGitBackend(scope: GitScope, operation: string, input: JsonValue): Promise<unknown> {
  const backendRevision = await gitBackendRevision(scope.machineId);
  return requestPluginBackend(
    { pluginId: gitPluginId, backendRevision, machineId: scope.machineId, projectId: scope.projectId, workspaceId: scope.workspaceId },
    operation,
    input,
  );
}

function parseGitStatus(value: unknown): GitStatus {
  if (!isRecord(value)) throw new Error("The Git status answer was not an object.");
  const isGitRepo = requireBoolean(value, "isGitRepo");
  const files = requireArray(value, "files").map(parseGitStatusFile);
  const submodules = requireArray(value, "submodules").filter((item): item is string => typeof item === "string");
  return {
    isGitRepo,
    branch: optionalString(value, "branch"),
    upstream: optionalString(value, "upstream"),
    ahead: optionalNumber(value, "ahead"),
    behind: optionalNumber(value, "behind"),
    files,
    submodules,
  };
}

function parseGitStatusFile(value: unknown): GitStatusFile {
  if (!isRecord(value)) throw new Error("A Git status file entry was not an object.");
  return {
    path: requireString(value, "path"),
    oldPath: optionalString(value, "oldPath"),
    index: requireFileState(value, "index"),
    workingTree: requireFileState(value, "workingTree"),
  };
}

function parseGitDiff(value: unknown): GitDiff {
  if (!isRecord(value)) throw new Error("The Git diff answer was not an object.");
  return {
    path: optionalString(value, "path"),
    staged: requireBoolean(value, "staged"),
    diff: requireString(value, "diff"),
    truncated: requireBoolean(value, "truncated"),
  };
}

function requireFileState(record: Record<string, unknown>, key: string): GitFileState {
  const value = record[key];
  const state = gitFileStates.find((candidate) => candidate === value);
  if (state === undefined) throw new Error(`Git ${key} has an unknown state.`);
  return state;
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") throw new Error(`The Git answer is missing ${key}.`);
  return value;
}

function requireBoolean(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  if (typeof value !== "boolean") throw new Error(`The Git answer is missing ${key}.`);
  return value;
}

function requireArray(record: Record<string, unknown>, key: string): readonly unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) throw new Error(`The Git answer is missing ${key}.`);
  return value;
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function optionalNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" ? value : undefined;
}
