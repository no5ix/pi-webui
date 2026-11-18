import { useEffect } from "react";
import {
  PANEL_RESIZE_CONSTRAINTS,
  clampPanelWidth,
  panelWidthFromDrag,
  panelWidthFromKeyboard,
  readStoredPanelSizes,
  writeStoredPanelSizes,
  type ResizablePanelSide,
} from "../../appShell/panelResizeController";
import { isRecord } from "../../../../shared/unknownValues";
import { createStore, useStoreSelect } from "./store";

/**
 * The shell's own panel state: the two draggable widths, the collapsed state of
 * each side column, and the workbench tab.
 *
 * The width maths, the constraints, the keyboard steps and the stored envelope
 * (`pi-web:panel-sizes:v1`) are PI WEB's, imported whole — a React drag and a
 * keyboard resize land on the same numbers the app has always used. The
 * reference design decides the defaults the first time a reader uses the shell:
 * 302 for the rail and 388 for the workbench, the widths the screenshot measures.
 */
export type { ResizablePanelSide };

export type WorkbenchTab = "git" | "files" | "terminal" | "goals" | "plugin";

export const workbenchTabOrder: readonly WorkbenchTab[] = ["git", "files", "terminal", "goals"] as const;

export const referencePanelWidths: Record<ResizablePanelSide, number> = {
  navigation: 302,
  workspace: 388,
};

const collapseStorageKey = "pi-web-react:panels:v1";

export interface PanelState {
  readonly navigationWidth: number;
  readonly workbenchWidth: number;
  readonly navigationCollapsed: boolean;
  readonly workbenchCollapsed: boolean;
  readonly workbenchTab: WorkbenchTab;
  readonly activePluginTab: string | undefined;
}

function clamp(side: ResizablePanelSide, width: number): number {
  return clampPanelWidth(side, width);
}

function readStoredPanels(): PanelState {
  const sizes = readStoredPanelSizes();
  const collapsed = readCollapsed();
  return {
    navigationWidth: clamp("navigation", sizes.navigationPanelWidth ?? referencePanelWidths.navigation),
    workbenchWidth: clamp("workspace", sizes.workspacePanelWidth ?? referencePanelWidths.workspace),
    navigationCollapsed: collapsed.navigation,
    workbenchCollapsed: collapsed.workbench,
    workbenchTab: collapsed.tab,
    activePluginTab: undefined,
  };
}

interface StoredCollapse {
  navigation: boolean;
  workbench: boolean;
  tab: WorkbenchTab;
}

function isWorkbenchTab(value: unknown): value is WorkbenchTab {
  return workbenchTabOrder.some((tab) => tab === value);
}

function readCollapsed(): StoredCollapse {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(collapseStorageKey) ?? "null");
    if (isRecord(parsed)) {
      const tab = parsed["tab"];
      return {
        navigation: parsed["navigation"] === true,
        workbench: parsed["workbench"] === true,
        tab: isWorkbenchTab(tab) ? tab : "files",
      };
    }
  } catch {
    // A browser that refuses storage, or a value that did not survive, gets the default layout.
  }
  return { navigation: false, workbench: false, tab: "files" };
}

function writeCollapsed(state: PanelState): void {
  try {
    window.localStorage.setItem(
      collapseStorageKey,
      JSON.stringify({ navigation: state.navigationCollapsed, workbench: state.workbenchCollapsed, tab: state.workbenchTab } satisfies StoredCollapse),
    );
  } catch {
    return;
  }
}

export const panelStore = createStore<PanelState>(readStoredPanels());

export function usePanels(): PanelState {
  return useStoreSelect(panelStore, (value) => value);
}

export function setPanelWidth(side: ResizablePanelSide, width: number): void {
  panelStore.update((current) => {
    const next = { ...current, [side === "navigation" ? "navigationWidth" : "workbenchWidth"]: clamp(side, width) };
    writeStoredPanelSizes({
      navigationPanelWidth: next.navigationWidth,
      workspacePanelWidth: next.workbenchWidth,
    });
    return next;
  });
}

export function dragPanelWidth(side: ResizablePanelSide, startWidth: number, startClientX: number, currentClientX: number): number {
  return panelWidthFromDrag(side, startWidth, startClientX, currentClientX);
}

export function keyboardPanelWidth(side: ResizablePanelSide, currentWidth: number, key: string): number | undefined {
  return panelWidthFromKeyboard(side, currentWidth, key);
}

/**
 * Collapses or opens a side panel by name. The phone layout needs to put the
 * navigation away when the window narrows, where `togglePanel` can only flip it.
 */
export function setPanelCollapsed(side: ResizablePanelSide, collapsed: boolean): void {
  panelStore.update((current) => {
    const next = side === "navigation"
      ? { ...current, navigationCollapsed: collapsed }
      : { ...current, workbenchCollapsed: collapsed };
    if (next.navigationCollapsed === current.navigationCollapsed && next.workbenchCollapsed === current.workbenchCollapsed) {
      return current;
    }
    writeCollapsed(next);
    return next;
  });
}

export function togglePanel(side: ResizablePanelSide): void {
  panelStore.update((current) => {
    const next = side === "navigation"
      ? { ...current, navigationCollapsed: !current.navigationCollapsed }
      : { ...current, workbenchCollapsed: !current.workbenchCollapsed };
    writeCollapsed(next);
    return next;
  });
}

export function setWorkbenchTab(tab: WorkbenchTab, pluginId?: string): void {
  panelStore.update((current) => {
    const next = { ...current, workbenchTab: tab, activePluginTab: pluginId, workbenchCollapsed: false };
    writeCollapsed(next);
    return next;
  });
}

/**
 * Which layer is open, spelled as a key.
 *
 * The shell, the panels and the overlays all speak the same word for "the layer
 * on screen": a panel registers a command that opens `settings:appearance`, the
 * layer key names the surface, and the browser's Back closes the top layer first
 * because the key travels with the history frame the dialog pushes.
 */
export type LayerKey = "none" | "palette" | "switcher" | "new-project" | (string & {});

const layerStore = createStore<{ key: LayerKey }>({ key: "none" });

export function openLayer(key: LayerKey): void {
  layerStore.set({ key });
}

export function closeLayer(): void {
  layerStore.set({ key: "none" });
}

export function useLayerKey(): LayerKey {
  return useStoreSelect(layerStore, (state) => state.key);
}

export function selectWorkbenchTab(tab: number): void {
  const target = workbenchTabOrder[tab - 1];
  if (target === undefined) return;
  setWorkbenchTab(target);
}

export function panelConstraints(side: ResizablePanelSide): { minWidth: number; maxWidth: number } {
  return { minWidth: PANEL_RESIZE_CONSTRAINTS[side].minWidth, maxWidth: PANEL_RESIZE_CONSTRAINTS[side].maxWidth };
}

/** Keep the stored widths and collapse state durable behind the store. */
export function usePanelPersistence(): void {
  useEffect(() => {
    const unsubscribe = panelStore.subscribe(() => {
      const state = panelStore.get();
      writeCollapsed(state);
      writeStoredPanelSizes({ navigationPanelWidth: state.navigationWidth, workspacePanelWidth: state.workbenchWidth });
    });
    return unsubscribe;
  }, []);
}
