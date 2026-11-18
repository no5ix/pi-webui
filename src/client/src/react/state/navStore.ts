import { sessionPinsApi, type MachinePins } from "../../api/clients";
import { isRecord } from "../../../../shared/unknownValues";
import { createStore, useStoreSelect, readFailed, type ReadState, type Store } from "./store";

/**
 * What the navigation rail is showing.
 *
 * Which projects are open, how many of their sessions are listed, whether
 * archived sessions are included and the search text are this browser's view
 * state, so they are persisted: a reload lands on the same tree, and a project
 * the reader opened does not collapse under them when the board refreshes.
 *
 * The pins are not view state. They belong to a machine, so they are read from
 * it through `sessionPinsApi.pins` and stay a separate read: a pin made on
 * another device arrives here, and a pin read that did not answer is a stated
 * failure, not a project list with nothing pinned.
 */

export const navigationStorageKey = "pi-web-react:navigation:v1";

/** How many of a project's sessions the rail lists before a "Show N more" row. */
export const defaultSessionCap = 5;

/** How much a "Show N more" row raises that cap. */
export const sessionCapStep = 5;

export interface NavigationState {
  readonly expandedProjectIds: readonly string[];
  readonly sessionCaps: Readonly<Record<string, number>>;
  readonly showArchived: boolean;
  readonly searchText: string;
}

const emptyNavigation: NavigationState = {
  expandedProjectIds: [],
  sessionCaps: {},
  showArchived: false,
  searchText: "",
};

export const navStore: Store<NavigationState> = createStore<NavigationState>(readPersistedNavigation());

export function useNavigation(): NavigationState {
  return useStoreSelect(navStore, (value) => value);
}

/** The cap that applies to a project: its own when the reader raised it, the default otherwise. */
export function sessionCapFor(caps: Readonly<Record<string, number>>, projectId: string): number {
  const cap = caps[projectId];
  return cap === undefined || cap < defaultSessionCap ? defaultSessionCap : cap;
}

function apply(next: NavigationState): void {
  navStore.set(next);
  writePersistedNavigation(next);
}

export function toggleProjectExpanded(projectId: string): void {
  const current = navStore.get();
  const expanded = current.expandedProjectIds.includes(projectId);
  apply({
    ...current,
    expandedProjectIds: expanded ? current.expandedProjectIds.filter((id) => id !== projectId) : [...current.expandedProjectIds, projectId],
  });
}

export function expandProjects(projectIds: readonly string[]): void {
  const current = navStore.get();
  const expanded = new Set(current.expandedProjectIds);
  for (const projectId of projectIds) expanded.add(projectId);
  if (expanded.size === current.expandedProjectIds.length) return;
  apply({ ...current, expandedProjectIds: [...expanded] });
}


export function collapseAllProjects(): void {
  const current = navStore.get();
  if (current.expandedProjectIds.length === 0) return;
  apply({ ...current, expandedProjectIds: [] });
}

export function raiseSessionCap(projectId: string): void {
  const current = navStore.get();
  const cap = sessionCapFor(current.sessionCaps, projectId);
  apply({ ...current, sessionCaps: { ...current.sessionCaps, [projectId]: cap + sessionCapStep } });
}

export function setSearchText(searchText: string): void {
  const current = navStore.get();
  if (current.searchText === searchText) return;
  navStore.set({ ...current, searchText });
}

export function setShowArchived(showArchived: boolean): void {
  const current = navStore.get();
  if (current.showArchived === showArchived) return;
  apply({ ...current, showArchived });
}

export function toggleShowArchived(): void {
  setShowArchived(!navStore.get().showArchived);
}

function readStored(key: string): string | undefined {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ?? undefined;
  } catch {
    return undefined;
  }
}

function writePersistedNavigation(state: NavigationState): void {
  const payload = JSON.stringify({
    expandedProjectIds: state.expandedProjectIds,
    sessionCaps: state.sessionCaps,
    showArchived: state.showArchived,
  });
  try {
    window.localStorage.setItem(navigationStorageKey, payload);
  } catch {
    // A browser that refuses storage keeps the working tree for this session;
    // the next reload starts from the default tree.
  }
}

function readPersistedNavigation(): NavigationState {
  const raw = readStored(navigationStorageKey);
  if (raw === undefined || raw === "") return emptyNavigation;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return emptyNavigation;
  }
  if (!isRecord(value)) return emptyNavigation;
  const expandedProjectIds = Array.isArray(value["expandedProjectIds"]) ? value["expandedProjectIds"].filter((id): id is string => typeof id === "string") : [];
  const sessionCaps: Record<string, number> = {};
  if (isRecord(value["sessionCaps"])) {
    for (const [projectId, cap] of Object.entries(value["sessionCaps"])) {
      if (typeof cap === "number" && Number.isFinite(cap) && cap >= defaultSessionCap) sessionCaps[projectId] = cap;
    }
  }
  return {
    expandedProjectIds,
    sessionCaps,
    showArchived: value["showArchived"] === true,
    searchText: "",
  };
}

/**
 * A machine's pins: pinned projects first, pinned sessions first inside a project.
 *
 * `pins` is undefined while the read runs and stays undefined when it failed,
 * which callers render as "pins unknown" rather than as nothing pinned.
 */
export const pinsStore: Store<ReadState<MachinePins | undefined>> = createStore<ReadState<MachinePins | undefined>>({
  value: undefined,
  phase: "idle",
  error: undefined,
});

export function usePins(): ReadState<MachinePins | undefined> {
  return useStoreSelect(pinsStore, (value) => value);
}

let pinsReading: Promise<void> | undefined;

export function readPins(machineId: string): Promise<void> {
  if (pinsReading !== undefined) return pinsReading;
  pinsStore.update((current) => ({ ...current, phase: current.value === undefined ? "loading" : "refused" }));
  const reading = sessionPinsApi
    .pins(machineId)
    .then(
      (pins) => {
        pinsStore.set({ value: pins, phase: "ready", error: undefined });
      },
      (error: unknown) => {
        pinsStore.set({ ...readFailed(error), value: pinsStore.get().value });
      },
    )
    .finally(() => {
      if (pinsReading === reading) pinsReading = undefined;
    });
  pinsReading = reading;
  return reading;
}

export function pinnedProjectIds(pins: MachinePins | undefined): ReadonlySet<string> {
  const ids = pins?.pinnedProjects;
  return ids === undefined ? new Set<string>() : new Set(ids);
}

