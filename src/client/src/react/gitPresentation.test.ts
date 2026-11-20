import { describe, expect, it } from "vitest";
import { gitCanCommit, gitChangeGroups, gitChangeLabel } from "./gitPresentation";
import type { GitStatusFile, GitStatusResponse } from "../../../../pi-web-plugins/git/browser/git-contract";

const file = (path: string, index: GitStatusFile["index"], workingTree: GitStatusFile["workingTree"], oldPath?: string): GitStatusFile => ({
  path,
  index,
  workingTree,
  ...(oldPath === undefined ? {} : { oldPath }),
});

const status = (files: GitStatusFile[]): GitStatusResponse => ({ isGitRepo: true, hash: "snapshot", files, submodules: [] });

describe("React Git presentation", () => {
  it("keeps staged and unstaged states distinct for edits, additions, removals, renames, and conflicts", () => {
    const modified = file("modified file.txt", "modified", "modified");
    const added = file("new [file].txt", "added", "unmodified");
    const deleted = file("deleted.txt", "deleted", "unmodified");
    const renamed = file("new name.txt", "renamed", "unmodified", "old name.txt");
    const untracked = file("untracked.txt", "untracked", "untracked");
    const conflicted = file("conflict.txt", "conflicted", "conflicted");

    expect(gitChangeGroups([modified, added, deleted, renamed, untracked, conflicted])).toEqual({
      staged: [modified, added, deleted, renamed, conflicted],
      unstaged: [modified, untracked, conflicted],
    });
    expect(gitChangeLabel(renamed, "staged")).toBe("old name.txt → new name.txt · renamed");
    expect(gitChangeLabel(untracked, "unstaged")).toBe("untracked");
  });

  it("allows commits only when at least one change is staged", () => {
    expect(gitCanCommit(status([file("new.txt", "untracked", "untracked")]))).toBe(false);
    expect(gitCanCommit(status([file("ignored.txt", "ignored", "ignored")]))).toBe(false);
    expect(gitCanCommit(status([file("staged.txt", "added", "unmodified")]))).toBe(true);
    expect(gitCanCommit(undefined)).toBe(false);
  });
});
