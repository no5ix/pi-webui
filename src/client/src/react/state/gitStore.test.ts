import { describe, expect, it } from "vitest";
import {
  gitFileDiffRequest,
  gitFileGroup,
  parseGitCommitDiff,
  parseGitHistory,
  parseGitWorktree,
  type GitStatusFile,
} from "./gitStore";

function file(overrides: Partial<GitStatusFile>): GitStatusFile {
  return { path: "src/a.ts", oldPath: undefined, index: "unmodified", workingTree: "modified", ...overrides };
}

const commit = {
  id: "0123456789abcdef0123456789abcdef01234567",
  parentIds: ["fedcba9876543210fedcba9876543210fedcba98"],
  authorName: "Ada",
  authorEmail: "ada@example.com",
  authoredAt: "2026-02-04T10:00:00.000Z",
  subject: "Host the Git history in React",
};

describe("git history parsing", () => {
  it("reads a page with a cursor", () => {
    const history = parseGitHistory({ unborn: false, commits: [commit], nextCursor: "page-2", truncated: false });
    expect(history.commits.map((entry) => entry.subject)).toEqual(["Host the Git history in React"]);
    expect(history.nextCursor).toBe("page-2");
    expect(history.unborn).toBe(false);
  });

  it("keeps an unborn repository distinct from an empty history", () => {
    const history = parseGitHistory({ unborn: true, commits: [], truncated: false });
    expect(history.commits).toEqual([]);
    expect(history.unborn).toBe(true);
    expect(history.nextCursor).toBeUndefined();
  });

  it("refuses a page that is not a page", () => {
    expect(() => parseGitHistory(null)).toThrow(/not an object/u);
    expect(() => parseGitHistory({ unborn: false, truncated: false })).toThrow(/commits/u);
  });
});

describe("git commit patch parsing", () => {
  it("marks a merge patch", () => {
    const patch = parseGitCommitDiff({ commit, combined: true, diff: "@@ -1 +1 @@", truncated: true });
    expect(patch.combined).toBe(true);
    expect(patch.truncated).toBe(true);
    expect(patch.commit.id).toBe(commit.id);
  });

  it("refuses a patch with no commit", () => {
    expect(() => parseGitCommitDiff({ combined: false, diff: "", truncated: false })).toThrow(/commit/u);
  });
});

describe("git worktree parsing", () => {
  it("reads the created worktree", () => {
    expect(parseGitWorktree({ path: "/tmp/wt", branch: "feature/x" })).toEqual({ path: "/tmp/wt", branch: "feature/x" });
  });

  it("refuses an answer with no path", () => {
    expect(() => parseGitWorktree({ branch: "feature/x" })).toThrow(/path/u);
  });
});

describe("git file groups", () => {
  it("groups by the index and the working tree", () => {
    expect(gitFileGroup(file({ index: "untracked", workingTree: "untracked" }))).toBe("untracked");
    expect(gitFileGroup(file({ index: "modified", workingTree: "unmodified" }))).toBe("staged");
    expect(gitFileGroup(file({}))).toBe("unstaged");
  });

  it("asks for the staged comparison only for a staged file", () => {
    expect(gitFileDiffRequest(file({ index: "added", workingTree: "unmodified" }))).toEqual({ path: "src/a.ts", staged: true });
    expect(gitFileDiffRequest(file({}))).toEqual({ path: "src/a.ts", staged: false });
  });
});
