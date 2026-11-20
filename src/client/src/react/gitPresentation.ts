import type { GitStatusFile, GitStatusResponse } from "../../../../pi-web-plugins/git/browser/git-contract";

export interface GitChangeGroups {
  readonly staged: readonly GitStatusFile[];
  readonly unstaged: readonly GitStatusFile[];
}

export function gitChangeGroups(files: readonly GitStatusFile[]): GitChangeGroups {
  return {
    staged: files.filter(file => file.index !== "unmodified" && file.index !== "untracked" && file.index !== "ignored"),
    unstaged: files.filter(file => file.workingTree !== "unmodified" && file.workingTree !== "ignored"),
  };
}

export function gitCanCommit(status: GitStatusResponse | undefined): boolean {
  return status !== undefined && gitChangeGroups(status.files).staged.length > 0;
}

export function gitChangeLabel(file: GitStatusFile, section: "staged" | "unstaged"): string {
  const state = section === "staged" ? file.index : file.workingTree;
  if (state === "renamed" && file.oldPath !== undefined) return `${file.oldPath} → ${file.path} · renamed`;
  return state;
}
