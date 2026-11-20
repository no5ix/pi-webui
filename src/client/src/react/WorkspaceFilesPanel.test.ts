// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileTreeEntry } from "../api";
import { WorkspaceFilesPanel } from "./WorkspaceFilesPanel";
import type { OpenWorkspaceFile, WorkspaceFilesApi } from "./useWorkspaceFiles";

let container: HTMLDivElement;
let root: Root;

const TREE_ENTRIES: FileTreeEntry[] = [
  { name: "src", path: "src", type: "directory" },
  { name: "README.md", path: "README.md", type: "file", size: 12 },
];

function openFile(path: string, overrides: Partial<OpenWorkspaceFile> = {}): OpenWorkspaceFile {
  return {
    path,
    content: `contents of ${path}`,
    savedContent: `contents of ${path}`,
    modifiedAt: "m1",
    size: 10,
    binary: false,
    truncated: false,
    loading: false,
    error: undefined,
    externalChange: undefined,
    saveState: "idle",
    saveError: undefined,
    ...overrides,
  };
}

function createFiles(overrides: Partial<WorkspaceFilesApi> = {}): WorkspaceFilesApi {
  const active = openFile("README.md");
  return {
    tree: { entries: { "": TREE_ENTRIES, src: [{ name: "app.ts", path: "src/app.ts", type: "file" }] }, expanded: ["src"], loading: [], errors: {}, truncated: {}, loaded: [""] },
    currentDirectory: "",
    openFiles: [active],
    activePath: "README.md",
    activeFile: active,
    dirtyPaths: [],
    hasUnsavedChanges: false,
    search: { query: "", results: [], loading: false, error: undefined },
    notice: undefined,
    refreshing: false,
    busy: undefined,
    setSearchQuery: vi.fn(),
    setCurrentDirectory: vi.fn(),
    refresh: vi.fn(() => Promise.resolve()),
    toggleDirectory: vi.fn(() => Promise.resolve()),
    retryDirectory: vi.fn(() => Promise.resolve()),
    openFile: vi.fn(() => Promise.resolve()),
    activateFile: vi.fn(),
    closeFile: vi.fn(),
    retryFile: vi.fn(() => Promise.resolve()),
    changeDraft: vi.fn(),
    saveFile: vi.fn(() => Promise.resolve("saved" as const)),
    saveAll: vi.fn(() => Promise.resolve({ saved: 0, failed: 0, conflicts: 0 })),
    reloadFile: vi.fn(() => Promise.resolve()),
    keepLocalChanges: vi.fn(),
    discardDraft: vi.fn(),
    discardAll: vi.fn(),
    createFile: vi.fn(() => Promise.resolve({ ok: true })),
    renameFile: vi.fn(() => Promise.resolve({ ok: true })),
    deleteFile: vi.fn(() => Promise.resolve({ ok: true })),
    uploadFiles: vi.fn(() => Promise.resolve({ uploaded: 0, failures: [] })),
    clearNotice: vi.fn(),
    ...overrides,
  };
}

async function render(files: WorkspaceFilesApi): Promise<void> {
  await act(async () => {
    root.render(createElement(WorkspaceFilesPanel, {
      files,
      rootLabel: "my-workspace",
      projectId: "project-1",
      workspaceId: "workspace-1",
      machineId: "local",
      hasWorkspace: true,
    }));
    await Promise.resolve();
  });
}

function button(label: string, scope: ParentNode = container): HTMLButtonElement {
  const found = [...scope.querySelectorAll<HTMLButtonElement>("button")].find(item => item.getAttribute("aria-label") === label || item.textContent.trim() === label);
  if (found === undefined) throw new Error(`No button labelled ${label}.`);
  return found;
}

describe("React workspace files panel", () => {
  beforeEach(async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    });
    vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function (this: HTMLDialogElement) {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    });
    await Promise.resolve();
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    document.body.replaceChildren();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    vi.restoreAllMocks();
  });

  it("renders the nested tree, the current folder and opens a file from a row", async () => {
    const files = createFiles();
    await render(files);

    const rows = [...container.querySelectorAll(".rw-file-row")];
    expect(rows.map(row => row.textContent)).toEqual(expect.arrayContaining([expect.stringContaining("src"), expect.stringContaining("app.ts"), expect.stringContaining("README.md")]));
    expect(container.querySelector(".rw-breadcrumbs")?.textContent).toContain("my-workspace");

    await act(async () => { rows.find(row => row.textContent.includes("app.ts"))?.dispatchEvent(new MouseEvent("click", { bubbles: true })); await Promise.resolve(); });
    expect(files.openFile).toHaveBeenCalledWith("src/app.ts");
  });

  it("switches tabs and marks a draft as unsaved", async () => {
    const first = openFile("src/app.ts", { content: "draft" });
    const second = openFile("README.md");
    const files = createFiles({ openFiles: [first, second], activeFile: second, activePath: "README.md", dirtyPaths: ["src/app.ts"] });
    await render(files);

    const tabs = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tabs.map(tab => tab.textContent)).toEqual(["app.ts", "README.md"]);
    expect(container.querySelector(".rw-dirty-dot")).not.toBeNull();

    await act(async () => { tabs[0]?.click(); await Promise.resolve(); });
    expect(files.activateFile).toHaveBeenCalledWith("src/app.ts");
  });

  it("asks before closing a dirty file and can discard it", async () => {
    const dirty = openFile("src/app.ts", { content: "draft" });
    const files = createFiles({ openFiles: [dirty], activeFile: dirty, activePath: "src/app.ts", dirtyPaths: ["src/app.ts"] });
    await render(files);

    await act(async () => { button("Close file").click(); await Promise.resolve(); });
    expect(files.closeFile).not.toHaveBeenCalled();
    expect(container.querySelector(".rw-unsaved-dialog")?.hasAttribute("open")).toBe(true);

    await act(async () => { button("Discard").click(); await Promise.resolve(); });
    expect(files.discardDraft).toHaveBeenCalledWith("src/app.ts");
    expect(files.closeFile).toHaveBeenCalledWith("src/app.ts");
  });

  it("saves before closing a dirty file", async () => {
    const dirty = openFile("src/app.ts", { content: "draft" });
    const files = createFiles({ openFiles: [dirty], activeFile: dirty, activePath: "src/app.ts", dirtyPaths: ["src/app.ts"] });
    await render(files);

    await act(async () => { button("Close file").click(); await Promise.resolve(); });
    await act(async () => { button("Save and close").click(); await Promise.resolve(); });

    expect(files.saveFile).toHaveBeenCalledWith("src/app.ts");
    expect(files.closeFile).toHaveBeenCalledWith("src/app.ts");
  });

  it("keeps the draft when a save on close fails, and can cancel out", async () => {
    const dirty = openFile("src/app.ts", { content: "draft" });
    const files = createFiles({
      openFiles: [dirty],
      activeFile: dirty,
      activePath: "src/app.ts",
      dirtyPaths: ["src/app.ts"],
      saveFile: vi.fn(() => Promise.resolve("failed" as const)),
    });
    await render(files);

    await act(async () => { button("Close file").click(); await Promise.resolve(); });
    await act(async () => { button("Save and close").click(); await Promise.resolve(); });

    expect(files.closeFile).not.toHaveBeenCalled();
    expect(container.querySelector(".rw-unsaved-error")?.textContent).toContain("draft is still here");

    const dialog = container.querySelector(".rw-unsaved-dialog");
    if (dialog === null) throw new Error("The unsaved dialog did not render.");
    await act(async () => { button("Cancel", dialog).click(); await Promise.resolve(); });
    expect(dialog.hasAttribute("open")).toBe(false);
  });

  it("shows a conflict without offering a save that would overwrite it", async () => {
    const conflicting = openFile("src/app.ts", { content: "mine", externalChange: { modifiedAt: "m2", content: "theirs" } });
    const files = createFiles({ openFiles: [conflicting], activeFile: conflicting, activePath: "src/app.ts", dirtyPaths: ["src/app.ts"] });
    await render(files);

    expect(container.querySelector(".rw-file-conflict")?.textContent).toContain("changed on disk");

    await act(async () => { button("Reload from disk").click(); await Promise.resolve(); });
    expect(files.reloadFile).toHaveBeenCalledWith("src/app.ts");

    await act(async () => { button("Keep my version").click(); await Promise.resolve(); });
    expect(files.keepLocalChanges).toHaveBeenCalledWith("src/app.ts");
  });

  it("reports a partially failed save all instead of claiming success", async () => {
    const dirty = openFile("src/app.ts", { content: "draft" });
    const files = createFiles({
      openFiles: [dirty, openFile("README.md")],
      activeFile: dirty,
      activePath: "src/app.ts",
      dirtyPaths: ["src/app.ts"],
      saveAll: vi.fn(() => Promise.resolve({ saved: 0, failed: 1, conflicts: 0 })),
    });
    await render(files);

    await act(async () => { button("Save all").click(); await Promise.resolve(); });

    expect(files.saveAll).toHaveBeenCalledOnce();
    expect(container.querySelector(".rw-files-notice.error")?.textContent).toContain("could not be saved");
  });

  it("states the backend limitation for directory creation honestly", async () => {
    await render(createFiles());
    const newFolder = container.querySelector<HTMLButtonElement>('[aria-label="New folder"]');
    expect(newFolder?.disabled).toBe(true);
    expect(newFolder?.title).toContain("not supported");
  });
});
