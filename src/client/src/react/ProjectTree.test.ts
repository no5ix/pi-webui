// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectTree } from "./ProjectTree";
import type { SessionInfo } from "../api";

function sessionModifiedAgo(minutes: number): SessionInfo {
  const stamp = new Date(Date.now() - minutes * 60_000).toISOString();
  return { id: "session-1", cwd: "/srv/workspace", path: "/srv/workspace/session-1.jsonl", created: stamp, modified: stamp, messageCount: 1, firstMessage: "A long session title" };
}

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

  it("does not highlight the project row and shows a short relative session age", async () => {
    await act(async () => { root.render(createElement(ProjectTree, {
      projects: [{ id: "project-1", name: "Workspace", sessions: [{ id: "session-1", name: "A long session title", session: sessionModifiedAgo(180) }], unknown: false, pending: false }],
      query: "", expanded: ["project-1"], onExpanded: vi.fn(), selectedProject: "project-1", selectedSession: "session-1",
      onSelectProject: vi.fn(), onSelectSession: vi.fn(), onCloseProject: vi.fn(), showMoreByProject: {}, onShowMore: vi.fn(),
    })); await Promise.resolve(); });
    expect(container.querySelector(".rw-project-row")?.classList.contains("selected")).toBe(false);
    expect(container.querySelector(".rw-session-row small")?.textContent).toMatch(/^3h$/);
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
