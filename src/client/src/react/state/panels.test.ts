// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PANEL_SIZE_STORAGE_KEY } from "../../appShell/panelResizeController";

const collapseStorageKey = "pi-web-react:panels:v1";

async function loadPanels(): Promise<typeof import("./panels")> {
  vi.resetModules();
  return await import("./panels");
}

beforeEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

describe("panel state", () => {
  it("opens on the reference widths on a fresh browser", async () => {
    const panels = await loadPanels();
    const state = panels.panelStore.get();
    expect(state.navigationWidth).toBe(panels.referencePanelWidths.navigation);
    expect(state.workbenchWidth).toBe(panels.referencePanelWidths.workspace);
    expect(state.workbenchTab).toBe("files");
    expect(state.navigationCollapsed).toBe(false);
    expect(state.workbenchCollapsed).toBe(false);
  });

  it("keeps the widths a previous visit stored", async () => {
    localStorage.setItem(PANEL_SIZE_STORAGE_KEY, JSON.stringify({ version: 1, navigationPanelWidth: 340, workspacePanelWidth: 500 }));
    const panels = await loadPanels();
    const state = panels.panelStore.get();
    expect(state.navigationWidth).toBe(340);
    expect(state.workbenchWidth).toBe(500);
  });

  it("treats a stored envelope it cannot trust as no stored width", async () => {
    localStorage.setItem(PANEL_SIZE_STORAGE_KEY, JSON.stringify({ navigationPanelWidth: 340 }));
    localStorage.setItem(collapseStorageKey, "{ not json");
    const panels = await loadPanels();
    const state = panels.panelStore.get();
    expect(state.navigationWidth).toBe(panels.referencePanelWidths.navigation);
    expect(state.navigationCollapsed).toBe(false);
    expect(state.workbenchTab).toBe("files");
  });

  it("keeps a stored tab it recognises and drops one it does not", async () => {
    localStorage.setItem(collapseStorageKey, JSON.stringify({ navigation: true, workbench: false, tab: "terminal" }));
    const restored = await loadPanels();
    expect(restored.panelStore.get().workbenchTab).toBe("terminal");
    expect(restored.panelStore.get().navigationCollapsed).toBe(true);

    localStorage.setItem(collapseStorageKey, JSON.stringify({ tab: "editor" }));
    const rejected = await loadPanels();
    expect(rejected.panelStore.get().workbenchTab).toBe("files");
  });

  it("clamps a width to the shared constraints and persists the clamped number", async () => {
    const panels = await loadPanels();
    panels.setPanelWidth("navigation", 20);
    expect(panels.panelStore.get().navigationWidth).toBe(panels.panelConstraints("navigation").minWidth);
    const envelope: unknown = JSON.parse(localStorage.getItem(PANEL_SIZE_STORAGE_KEY) ?? "null");
    expect(envelope).toMatchObject({ version: 1, navigationPanelWidth: panels.panelConstraints("navigation").minWidth });

    panels.setPanelWidth("workspace", 9999);
    expect(panels.panelStore.get().workbenchWidth).toBe(panels.panelConstraints("workspace").maxWidth);
  });

  it("selecting a workbench tab reveals a collapsed workbench and survives a reload", async () => {
    const panels = await loadPanels();
    panels.togglePanel("workspace");
    expect(panels.panelStore.get().workbenchCollapsed).toBe(true);
    panels.setWorkbenchTab("terminal");
    expect(panels.panelStore.get().workbenchCollapsed).toBe(false);
    const restored = await loadPanels();
    expect(restored.panelStore.get().workbenchTab).toBe("terminal");
  });

  it("does not resurrect a plugin tab whose surface a reload cannot vouch for", async () => {
    const panels = await loadPanels();
    panels.setWorkbenchTab("plugin", "plugin:notes");
    expect(panels.panelStore.get().activePluginTab).toBe("plugin:notes");
    const restored = await loadPanels();
    expect(restored.panelStore.get().workbenchTab).toBe("files");
    expect(restored.panelStore.get().activePluginTab).toBeUndefined();
  });

  it("collapses and expands a side column in step", async () => {
    const panels = await loadPanels();
    panels.togglePanel("navigation");
    expect(panels.panelStore.get().navigationCollapsed).toBe(true);
    expect(JSON.parse(localStorage.getItem(collapseStorageKey) ?? "null")).toMatchObject({ navigation: true });
    panels.togglePanel("navigation");
    expect(panels.panelStore.get().navigationCollapsed).toBe(false);
  });

  it("keeps a drag and a keyboard resize on the same arithmetic as the app", async () => {
    const panels = await loadPanels();
    expect(panels.dragPanelWidth("navigation", 302, 100, 150)).toBe(352);
    expect(panels.dragPanelWidth("workspace", 388, 900, 850)).toBe(438);
    expect(panels.keyboardPanelWidth("navigation", 302, "ArrowRight")).toBe(326);
    expect(panels.keyboardPanelWidth("workspace", 388, "Home")).toBe(panels.panelConstraints("workspace").minWidth);
    expect(panels.keyboardPanelWidth("navigation", 302, "PageUp")).toBeUndefined();
  });
});
