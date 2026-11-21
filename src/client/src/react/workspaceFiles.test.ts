import { describe, expect, it } from "vitest";
import type { FileTreeEntry } from "../api";
import {
  combineSaveOutcomes,
  downloadFileName,
  filterFileEntries,
  folderAncestors,
  formatFileSize,
  isSafeWorkspaceRelativePath,
  joinWorkspacePath,
  listingHasName,
  parentWorkspacePath,
  sameWorkspaceFileScope,
  sortFileEntries,
  validateWorkspaceEntryName,
  workspaceBaseName,
  workspaceBreadcrumbs,
  workspaceEntryKind,
  workspaceFileScopeKey,
  workspaceTabLabel,
} from "./workspaceFiles";

const entry = (name: string, type: FileTreeEntry["type"] = "file"): FileTreeEntry => ({ name, path: `nested/${name}`, type });

describe("workspace file identity", () => {
  it("keys a scope by machine, project and workspace", () => {
    const scope = { machineId: "local", projectId: "project-1", workspaceId: "workspace-1" };
    expect(workspaceFileScopeKey(scope)).toBe(JSON.stringify(["local", "project-1", "workspace-1"]));
    expect(workspaceFileScopeKey(undefined)).toBe("");
    expect(sameWorkspaceFileScope(scope, { ...scope })).toBe(true);
    expect(sameWorkspaceFileScope(scope, { ...scope, workspaceId: "workspace-2" })).toBe(false);
    expect(sameWorkspaceFileScope(undefined, undefined)).toBe(true);
  });
});

describe("workspace paths", () => {
  it("splits parents and base names without a leading separator", () => {
    expect(parentWorkspacePath("src/client/app.ts")).toBe("src/client");
    expect(parentWorkspacePath("README.md")).toBe("");
    expect(workspaceBaseName("src/client/app.ts")).toBe("app.ts");
    expect(workspaceBaseName("README.md")).toBe("README.md");
    expect(joinWorkspacePath("", "README.md")).toBe("README.md");
    expect(joinWorkspacePath("src", "app.ts")).toBe("src/app.ts");
  });

  it("lists every ancestor folder, including the root", () => {
    expect(folderAncestors("")).toEqual([""]);
    expect(folderAncestors("src/client")).toEqual(["", "src", "src/client"]);
  });

  it("builds breadcrumbs from the root to the current folder", () => {
    expect(workspaceBreadcrumbs("", "my-workspace")).toEqual([{ label: "my-workspace", path: "" }]);
    expect(workspaceBreadcrumbs("src/client", "workspace")).toEqual([
      { label: "workspace", path: "" },
      { label: "src", path: "src" },
      { label: "client", path: "src/client" },
    ]);
    expect(workspaceBreadcrumbs("", "")[0]?.label).toBe("Workspace");
  });
});

describe("workspace entry names", () => {
  it("accepts ordinary names with spaces, dots and unicode", () => {
    for (const name of ["README.md", "my notes.txt", "café.ts", ".env.local", "a.b.c"]) {
      expect(validateWorkspaceEntryName(name)).toEqual({ kind: "valid", name });
    }
  });

  it("refuses traversal, separators, hidden home expansion, control characters and empty names", () => {
    expect(validateWorkspaceEntryName("   ").kind).toBe("invalid");
    expect(validateWorkspaceEntryName(".").kind).toBe("invalid");
    expect(validateWorkspaceEntryName("..").kind).toBe("invalid");
    expect(validateWorkspaceEntryName("a/b").kind).toBe("invalid");
    expect(validateWorkspaceEntryName("a\\b").kind).toBe("invalid");
    expect(validateWorkspaceEntryName("~root").kind).toBe("invalid");
    expect(validateWorkspaceEntryName("bell\u0007").kind).toBe("invalid");
    expect(validateWorkspaceEntryName("x".repeat(256)).kind).toBe("invalid");
  });

  it("treats only relative, traversal-free paths as safe", () => {
    expect(isSafeWorkspaceRelativePath("src/app.ts")).toBe(true);
    expect(isSafeWorkspaceRelativePath("a//b")).toBe(false);
    expect(isSafeWorkspaceRelativePath("/etc/passwd")).toBe(false);
    expect(isSafeWorkspaceRelativePath("C:\\Windows")).toBe(false);
    expect(isSafeWorkspaceRelativePath("../outside")).toBe(false);
    expect(isSafeWorkspaceRelativePath("a/./b")).toBe(false);
    expect(isSafeWorkspaceRelativePath("a\\b")).toBe(false);
    expect(isSafeWorkspaceRelativePath("")).toBe(false);
  });

  it("detects duplicates in a listing but not the entry being renamed", () => {
    const entries = [entry("app.ts"), entry("README.md")];
    expect(listingHasName(entries, "app.ts")).toBe(true);
    expect(listingHasName(entries, "app.ts", "nested/app.ts")).toBe(false);
    expect(listingHasName(entries, "missing.ts")).toBe(false);
    expect(listingHasName(undefined, "app.ts")).toBe(false);
  });
});

describe("workspace entry presentation", () => {
  it("classifies directories and common file families", () => {
    expect(workspaceEntryKind({ name: "src", type: "directory" })).toBe("directory");
    expect(workspaceEntryKind({ name: "main.ts", type: "file" })).toBe("code");
    expect(workspaceEntryKind({ name: "README.md", type: "file" })).toBe("markdown");
    expect(workspaceEntryKind({ name: "package.json", type: "file" })).toBe("json");
    expect(workspaceEntryKind({ name: "logo.svg", type: "file" })).toBe("code");
    expect(workspaceEntryKind({ name: "photo.png", type: "file" })).toBe("image");
    expect(workspaceEntryKind({ name: "bundle.tar.gz", type: "file" })).toBe("archive");
    expect(workspaceEntryKind({ name: "Dockerfile", type: "file" })).toBe("config");
    expect(workspaceEntryKind({ name: ".env", type: "file" })).toBe("config");
    expect(workspaceEntryKind({ name: "notes.txt", type: "file" })).toBe("text");
    expect(workspaceEntryKind({ name: "LICENSE", type: "file" })).toBe("other");
    expect(workspaceEntryKind({ name: "link", type: "symlink" })).toBe("other");
  });

  it("sorts directories first and file names naturally", () => {
    const sorted = sortFileEntries([
      { name: "file10.ts", path: "file10.ts", type: "file" },
      { name: "file2.ts", path: "file2.ts", type: "file" },
      { name: "zeta", path: "zeta", type: "directory" },
      { name: "Alpha", path: "Alpha", type: "directory" },
    ]);
    expect(sorted.map(item => item.name)).toEqual(["Alpha", "zeta", "file2.ts", "file10.ts"]);
  });

  it("filters by name or path without losing directory-first order", () => {
    const entries: FileTreeEntry[] = [
      { name: "src", path: "src", type: "directory" },
      { name: "app.ts", path: "src/app.ts", type: "file" },
      { name: "README.md", path: "README.md", type: "file" },
    ];
    expect(filterFileEntries(entries, "SRC").map(item => item.path)).toEqual(["src", "src/app.ts"]);
    expect(filterFileEntries(entries, "  ").map(item => item.path)).toEqual(["src", "src/app.ts", "README.md"]);
  });

  it("formats sizes for the tree", () => {
    expect(formatFileSize(undefined)).toBe("");
    expect(formatFileSize(12)).toBe("12 B");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(40 * 1024)).toBe("40 KB");
    expect(formatFileSize(3 * 1024 * 1024)).toBe("3.0 MB");
  });

  it("summarizes save batches", () => {
    expect(combineSaveOutcomes(["saved", "saved", "unchanged"])).toEqual({ saved: 2, failed: 0, conflicts: 0 });
    expect(combineSaveOutcomes(["failed", "conflict", "saved"])).toEqual({ saved: 1, failed: 1, conflicts: 1 });
    expect(combineSaveOutcomes([])).toEqual({ saved: 0, failed: 0, conflicts: 0 });
  });

  it("disambiguates tabs sharing a base name", () => {
    expect(workspaceTabLabel("src/app.ts", ["src/app.ts"])).toBe("app.ts");
    expect(workspaceTabLabel("src/app.ts", ["src/app.ts", "test/app.ts"])).toBe("app.ts — src");
    expect(workspaceTabLabel("app.ts", ["app.ts", "test/app.ts"])).toBe("app.ts — root");
  });

  it("derives a download name from the path", () => {
    expect(downloadFileName("docs/guide.md")).toBe("guide.md");
    expect(downloadFileName("")).toBe("download");
  });
});
