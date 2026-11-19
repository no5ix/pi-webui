// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo } from "../api";
import { SessionActionsMenu } from "./SessionActionsMenu";

let container: HTMLDivElement;
let root: Root;
const session: SessionInfo = {
  id: "session-1", cwd: "/workspace", path: "/workspace/session.jsonl", created: "2026-01-01T00:00:00Z",
  modified: "2026-01-01T00:00:00Z", messageCount: 1, firstMessage: "Hello",
};

describe("React session actions", () => {
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

  it("requires archive confirmation and calls the controller action", async () => {
    const archive = vi.fn(() => Promise.resolve());
    await act(async () => { root.render(createElement(SessionActionsMenu, { session, machineId: "remote-1", pending: false, rename: vi.fn(() => Promise.resolve()), archive, restore: vi.fn(() => Promise.resolve()), deleteArchived: vi.fn(() => Promise.resolve()) })); await Promise.resolve(); });
    const button = [...container.querySelectorAll("button")].find(item => item.textContent === "Archive session");
    expect(container.querySelector('[role="menu"], [role="menuitem"]')).toBeNull();
    await act(async () => { button?.click(); await Promise.resolve(); });
    expect(container.querySelector<HTMLDialogElement>(".rw-confirm-dialog")?.open).toBe(true);
    const confirmButton = [...container.querySelectorAll<HTMLButtonElement>(".rw-confirm-dialog button")].find(item => item.textContent === "Archive session");
    await act(async () => { confirmButton?.click(); await Promise.resolve(); });
    expect(archive).toHaveBeenCalledOnce();
    expect(container.querySelector("details")?.open).toBe(false);
    expect(document.activeElement).toBe(container.querySelector("summary"));
  });

  it("offers restore and confirmed permanent deletion only for archived sessions", async () => {
    const restore = vi.fn(() => Promise.resolve());
    const deleteArchived = vi.fn(() => Promise.resolve());
    await act(async () => { root.render(createElement(SessionActionsMenu, { session: { ...session, archived: true }, machineId: "remote-1", pending: false, rename: vi.fn(() => Promise.resolve()), archive: vi.fn(() => Promise.resolve()), restore, deleteArchived })); await Promise.resolve(); });
    expect([...container.querySelectorAll(".rw-session-actions-menu > button")].map(item => item.textContent)).toEqual(["Rename session", "Restore session", "Delete archived session"]);
    const restoreButton = [...container.querySelectorAll("button")].find(item => item.textContent === "Restore session");
    await act(async () => { restoreButton?.click(); await Promise.resolve(); });
    expect(restore).toHaveBeenCalledOnce();
    const deleteButton = [...container.querySelectorAll("button")].find(item => item.textContent === "Delete archived session");
    await act(async () => { deleteButton?.click(); await Promise.resolve(); });
    expect(container.querySelector<HTMLDialogElement>(".rw-confirm-dialog")?.open).toBe(true);
    const confirmButton = [...container.querySelectorAll<HTMLButtonElement>(".rw-confirm-dialog button")].find(item => item.textContent === "Delete permanently");
    await act(async () => { confirmButton?.click(); await Promise.resolve(); });
    expect(deleteArchived).toHaveBeenCalledOnce();
  });

  it("keeps an open confirmation bound to its original session and machine", async () => {
    const archive = vi.fn(() => Promise.resolve());
    const common = { pending: false, rename: vi.fn(() => Promise.resolve()), archive, restore: vi.fn(() => Promise.resolve()), deleteArchived: vi.fn(() => Promise.resolve()) };
    await act(async () => { root.render(createElement(SessionActionsMenu, { ...common, session, machineId: "remote-1" })); await Promise.resolve(); });
    const archiveButton = [...container.querySelectorAll("button")].find(item => item.textContent === "Archive session");
    await act(async () => { archiveButton?.click(); await Promise.resolve(); });

    const differentSession = { ...session, id: "session-2", name: "Another session" };
    await act(async () => { root.render(createElement(SessionActionsMenu, { ...common, session: differentSession, machineId: "remote-2" })); await Promise.resolve(); });
    expect(container.querySelector(".rw-confirm-dialog")?.textContent).toContain("Hello");
    expect(container.querySelector(".rw-confirm-dialog")?.textContent).not.toContain("Another session");

    const confirmButton = [...container.querySelectorAll<HTMLButtonElement>(".rw-confirm-dialog button")].find(item => item.textContent === "Archive session");
    await act(async () => { confirmButton?.click(); await Promise.resolve(); });
    expect(archive).toHaveBeenCalledWith(session, "remote-1");
  });

  it("disables all session mutations while an action is pending", async () => {
    const archive = vi.fn(() => Promise.resolve());
    await act(async () => { root.render(createElement(SessionActionsMenu, { session: { ...session, archived: true }, machineId: "remote-1", pending: true, rename: vi.fn(() => Promise.resolve()), archive, restore: vi.fn(() => Promise.resolve()), deleteArchived: vi.fn(() => Promise.resolve()) })); await Promise.resolve(); });
    expect([...container.querySelectorAll<HTMLButtonElement>(".rw-session-actions-menu > button")].every(button => button.disabled)).toBe(true);
    expect(archive).not.toHaveBeenCalled();
  });

  it("closes the disclosure on Escape and restores focus to its summary", async () => {
    await act(async () => { root.render(createElement(SessionActionsMenu, { session, machineId: "remote-1", pending: false, rename: vi.fn(() => Promise.resolve()), archive: vi.fn(() => Promise.resolve()), restore: vi.fn(() => Promise.resolve()), deleteArchived: vi.fn(() => Promise.resolve()) })); await Promise.resolve(); });
    const details = container.querySelector("details");
    const summary = container.querySelector("summary");
    if (details === null || summary === null) throw new Error("Session actions disclosure did not render.");
    await act(async () => { summary.click(); await Promise.resolve(); });
    await act(async () => { details.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); await Promise.resolve(); });
    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(summary);
  });

  it("leaves Escape from the confirmation dialog to the dialog cancel behavior", async () => {
    const archive = vi.fn(() => Promise.resolve());
    await act(async () => { root.render(createElement(SessionActionsMenu, { session, machineId: "remote-1", pending: false, rename: vi.fn(() => Promise.resolve()), archive, restore: vi.fn(() => Promise.resolve()), deleteArchived: vi.fn(() => Promise.resolve()) })); await Promise.resolve(); });
    const details = container.querySelector("details");
    const summary = container.querySelector("summary");
    const action = [...container.querySelectorAll<HTMLButtonElement>(".rw-session-actions-menu > button")].find(item => item.textContent === "Archive session");
    if (details === null || summary === null || action === undefined) throw new Error("Session archive action did not render.");
    await act(async () => { summary.click(); await Promise.resolve(); });
    await act(async () => { action.click(); await Promise.resolve(); });
    const dialog = container.querySelector<HTMLDialogElement>(".rw-confirm-dialog");
    if (dialog === null) throw new Error("Session archive confirmation did not render.");
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    act(() => { dialog.dispatchEvent(escape); });

    expect(escape.defaultPrevented).toBe(false);
    expect(details.open).toBe(true);
    expect(dialog.open).toBe(true);
    expect(archive).not.toHaveBeenCalled();
    await act(async () => { dialog.close(); await Promise.resolve(); });
  });
});
