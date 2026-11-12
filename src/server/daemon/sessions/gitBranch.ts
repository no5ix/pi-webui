import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * The branch a working directory stands on, answered the way pi's footer data provider answers it.
 *
 * pi's own `FooterDataProvider` is not exported (the package's `exports` map blocks the deep
 * import), so pi's answer is mirrored here: `null` outside a repository, `"detached"` on a detached
 * HEAD, else the branch's name. `HEAD` is read from disk rather than asked of git, because a status
 * frame is published on the daemon's one loop and a `git rev-parse` per frame would put a process
 * spawn there.
 *
 * Two surfaces read this: pi's footer (through {@link extensionFooterData}) and the browser's status
 * bar, which shows the branch beside the token counts so a reader on a phone can tell which branch a
 * session is working before they type the next prompt.
 */
export function gitBranch(cwd: string): string | null {
  const paths = gitPaths(cwd);
  if (paths === undefined) return null;
  try {
    const head = readFileSync(paths.headPath, "utf8").trim();
    if (!head.startsWith(BRANCH_REF)) return "detached";
    const branch = head.slice(BRANCH_REF.length);
    return branch === REFTABLE_PLACEHOLDER ? branchFromGit(paths.repoDir) ?? "detached" : branch;
  } catch {
    return null;
  }
}

/**
 * The branch for a status frame: the same answer as {@link gitBranch}, kept for the short window in
 * which a run publishes many frames. A status is read on every runtime event, and a long run emits
 * them continuously, so reading `HEAD` per frame cost a directory walk and a file read each time.
 * A branch change is rare and a reader tolerates seeing it a moment late, so the answer is
 * refreshed at most once per {@link BRANCH_TTL_MS} per directory.
 */
export function cachedGitBranch(cwd: string): string | undefined {
  const now = Date.now();
  const fresh = branchCache.get(cwd);
  if (fresh !== undefined && now - fresh.readAtMs < BRANCH_TTL_MS) return fresh.branch ?? undefined;
  const branch = gitBranch(cwd);
  branchCache.set(cwd, { branch, readAtMs: now });
  evictStaleBranchReads();
  return branch ?? undefined;
}

const BRANCH_REF = "ref: refs/heads/";
/** What a reftable repository's HEAD file names; its branch is only known to git itself. */
const REFTABLE_PLACEHOLDER = ".invalid";
const GIT_ANSWER_MS = 2_000;
const BRANCH_TTL_MS = 2_000;
/** One entry per live session's working directory; the ceiling keeps a long-lived daemon bounded. */
const BRANCH_CACHE_LIMIT = 128;

const branchCache = new Map<string, { readonly branch: string | null; readonly readAtMs: number }>();

function evictStaleBranchReads(): void {
  if (branchCache.size <= BRANCH_CACHE_LIMIT) return;
  const now = Date.now();
  for (const [cwd, read] of branchCache) {
    if (now - read.readAtMs >= BRANCH_TTL_MS) branchCache.delete(cwd);
  }
  while (branchCache.size > BRANCH_CACHE_LIMIT) {
    const oldest = branchCache.keys().next();
    if (oldest.done === true) return;
    branchCache.delete(oldest.value);
  }
}

/** pi's `findGitPaths`: the nearest `.git` up from `cwd`, a directory or a worktree's `gitdir:` file. */
function gitPaths(cwd: string): { readonly repoDir: string; readonly headPath: string } | undefined {
  for (let dir = cwd; ; dir = dirname(dir)) {
    const gitPath = join(dir, ".git");
    if (existsSync(gitPath)) return repositoryAt(dir, gitPath);
    if (dirname(dir) === dir) return undefined;
  }
}

function repositoryAt(repoDir: string, gitPath: string): { readonly repoDir: string; readonly headPath: string } | undefined {
  try {
    const gitDir = statSync(gitPath).isDirectory() ? gitPath : linkedGitDir(repoDir, gitPath);
    if (gitDir === undefined) return undefined;
    const headPath = join(gitDir, "HEAD");
    return existsSync(headPath) ? { repoDir, headPath } : undefined;
  } catch {
    return undefined;
  }
}

function linkedGitDir(repoDir: string, gitFile: string): string | undefined {
  const content = readFileSync(gitFile, "utf8").trim();
  return content.startsWith("gitdir: ") ? resolve(repoDir, content.slice("gitdir: ".length).trim()) : undefined;
}

/** As pi asks git for a reftable repository's branch; bounded, since it runs on the daemon's loop. */
function branchFromGit(repoDir: string): string | undefined {
  try {
    const branch = execFileSync("git", ["--no-optional-locks", "symbolic-ref", "--quiet", "--short", "HEAD"], {
      cwd: repoDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: GIT_ANSWER_MS,
    }).trim();
    return branch === "" ? undefined : branch;
  } catch {
    return undefined;
  }
}
