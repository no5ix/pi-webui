// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createStore } from "./store";
import {
  localMachineId,
  selection,
  selectionFromUrl,
  selectionParams,
  selectMachine,
  selectSession,
  startSelectionUrlSync,
  writeSelectionUrl,
  type Selection,
} from "./selection";

const empty: Selection = { machineId: localMachineId, projectId: undefined, workspaceId: undefined, sessionId: undefined };

function atSearch(search: string): void {
  window.history.replaceState({}, "", `${window.location.pathname}${search}`);
}

beforeEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  atSearch("");
});

describe("reading the route", () => {
  it("reads every key the app routes on", () => {
    atSearch("?machine=fleet-2&project=p1&workspace=w1&session=s1");
    expect(selectionFromUrl(empty)).toEqual({
      machineId: "fleet-2",
      projectId: "p1",
      workspaceId: "w1",
      sessionId: "s1",
    });
  });

  it("keeps the current machine when the URL does not name one", () => {
    atSearch("?project=p1");
    expect(selectionFromUrl({ ...empty, machineId: "fleet-2" })).toEqual({
      machineId: "fleet-2",
      projectId: "p1",
      workspaceId: undefined,
      sessionId: undefined,
    });
  });

  it("treats an empty parameter as absent", () => {
    atSearch("?machine=&project=&session=s9");
    const read = selectionFromUrl(empty);
    expect(read.machineId).toBe(localMachineId);
    expect(read.projectId).toBeUndefined();
    expect(read.sessionId).toBe("s9");
  });
});

describe("writing the route", () => {
  it("leaves the local machine out of the URL and names a remote one", () => {
    expect(selectionParams({ ...empty, projectId: "p1" }).toString()).toBe("project=p1");
    expect(selectionParams({ ...empty, machineId: "fleet-2", sessionId: "s1" }).toString()).toBe("machine=fleet-2&session=s1");
  });

  it("drops the keys a selection no longer has", () => {
    atSearch("?project=p1&workspace=w1&session=s1");
    expect(selectionParams(empty).toString()).toBe("");
  });

  it("replaces the address for a session inside the open list and pushes when the list changes", () => {
    const replace = vi.spyOn(window.history, "replaceState");
    const push = vi.spyOn(window.history, "pushState");
    writeSelectionUrl({ ...empty, projectId: "p1", sessionId: "s1" }, true);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(window.location.search).toBe("?project=p1&session=s1");
    writeSelectionUrl({ ...empty, projectId: "p2", sessionId: "s2" }, false);
    expect(push).toHaveBeenCalledTimes(1);
    expect(window.location.search).toBe("?project=p2&session=s2");
    replace.mockRestore();
    push.mockRestore();
  });
});

describe("selection transitions", () => {
  it("keeps the scope a call does not name and clears the session it does not name", () => {
    selectMachine(localMachineId);
    selectSession({ projectId: "p1", workspaceId: "w1", sessionId: "s1" });
    selectSession({ sessionId: "s2" });
    expect(selection.get()).toEqual({ machineId: localMachineId, projectId: "p1", workspaceId: "w1", sessionId: "s2" });
    selectSession({});
    expect(selection.get().sessionId).toBeUndefined();
  });

  it("clears the project, workspace and session when the machine changes", () => {
    selectSession({ projectId: "p1", workspaceId: "w1", sessionId: "s1" });
    selectMachine("fleet-2");
    expect(selection.get()).toEqual({ machineId: "fleet-2", projectId: undefined, workspaceId: undefined, sessionId: undefined });
  });
});

describe("the address bar and the store agree", () => {
  it("keeps the URL aligned with every write and follows Back", () => {
    const store = createStore<Selection>({ ...empty, projectId: "p1", workspaceId: "w1", sessionId: "s1" });
    const replace = vi.spyOn(window.history, "replaceState");
    const push = vi.spyOn(window.history, "pushState");
    const stop = startSelectionUrlSync(store);

    store.set({ ...empty, projectId: "p1", workspaceId: "w1", sessionId: "s2" });
    expect(window.location.search).toBe("?project=p1&workspace=w1&session=s2");
    expect(replace).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();

    store.set({ ...empty, projectId: "p2", workspaceId: "w2", sessionId: "s3" });
    expect(window.location.search).toBe("?project=p2&workspace=w2&session=s3");
    expect(push).toHaveBeenCalledTimes(1);

    atSearch("?project=p1&workspace=w1&session=s1");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(store.get()).toEqual({ machineId: localMachineId, projectId: "p1", workspaceId: "w1", sessionId: "s1" });

    stop();
    store.set({ ...empty, projectId: "p9" });
    expect(window.location.search).toBe("?project=p1&workspace=w1&session=s1");
    replace.mockRestore();
    push.mockRestore();
  });
});
