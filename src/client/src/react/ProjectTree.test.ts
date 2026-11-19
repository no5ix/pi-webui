// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectTree } from "./ProjectTree";

let container: HTMLDivElement;
let root: Root;

describe("React project navigation", () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    document.body.replaceChildren();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    vi.restoreAllMocks();
  });

  it("keeps ordinary project selection and exposes the controller-backed close action", async () => {
    const onSelectProject = vi.fn();
    const onCloseProject = vi.fn();
    await act(async () => { root.render(createElement(ProjectTree, {
      projects: [{ id: "project-1", name: "Workspace", sessions: [], unknown: false, pending: false }],
      query: "", expanded: [], onExpanded: vi.fn(), selectedProject: "", selectedSession: "",
      onSelectProject, onSelectSession: vi.fn(), onCloseProject, showMoreByProject: {}, onShowMore: vi.fn(),
    })); await Promise.resolve(); });

    const project = [...container.querySelectorAll<HTMLButtonElement>(".rw-project-name")].find(button => button.textContent.includes("Workspace"));
    const close = container.querySelector<HTMLButtonElement>('[aria-label="Close project Workspace"]');
    if (project === undefined || close === null) throw new Error("Project row actions did not render.");

    await act(async () => { project.click(); await Promise.resolve(); });
    await act(async () => { close.click(); await Promise.resolve(); });

    expect(onSelectProject).toHaveBeenCalledWith("project-1");
    expect(onCloseProject).toHaveBeenCalledWith("project-1");
  });
});
