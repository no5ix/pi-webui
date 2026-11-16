import { describe, expect, it } from "vitest";
import {
  WORKBENCH_KINDS,
  WORKBENCH_UNAVAILABLE_MESSAGES,
  workbenchKindOfPanel,
  workbenchTabs,
  type WorkbenchPanel,
  type WorkbenchSlots,
} from "./workbenchTabs.js";

const panel = (id: string, title: string, extra: Partial<WorkbenchPanel> = {}): WorkbenchPanel => ({
  id,
  localId: id.slice(id.lastIndexOf(":") + 1),
  title,
  ...extra,
});

const RESOLVED = { files: "core:workspace.files", terminal: "terminal:global.terminal" };

describe("the workbench's four tabs", () => {
  it("recognises the Git panel the Git plugin registers, by its own words", () => {
    expect(workbenchKindOfPanel(panel("git:workspace.git", "Git"), RESOLVED)).toBe("git");
    expect(workbenchKindOfPanel(panel("acme.source-control:panel", "Source control"), RESOLVED)).toBe("git");
  });

  it("reads the Files and Terminal tabs from the ids the host resolved", () => {
    expect(workbenchKindOfPanel(panel("core:workspace.files", "Files"), RESOLVED)).toBe("files");
    expect(workbenchKindOfPanel(panel("files:files", "Files"), RESOLVED)).toBe("files");
    expect(workbenchKindOfPanel(panel("terminal:global.terminal", "Terminal"), RESOLVED)).toBe("terminal");
    expect(workbenchKindOfPanel(panel("terminal:terminal", "Terminals"), RESOLVED)).toBe("terminal");
  });

  it("recognises the Goals tab, including a plugin that calls it something else", () => {
    expect(workbenchKindOfPanel(panel("goal:workspace.goals", "Goals"), RESOLVED)).toBe("goals");
    expect(workbenchKindOfPanel(panel("acme:objectives", "Project objectives"), RESOLVED)).toBe("goals");
  });

  it("leaves a conversation surface out of the tabs: it is that conversation's view, not a tool", () => {
    expect(workbenchKindOfPanel(panel("core:changes", "Changes", { fronts: "session-changes" }), RESOLVED)).toBeUndefined();
    expect(workbenchKindOfPanel(panel("goal:session-goal", "Goal", { fronts: "session-goal" }), RESOLVED)).toBeUndefined();
  });

  it("returns nothing for a panel that is not one of the four", () => {
    expect(workbenchKindOfPanel(panel("info:workspace.info", "Info"), RESOLVED)).toBeUndefined();
    expect(workbenchKindOfPanel(panel("background-runs:workspace.background", "Background Runs"), RESOLVED)).toBeUndefined();
  });
});

describe("the tab strip", () => {
  it("always draws Git, Files, Terminal and Goals, in that order", () => {
    const tabs = workbenchTabs({}, undefined, undefined);
    expect(tabs.map((tab) => tab.kind)).toEqual([...WORKBENCH_KINDS]);
    expect(tabs.map((tab) => tab.label)).toEqual(["Git", "Files", "Terminal", "Goals"]);
  });

  it("disables a tab with no panel and says the reason the reader can act on", () => {
    const tabs = workbenchTabs({}, undefined, undefined);
    for (const kind of WORKBENCH_KINDS) {
      const tab = tabs.find((entry) => entry.kind === kind);
      expect(tab?.disabled).toBe(true);
      expect(tab?.detail).toBe(WORKBENCH_UNAVAILABLE_MESSAGES[kind]);
    }
  });

  it("selects only the tab whose panel the column is showing", () => {
    const slots: WorkbenchSlots = { git: panel("git:workspace.git", "Git"), files: panel("files:files", "Files") };
    const tabs = workbenchTabs(slots, "files:files", undefined);
    expect(tabs.filter((tab) => tab.selected).map((tab) => tab.kind)).toEqual(["files"]);
    expect(tabs.find((tab) => tab.kind === "git")?.detail).toBe("Git");
  });

  it("selects no tab when the column shows something outside the four", () => {
    const slots: WorkbenchSlots = { git: panel("git:workspace.git", "Git") };
    expect(workbenchTabs(slots, "updates:global.updates", undefined).some((tab) => tab.selected)).toBe(false);
  });

  it("carries the changed-file count on the Git tab, and nothing on the others", () => {
    const slots: WorkbenchSlots = { git: panel("git:workspace.git", "Git"), goals: panel("goal:workspace.goals", "Goals") };
    const tabs = workbenchTabs(slots, "goal:workspace.goals", 3);
    expect(tabs.find((tab) => tab.kind === "git")?.badge).toBe(3);
    expect(tabs.find((tab) => tab.kind === "goals")?.badge).toBeUndefined();
  });

  it("keeps a count of zero a count, and an unread repository silent", () => {
    const slots: WorkbenchSlots = { git: panel("git:workspace.git", "Git") };
    expect(workbenchTabs(slots, "git:workspace.git", 0).find((tab) => tab.kind === "git")?.badge).toBe(0);
    expect(workbenchTabs(slots, "git:workspace.git", undefined).find((tab) => tab.kind === "git")?.badge).toBeUndefined();
  });
});
