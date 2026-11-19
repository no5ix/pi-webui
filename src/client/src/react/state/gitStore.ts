import { pluginsApi, requestPluginBackend } from "../../api";
import { isRecord } from "../../../../shared/unknownValues";
import type { JsonValue } from "../../../../shared/pluginApiTypes";
import { createStore, idleRead, readFailed, useStoreSelect, type ReadState, type Store } from "./store";

/**
 * The Git page's read model.
 *
 * Today's Git page is the Git plugin's browser element, and the plugin's server
 * half answers exactly five operations — `status`, `diff`, `history`,
 * `commit-diff`, `worktree-add` — over the plugin backend route
 * `api[/machines/<machine>]/plugin-backends/git/projects/<project>/workspaces/<workspace>/<operation>`.
 * Four of them read. The fifth, `worktree-add`, is the only write PI WEB can
 * perform on a repository, and the panel offers it as such. There is no PI WEB
 * route that stages, discards, commits, fetches, pulls, pushes or checks out, so
 * those are named as unavailable in words instead of drawn as buttons that would
 * lie.
 *
 * A snapshot always carries the scope it was read for, so a page never renders
 * another workspace's branch, ahead/behind, history, or diff.
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

/** One commit, as the plugin's `history` answers it. */
export interface GitCommit {
  readonly id: string;
  readonly parentIds: readonly string[];
  readonly authorName: string;
  readonly authorEmail: string;
  readonly authoredAt: string;
  readonly subject: string;
}

export interface GitHistory {
  /** True when HEAD names no commit yet: a fresh repository is not an empty list. */
  readonly unborn: boolean;
  readonly commits: readonly GitCommit[];
  readonly nextCursor: string | undefined;
  readonly truncated: boolean;
}

export interface GitCommitDiff {
  readonly commit: GitCommit;
  /** A merge commit is compared against all its parents with Git's combined patch. */
  readonly combined: boolean;
  readonly diff: string;
  readonly truncated: boolean;
}

/** The only repository write the Git plugin's backend answers. */
export interface GitWorktreeRequest {
  readonly branch: string;
  readonly path: string;
  readonly createBranch: boolean;
}

export interface GitWorktree {
  readonly path: string;
  readonly branch: string;
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
  readonly history: ReadState<GitHistory>;
  /** History pages read so far, newest first; a page is appended, never replaced. */
  readonly commits: readonly GitCommit[];
  readonly nextCursor: string | undefined;
  readonly commitDiff: ReadState<GitCommitDiff>;
  readonly commitId: string | undefined;
  readonly worktree: ReadState<GitWorktree>;
}

export function gitDiffKey(path: string, staged: boolean): string {
  return `${path}\u0000${staged ? "staged" : "unstaged"}`;
}

const initialSnapshot: GitSnapshot = {
  scope: undefined,
  status: idleRead,
  diff: idleRead,
  diffKey: undefined,
  history: idleRead,
  commits: [],
  nextCursor: undefined,
  commitDiff: idleRead,
  commitId: undefined,
  worktree: idleRead,
};

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

/**
 * Reads the commit history.
 *
 * The plugin answers a page at a time with a cursor; `append` asks for the page
 * after the one on screen and joins it, so "older commits" grows the list the
 * reader is looking at instead of moving them somewhere else. The plugin's
 * history input is strict: the first page is asked for with a null input, and a
 * later page with `{ cursor }` — an empty object is refused. A failed page
 * leaves the rows already read in place and names the reason.
 */
export async function readGitHistory(scope: GitScope, options: { append?: boolean } = {}): Promise<void> {
  const append = options.append === true;
  const cursor = append ? gitStore.get().nextCursor : undefined;
  if (append && cursor === undefined) return;
  if (!append) {
    gitStore.update((current) => ({
      ...current,
      scope,
      history: { value: sameScope(current, scope) ? current.history.value : undefined, phase: "loading", error: undefined },
    }));
  }
  try {
    const answer = await callGitBackend(scope, gitOperations.history, cursor === undefined ? null : { cursor });
    const history = parseGitHistory(answer);
    gitStore.update((current) => ({
      ...current,
      scope,
      commits: append ? [...current.commits, ...history.commits] : history.commits,
      nextCursor: history.nextCursor,
      history: { value: history, phase: "ready", error: undefined },
    }));
  } catch (error) {
    const failure = readFailed(error);
    gitStore.update((current) => ({
      ...current,
      scope,
      history: { value: sameScope(current, scope) ? current.history.value : undefined, phase: "failed", error: failure.error },
    }));
  }
}

/** Reads one commit's patch. The commit id travels with the request it answers. */
export function selectGitCommit(scope: GitScope, id: string): void {
  gitStore.update((current) => ({
    ...current,
    scope,
    commitId: id,
    commitDiff: { value: current.commitId === id ? current.commitDiff.value : undefined, phase: "loading", error: undefined },
  }));
  void runGitCommitDiff(scope, id);
}

/**
 * Adds a linked worktree: the repository write the Git plugin backend performs.
 *
 * The answer comes back as the reason a caller states, so a form can show it
 * beside the fields the reader typed, and the store keeps the created worktree
 * for the scope it was created in.
 */
export async function addGitWorktree(scope: GitScope, request: GitWorktreeRequest): Promise<string | undefined> {
  gitStore.update((current) => ({ ...current, scope, worktree: { value: undefined, phase: "loading", error: undefined } }));
  try {
    const answer = await callGitBackend(scope, gitOperations.worktreeAdd, {
      branch: request.branch,
      path: request.path,
      createBranch: request.createBranch,
    });
    const worktree = parseGitWorktree(answer);
    gitStore.update((current) => ({ ...current, scope, worktree: { value: worktree, phase: "ready", error: undefined } }));
    return undefined;
  } catch (error) {
    const failure = readFailed(error);
    gitStore.update((current) => ({ ...current, scope, worktree: { value: undefined, phase: "failed", error: failure.error } }));
    return failure.error ?? "The Git plugin did not answer.";
  }
}

async function runGitCommitDiff(scope: GitScope, id: string): Promise<void> {
  try {
    const answer = await callGitBackend(scope, gitOperations.commitDiff, { id });
    const commitDiff = parseGitCommitDiff(answer);
    gitStore.update((current) => (current.commitId === id ? { ...current, commitDiff: { value: commitDiff, phase: "ready", error: undefined } } : current));
  } catch (error) {
    const failure = readFailed(error);
    gitStore.update((current) => (current.commitId === id ? { ...current, commitDiff: { value: undefined, phase: "failed", error: failure.error } } : current));
  }
}

export function parseGitHistory(value: unknown): GitHistory {
  if (!isRecord(value)) throw new Error("The Git history answer was not an object.");
  return {
    unborn: requireBoolean(value, "unborn"),
    commits: requireArray(value, "commits").map(parseGitCommit),
    nextCursor: optionalString(value, "nextCursor"),
    truncated: requireBoolean(value, "truncated"),
  };
}

export function parseGitCommitDiff(value: unknown): GitCommitDiff {
  if (!isRecord(value)) throw new Error("The Git commit diff answer was not an object.");
  return {
    commit: parseGitCommit(requireRecord(value, "commit")),
    combined: requireBoolean(value, "combined"),
    diff: requireString(value, "diff"),
    truncated: requireBoolean(value, "truncated"),
  };
}

export function parseGitWorktree(value: unknown): GitWorktree {
  if (!isRecord(value)) throw new Error("The Git worktree answer was not an object.");
  return { path: requireString(value, "path"), branch: requireString(value, "branch") };
}

function parseGitCommit(value: unknown): GitCommit {
  if (!isRecord(value)) throw new Error("A Git commit entry was not an object.");
  return {
    id: requireString(value, "id"),
    parentIds: requireArray(value, "parentIds").filter((parent): parent is string => typeof parent === "string"),
    authorName: requireString(value, "authorName"),
    authorEmail: requireString(value, "authorEmail"),
    authoredAt: requireString(value, "authoredAt"),
    subject: requireString(value, "subject"),
  };
}

function requireRecord(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key];
  if (!isRecord(value)) throw new Error(`The Git answer is missing ${key}.`);
  return value;
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
