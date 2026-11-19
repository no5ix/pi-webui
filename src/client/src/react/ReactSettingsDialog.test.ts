// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReactSettingsDialog } from "./ReactSettingsDialog";
import type { ReactSettingsDialogProps } from "./ReactSettingsDialog";

let container: HTMLDivElement;
let root: Root;

const data: ReactSettingsDialogProps["data"] = {
  state: { selectedMachine: undefined, machines: [], error: "" },
  selectedProject: undefined,
  settings: { loading: false },
  loadSettings: vi.fn(() => Promise.resolve()),
  saveSettings: vi.fn(() => Promise.resolve()),
  setPluginEnabled: vi.fn(() => Promise.resolve()),
  installPackage: vi.fn(() => Promise.resolve()),
  updatePackage: vi.fn(() => Promise.resolve()),
  removePackage: vi.fn(() => Promise.resolve()),
  setSkillEnabled: vi.fn(() => Promise.resolve()),
  setMcpEnabled: vi.fn(() => Promise.resolve()),
  testMcp: vi.fn(() => Promise.resolve()),
  removeMcp: vi.fn(() => Promise.resolve()),
  saveMcp: vi.fn(() => Promise.resolve()),
  selectMachine: vi.fn(() => Promise.resolve()),
  addMachine: vi.fn(() => Promise.resolve()),
  renameMachine: vi.fn(() => Promise.resolve()),
  removeMachine: vi.fn(() => Promise.resolve()),
};

describe("React Settings dialog", () => {
  beforeEach(() => {
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
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    document.body.replaceChildren();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    vi.restoreAllMocks();
  });

  it("opens as a named modal with all required settings pages and loads live settings", async () => {
    await act(async () => { root.render(createElement(ReactSettingsDialog, { data, open: true, onClose: vi.fn() })); await Promise.resolve(); });
    const dialog = container.querySelector("dialog");
    expect(dialog?.hasAttribute("open")).toBe(true);
    expect(dialog?.getAttribute("aria-labelledby")).toBe("rw-settings-title");
    expect([...container.querySelectorAll(".rw-settings-nav button")].map(button => button.textContent)).toEqual([
      "General", "Appearance", "Notifications", "Pi Packages", "MCP Servers", "Pi Web Plugins", "Machines", "Skills",
    ]);
    expect(data.loadSettings).toHaveBeenCalledOnce();
  });

  it("changes pages and returns close requests to the owner", async () => {
    const onClose = vi.fn();
    await act(async () => { root.render(createElement(ReactSettingsDialog, { data, open: true, onClose })); await Promise.resolve(); });
    const appearance = [...container.querySelectorAll(".rw-settings-nav button")].find(button => button.textContent === "Appearance");
    expect(appearance).toBeDefined();
    await act(async () => { appearance?.dispatchEvent(new MouseEvent("click", { bubbles: true })); await Promise.resolve(); });
    expect(container.querySelector(".rw-settings-page-heading h3")?.textContent).toBe("Appearance");
    const close = container.querySelector<HTMLButtonElement>("button[aria-label='Close settings']");
    expect(close).not.toBeNull();
    await act(async () => { close?.click(); await Promise.resolve(); });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
