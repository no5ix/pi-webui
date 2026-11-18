import { useEffect } from "react";
import { createStore, useStoreSelect, type Store } from "./store";

/**
 * What the page is looking at, and the URL that carries it.
 *
 * The route keys are the ones PI WEB already uses (`machine`, `project`,
 * `workspace`, `session`), so a bookmark, a shared link, a browser Back gesture
 * and a reload all land on the same session in the React shell as they did
 * before. The local machine stays out of the URL, as before.
 */
export interface Selection {
  machineId: string;
  projectId: string | undefined;
  workspaceId: string | undefined;
  sessionId: string | undefined;
}

export const localMachineId = "local";

function readParam(search: URLSearchParams, key: string): string | undefined {
  const value = search.get(key);
  return value === null || value === "" ? undefined : value;
}

export function selectionFromUrl(fallback: Selection): Selection {
  const search = new URLSearchParams(window.location.search);
  return {
    machineId: readParam(search, "machine") ?? fallback.machineId,
    projectId: readParam(search, "project"),
    workspaceId: readParam(search, "workspace"),
    sessionId: readParam(search, "session"),
  };
}

export const selection: Store<Selection> = createStore<Selection>(
  selectionFromUrl({ machineId: localMachineId, projectId: undefined, workspaceId: undefined, sessionId: undefined }),
);

export function selectSession(next: {
  machineId?: string;
  projectId?: string;
  workspaceId?: string;
  sessionId?: string;
}): void {
  selection.update((current) => ({
    machineId: next.machineId ?? current.machineId,
    projectId: next.projectId ?? current.projectId,
    workspaceId: next.workspaceId ?? current.workspaceId,
    sessionId: next.sessionId,
  }));
}

export function selectMachine(machineId: string): void {
  selection.set({ machineId, projectId: undefined, workspaceId: undefined, sessionId: undefined });
}

export function useSelection(): Selection {
  return useStoreSelect(selection, (value) => value);
}

export function selectionParams(next: Selection): URLSearchParams {
  const params = new URLSearchParams(window.location.search);
  if (next.machineId === localMachineId) params.delete("machine");
  else params.set("machine", next.machineId);
  setOrDelete(params, "project", next.projectId);
  setOrDelete(params, "workspace", next.workspaceId);
  setOrDelete(params, "session", next.sessionId);
  return params;
}

function setOrDelete(params: URLSearchParams, key: string, value: string | undefined): void {
  if (value === undefined) params.delete(key);
  else params.set(key, value);
}

export function writeSelectionUrl(next: Selection, replace: boolean): void {
  const url = new URL(window.location.href);
  url.search = selectionParams(next).toString();
  window.history[replace ? "replaceState" : "pushState"]({}, "", url.toString());
}

/**
 * Bind the store to the address bar: every selection writes the URL, and a
 * Back/Forward gesture moves the selection. A write inside the same project and
 * workspace replaces, so opening sessions in one list does not bury the history;
 * moving between projects pushes.
 */
export function startSelectionUrlSync(store: Store<Selection> = selection): () => void {
  let last = store.get();
  const unsubscribe = store.subscribe(() => {
    const next = store.get();
    const sameNeighbourhood = next.machineId === last.machineId && next.projectId === last.projectId && next.workspaceId === last.workspaceId;
    last = next;
    writeSelectionUrl(next, sameNeighbourhood);
  });
  const onPopState = (): void => {
    const next = selectionFromUrl(store.get());
    last = next;
    store.set(next);
  };
  window.addEventListener("popstate", onPopState);
  return () => {
    unsubscribe();
    window.removeEventListener("popstate", onPopState);
  };
}

/** The component that owns the address bar keeps the URL aligned for its whole life. */
export function useSelectionUrl(): void {
  useEffect(() => startSelectionUrlSync(), []);
}
