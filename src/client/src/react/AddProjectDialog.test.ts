// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileSuggestion, WorkspaceTrustResponse } from "../api";
import type { ProjectFolderListing } from "../../../shared/pluginApiTypes";
import { AddProjectDialog } from "./AddProjectDialog";

const api = vi.hoisted(() => ({
  projectTrust: vi.fn<(path: string, machineId: string) => Promise<WorkspaceTrustResponse>>(),
  projectDirectories: vi.fn<(query: string, machineId: string, init?: RequestInit) => Promise<FileSuggestion[]>>(),
  projectFolder: vi.fn<(folder: { path: string }, machineId: string, init?: RequestInit) => Promise<ProjectFolderListing>>(),
}));

vi.mock("../api", () => ({ projectsApi: { projectDirectories: api.projectDirectories, projectFolder: api.projectFolder }, trustApi: { projectTrust: api.projectTrust } }));

let container: HTMLDivElement;
let root: Root;

describe("React add project dialog", () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers();
    vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function (this: HTMLDialogElement) { this.open = true; });
    vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function (this: HTMLDialogElement) { this.open = false; this.dispatchEvent(new Event("close")); });
    api.projectTrust.mockResolvedValue({ path: "/work/project", decision: null, trusted: true, defaultTrust: "always" });
    api.projectDirectories.mockResolvedValue([{ path: "/work/projects", kind: "tracked" }]);
    api.projectFolder.mockResolvedValue({
      path: "/work",
      parent: "/",
      crumbs: [{ name: "work", path: "/work" }],
      separator: "/",
      contents: { kind: "complete", folders: [{ name: "project", path: "/work/project" }] },
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    document.body.replaceChildren();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("submits the captured machine, create choice, and default trust choice", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    await act(async () => { root.render(createElement(AddProjectDialog, { open: true, machineId: "remote-1", machineName: "Remote", onClose, onSubmit })); await Promise.resolve(); });
    const path = container.querySelector<HTMLInputElement>("input[name=path]");
    if (path === null) throw new Error("Project path field did not render.");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(path, "/work/project");
      path.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    const form = container.querySelector("form");
    if (form === null) throw new Error("Add project form did not render.");
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await Promise.resolve(); });

    expect(api.projectTrust).toHaveBeenCalledWith("/work/project", "remote-1");
    expect(api.projectDirectories).toHaveBeenCalledWith("/work/project", "remote-1", expect.anything());
    expect(onSubmit).toHaveBeenCalledWith("/work/project", true, { trusted: true, changed: true }, "remote-1");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps the dialog open while the add request is pending", async () => {
    let finish: ((value: string | undefined) => void) | undefined;
    const onSubmit = vi.fn(() => new Promise<string | undefined>(resolve => { finish = resolve; }));
    const onClose = vi.fn();
    await act(async () => { root.render(createElement(AddProjectDialog, { open: true, machineId: "remote-1", machineName: "Remote", onClose, onSubmit })); await Promise.resolve(); });
    const path = container.querySelector<HTMLInputElement>("input[name=path]");
    if (path === null) throw new Error("Project path field did not render.");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(path, "/work/project");
      path.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    const form = container.querySelector("form");
    const dialog = container.querySelector("dialog");
    const close = container.querySelector<HTMLButtonElement>('[aria-label="Close add project"]');
    if (form === null || dialog === null || close === null) throw new Error("Add project controls did not render.");
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await Promise.resolve(); });

    const escape = new Event("cancel", { cancelable: true });
    await act(async () => { dialog.dispatchEvent(escape); await Promise.resolve(); });
    expect(escape.defaultPrevented).toBe(true);
    expect(close.disabled).toBe(true);
    expect(dialog.open).toBe(true);
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => { finish?.(undefined); await Promise.resolve(); });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
