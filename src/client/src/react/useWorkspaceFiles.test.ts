// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { filesApi, workspacesApi, type FileContentResponse, type FileTreeResponse } from "../api";
import { useWorkspaceFiles, type WorkspaceFilesApi } from "./useWorkspaceFiles";

interface HarnessProps {
  readonly projectId?: string;
  readonly workspaceId?: string;
  readonly machineId?: string;
}

let container: HTMLDivElement;
let root: Root;
let api: WorkspaceFilesApi | undefined;

function Harness({ projectId = "project-1", workspaceId = "workspace-1", machineId = "local" }: HarnessProps) {
  api = useWorkspaceFiles({ projectId, workspaceId, machineId });
  return null;
}

const ROOT_ENTRIES = [
  { name: "src", path: "src", type: "directory" as const },
  { name: "README.md", path: "README.md", type: "file" as const, size: 20 },
];

function tree(path: string, entries: FileTreeResponse["entries"] = path === "" ? ROOT_ENTRIES : []): FileTreeResponse {
  return { path, entries, scannedAt: "2026-01-01T00:00:00.000Z", truncated: false };
}

function content(path: string, value: string, modifiedAt = "m1"): FileContentResponse {
  return { path, encoding: "utf8", size: value.length, modifiedAt, content: value, truncated: false, binary: false };
}

function current(): WorkspaceFilesApi {
  if (api === undefined) throw new Error("The workspace files hook did not render.");
  return api;
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function render(props: HarnessProps = {}): Promise<void> {
  await act(async () => {
    root.render(createElement(Harness, props));
    await Promise.resolve();
  });
  await flush();
}

async function rerender(props: HarnessProps): Promise<void> {
  await act(async () => {
    root.render(createElement(Harness, props));
    await Promise.resolve();
  });
  await flush();
}

describe("React workspace files hook", () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    api = undefined;
    vi.spyOn(workspacesApi, "workspaceTree").mockImplementation((_projectId, _workspaceId, path = "") => Promise.resolve(tree(path)));
    vi.spyOn(workspacesApi, "workspaceFile").mockImplementation((_projectId, _workspaceId, path) => Promise.resolve(content(path, `contents of ${path}`)));
    vi.spyOn(workspacesApi, "writeWorkspaceFile").mockImplementation((_projectId, _workspaceId, path) => Promise.resolve({ path, size: 1, modifiedAt: "m2", created: false }));
    vi.spyOn(workspacesApi, "moveWorkspaceFile").mockImplementation((_projectId, _workspaceId, fromPath, toPath) => Promise.resolve({ fromPath, toPath, size: 1, modifiedAt: "m2" }));
    vi.spyOn(workspacesApi, "deleteWorkspaceFile").mockImplementation((_projectId, _workspaceId, path) => Promise.resolve({ path, existed: true }));
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    document.body.replaceChildren();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("loads the root listing and expands nested directories on demand", async () => {
    const nestedTree = tree("src", [{ name: "app.ts", path: "src/app.ts", type: "file" }]);
    vi.mocked(workspacesApi.workspaceTree).mockImplementation((_projectId, _workspaceId, path = "") => {
      if (path === "src") return Promise.resolve(nestedTree);
      return Promise.resolve(tree(path));
    });

    await render();
    expect(current().tree.entries[""]?.map(entry => entry.name)).toEqual(["src", "README.md"]);

    await act(async () => { await current().toggleDirectory("src"); });
    await flush();

    expect(current().currentDirectory).toBe("src");
    expect(current().tree.expanded).toContain("src");
    expect(current().tree.entries["src"]?.map(entry => entry.name)).toEqual(["app.ts"]);
  });

  it("drops a listing that answers after the reader switched workspaces", async () => {
    let resolveFirst: ((value: FileTreeResponse) => void) | undefined;
    vi.mocked(workspacesApi.workspaceTree).mockImplementation((_projectId, workspaceId, path = "") => {
      if (workspaceId === "workspace-1" && path === "") {
        return new Promise<FileTreeResponse>(resolve => { resolveFirst = resolve; });
      }
      return Promise.resolve(tree(path, [{ name: `${workspaceId}.md`, path: `${workspaceId}.md`, type: "file" }]));
    });

    await render({ workspaceId: "workspace-1" });
    await rerender({ workspaceId: "workspace-2" });
    await act(async () => { resolveFirst?.(tree("", [{ name: "stale.md", path: "stale.md", type: "file" }])); await Promise.resolve(); });
    await flush();

    expect(current().tree.entries[""]?.map(entry => entry.name)).toEqual(["workspace-2.md"]);
  });

  it("keeps drafts per open file and clears the dirty mark after a save", async () => {
    await render();
    await act(async () => { await current().openFile("src/app.ts"); });
    await flush();
    expect(current().activeFile?.savedContent).toBe("contents of src/app.ts");

    act(() => { current().changeDraft("src/app.ts", "edited"); });
    expect(current().dirtyPaths).toEqual(["src/app.ts"]);

    await act(async () => { await current().openFile("README.md"); });
    await flush();
    expect(current().activePath).toBe("README.md");

    act(() => { current().activateFile("src/app.ts"); });
    expect(current().activeFile?.content).toBe("edited");

    const outcome = await act(async () => current().saveFile("src/app.ts"));
    expect(outcome).toBe("saved");
    expect(current().dirtyPaths).toEqual([]);
    expect(current().activeFile?.savedContent).toBe("edited");
  });

  it("keeps the draft and reports the error when a save fails", async () => {
    vi.mocked(workspacesApi.writeWorkspaceFile).mockRejectedValueOnce(new Error("permission denied"));

    await render();
    await act(async () => { await current().openFile("src/app.ts"); });
    await flush();
    act(() => { current().changeDraft("src/app.ts", "edited"); });

    const outcome = await act(async () => current().saveFile("src/app.ts"));
    expect(outcome).toBe("failed");
    expect(current().activeFile?.content).toBe("edited");
    expect(current().activeFile?.saveState).toBe("failed");
    expect(current().activeFile?.saveError).toBe("permission denied");
    expect(current().dirtyPaths).toEqual(["src/app.ts"]);
  });

  it("refuses to overwrite a file that changed on disk since it was opened", async () => {
    await render();
    await act(async () => { await current().openFile("src/app.ts"); });
    await flush();
    act(() => { current().changeDraft("src/app.ts", "mine"); });

    vi.mocked(workspacesApi.workspaceFile).mockResolvedValueOnce(content("src/app.ts", "theirs", "m2"));
    const outcome = await act(async () => current().saveFile("src/app.ts"));

    expect(outcome).toBe("conflict");
    expect(workspacesApi.writeWorkspaceFile).not.toHaveBeenCalled();
    expect(current().activeFile?.content).toBe("mine");
    expect(current().activeFile?.externalChange?.content).toBe("theirs");
  });

  it("reloads a clean file whose content changed on disk", async () => {
    await render();
    await act(async () => { await current().openFile("src/app.ts"); });
    await flush();

    vi.mocked(workspacesApi.workspaceFile).mockResolvedValue(content("src/app.ts", "newer", "m2"));
    await act(async () => { await current().refresh(); });
    await flush();

    expect(current().activeFile?.content).toBe("newer");
    expect(current().activeFile?.modifiedAt).toBe("m2");
  });

  it("does not replace a dirty draft when the file changed on disk", async () => {
    await render();
    await act(async () => { await current().openFile("src/app.ts"); });
    await flush();
    act(() => { current().changeDraft("src/app.ts", "mine"); });

    vi.mocked(workspacesApi.workspaceFile).mockResolvedValue(content("src/app.ts", "newer", "m2"));
    await act(async () => { await current().refresh(); });
    await flush();

    expect(current().activeFile?.content).toBe("mine");
    expect(current().activeFile?.externalChange?.content).toBe("newer");
  });

  it("refuses duplicate names before creating a file", async () => {
    await render();
    const result = await current().createFile("", "README.md");

    expect(result.ok).toBe(false);
    expect(result.error).toContain("already exists");
    expect(workspacesApi.writeWorkspaceFile).not.toHaveBeenCalled();
  });

  it("creates a file in the current folder and opens it", async () => {
    await render();
    const result = await act(async () => current().createFile("", "notes.txt"));
    await flush();

    expect(result).toEqual({ ok: true, path: "notes.txt" });
    expect(workspacesApi.writeWorkspaceFile).toHaveBeenCalledWith("project-1", "workspace-1", "notes.txt", "", { createDirs: false, overwrite: false }, "local");
    expect(current().openFiles.map(file => file.path)).toEqual(["notes.txt"]);
  });

  it("renames an open file and moves its tab to the new path", async () => {
    await render();
    await act(async () => { await current().openFile("src/app.ts"); });
    await flush();

    const result = await act(async () => current().renameFile("src/app.ts", "main.ts"));
    await flush();

    expect(result).toEqual({ ok: true, path: "src/main.ts" });
    expect(workspacesApi.moveWorkspaceFile).toHaveBeenCalledWith("project-1", "workspace-1", "src/app.ts", "src/main.ts", { createDirs: false, overwrite: false }, "local");
    expect(current().openFiles.map(file => file.path)).toEqual(["src/main.ts"]);
    expect(current().activePath).toBe("src/main.ts");
  });

  it("closes the tab of a deleted file and refreshes its folder", async () => {
    await render();
    await act(async () => { await current().openFile("src/app.ts"); });
    await flush();

    const result = await act(async () => current().deleteFile("src/app.ts"));
    await flush();

    expect(result.ok).toBe(true);
    expect(current().openFiles).toEqual([]);
    expect(workspacesApi.workspaceTree).toHaveBeenCalledWith("project-1", "workspace-1", "src", "local");
  });

  it("uploads every accepted file and reports each rejection", async () => {
    vi.mocked(workspacesApi.writeWorkspaceFile)
      .mockResolvedValueOnce({ path: "a.txt", size: 1, modifiedAt: "m2", created: true })
      .mockRejectedValueOnce(new Error("already exists"));

    await render();
    const result = await act(async () => current().uploadFiles("", [
      new File(["a"], "a.txt"),
      new File(["b"], "b.txt"),
    ]));
    await flush();

    expect(result.uploaded).toBe(1);
    expect(result.failures).toEqual(["b.txt: already exists"]);
    expect(current().notice?.kind).toBe("error");
  });

  it("clears drafts and open tabs when the workspace changes", async () => {
    await render();
    await act(async () => { await current().openFile("src/app.ts"); });
    await flush();
    act(() => { current().changeDraft("src/app.ts", "draft"); });
    expect(current().hasUnsavedChanges).toBe(true);

    await rerender({ workspaceId: "workspace-2" });

    expect(current().openFiles).toEqual([]);
    expect(current().activePath).toBeUndefined();
    expect(current().hasUnsavedChanges).toBe(false);
  });

  it("searches after a debounce and keeps a scoped result", async () => {
    vi.useFakeTimers();
    vi.spyOn(filesApi, "files").mockResolvedValue([{ path: "src/app.ts", kind: "tracked" }]);

    await render();
    act(() => { current().setSearchQuery("app"); });
    expect(current().search.loading).toBe(true);

    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    await flush();

    expect(filesApi.files).toHaveBeenCalledWith("app", { projectId: "project-1", workspaceId: "workspace-1", machineId: "local", mode: "file", scope: "all" });
    expect(current().search.results).toEqual([{ path: "src/app.ts", kind: "tracked" }]);
  });
});
