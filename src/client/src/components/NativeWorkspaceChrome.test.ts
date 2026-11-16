import { afterEach, describe, expect, it, vi } from "vitest";
import { fixture, html } from "@open-wc/testing";
import type { SessionInfo } from "../api";
import { RunningSessionsPanel, WorkspaceTabBar, ConversationDisclosure } from "./NativeWorkspaceChrome";

describe("running-sessions-panel", () => {
  afterEach(() => { vi.restoreAllMocks(); });
  it("shows only sessions which are currently active", async () => {
    const sessions = [
      { id: "active", cwd: "/project", name: "Active session" },
      { id: "idle", cwd: "/project", name: "Idle session" },
      { id: "archived", cwd: "/project", name: "Archived session", archived: true },
    ] as SessionInfo[];
    const el = await fixture<RunningSessionsPanel>(html`<running-sessions-panel></running-sessions-panel>`);
    el.sessions = sessions;
    el.sessionStatuses = {
      active: { sessionId: "active", isStreaming: true },
      idle: { sessionId: "idle", isStreaming: false },
      archived: { sessionId: "archived", isStreaming: true },
    } as never;
    el.sessionActivities = {} as never;
    await el.updateComplete;
    const labels = Array.from(el.shadowRoot!.querySelectorAll(".session .name")).map((row) => row.textContent?.trim());
    expect(labels).toEqual(["Active session"]);
  });
});

describe("workspace-tab-bar", () => {
  it("keeps all four tabs visible while changing selection", async () => {
    const onSelect = vi.fn();
    const el = await fixture<WorkspaceTabBar>(html`<workspace-tab-bar></workspace-tab-bar>`);
    el.onSelect = onSelect;
    el.tabs = [
      { id: "git", label: "Git" },
      { id: "files", label: "Files" },
      { id: "terminal", label: "Terminal" },
      { id: "goals", label: "Goals" },
    ];
    el.active = "files";
    await el.updateComplete;
    const buttons = Array.from(el.shadowRoot!.querySelectorAll<HTMLButtonElement>("[role=tab]"));
    expect(buttons.map((button) => button.textContent?.trim())).toEqual(["Git", "Files", "Terminal", "Goals"]);
    expect(buttons[1]?.getAttribute("aria-selected")).toBe("true");
    buttons[2]?.click();
    expect(onSelect).toHaveBeenCalledWith("terminal");
    expect(el.shadowRoot!.querySelectorAll("[role=tab]")).toHaveLength(4);
  });
  it("shows the Git badge only for a positive edited-file count", async () => {
    const el = await fixture<WorkspaceTabBar>(html`<workspace-tab-bar></workspace-tab-bar>`);
    el.tabs = [{ id: "git", label: "Git" }];
    el.editedCount = 3;
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".badge")?.textContent).toBe("3");
    el.editedCount = 0;
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".badge")).toBeNull();
  });
});

describe("conversation-disclosure", () => {
  it("starts collapsed and reveals content when activated", async () => {
    const el = await fixture<ConversationDisclosure>(html`<conversation-disclosure heading="Edited Files"><span>file.ts</span></conversation-disclosure>`);
    expect(el.expanded).toBe(false);
    expect(el.shadowRoot!.querySelector(".content")).toBeNull();
    el.shadowRoot!.querySelector<HTMLButtonElement>(".toggle")!.click();
    await el.updateComplete;
    expect(el.expanded).toBe(true);
    expect(el.shadowRoot!.querySelector(".content")).not.toBeNull();
  });
});
