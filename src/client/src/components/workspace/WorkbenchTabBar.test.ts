// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { WorkbenchTabBar } from "./WorkbenchTabBar";
import { workbenchTabs, type WorkbenchPanel, type WorkbenchSlots } from "../../workspace/workbenchTabs";

afterEach(() => { document.body.replaceChildren(); });

const panel = (id: string, title: string): WorkbenchPanel => ({ id, localId: id.slice(id.lastIndexOf(":") + 1), title });

const SLOTS: WorkbenchSlots = {
  git: panel("git:workspace.git", "Git"),
  files: panel("files:files", "Files"),
  terminal: panel("terminal:global.terminal", "Terminal"),
};

async function mount(overrides: Partial<WorkbenchTabBar> = {}): Promise<WorkbenchTabBar> {
  const bar = new WorkbenchTabBar();
  Object.assign(bar, overrides);
  document.body.append(bar);
  await bar.updateComplete;
  return bar;
}

const tabs = (bar: WorkbenchTabBar) => [...bar.renderRoot.querySelectorAll<HTMLButtonElement>("[role=tab]")];

describe("the workbench tab strip", () => {
  it("draws a tab for each of the four tools, named by the panel under it", async () => {
    const bar = await mount({ tabs: workbenchTabs(SLOTS, "files:files", 4) });
    const labels = tabs(bar).map((tab) => tab.querySelector(".label")?.textContent.trim());
    expect(labels).toEqual(["Git", "Files", "Terminal", "Goals"]);
  });

  it("marks only the panel on screen selected, for the reader and for assistive technology", async () => {
    const bar = await mount({ tabs: workbenchTabs(SLOTS, "files:files", undefined) });
    const selected = tabs(bar).filter((tab) => tab.getAttribute("aria-selected") === "true");
    expect(selected).toHaveLength(1);
    expect(selected[0]?.textContent.trim()).toBe("Files");
  });

  it("carries the Git tab's changed-file count as its badge", async () => {
    const bar = await mount({ tabs: workbenchTabs(SLOTS, "git:workspace.git", 7) });
    const git = tabs(bar)[0];
    expect(git?.querySelector(".badge")?.textContent.trim()).toBe("7");
    expect(tabs(bar)[1]?.querySelector(".badge")).toBeNull();
  });

  it("keeps a tab with no panel under it visible, disabled, and explained", async () => {
    const chosen: string[] = [];
    const bar = await mount({ tabs: workbenchTabs(SLOTS, "git:workspace.git", undefined), onSelect: (kind) => { chosen.push(kind); } });
    const goals = tabs(bar).find((tab) => tab.textContent.includes("Goals"));
    expect(goals?.disabled).toBe(true);
    expect(goals?.title).toBe("No Goals panel is registered for the selected project.");
    goals?.click();
    expect(chosen).toEqual([]);
  });

  it("hands the tab's tool to the app when the reader chooses it", async () => {
    const chosen: string[] = [];
    const bar = await mount({ tabs: workbenchTabs(SLOTS, "git:workspace.git", undefined), onSelect: (kind) => { chosen.push(kind); } });
    const terminal = tabs(bar).find((tab) => tab.textContent.includes("Terminal"));
    terminal?.click();
    expect(chosen).toEqual(["terminal"]);
  });
});
