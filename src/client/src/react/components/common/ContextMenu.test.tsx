// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";

const anchor = new DOMRect(120, 80, 120, 24);

function menu(items: readonly ContextMenuItem[], onClose = vi.fn()): void {
  render(<ContextMenu anchor={anchor} items={items} onClose={onClose} open={true} />);
}

describe("ContextMenu", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders one menuitem per action and a separator row", () => {
    menu([
      { label: "Rename", onSelect: () => undefined },
      { label: "Copy path", separator: true },
      { label: "Archive", onSelect: () => undefined },
    ]);
    const items = screen.getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual(["Rename", "Archive"]);
    expect(screen.getByRole("separator")).toBeTruthy();
  });

  it("runs the chosen action and closes the menu", () => {
    const onClose = vi.fn();
    const onDelete = vi.fn();
    menu([{ label: "Delete", onSelect: onDelete }, { label: "Rename", onSelect: () => undefined }], onClose);
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps a disabled action unfired", () => {
    const onArchive = vi.fn();
    const onClose = vi.fn();
    menu([{ label: "Archive", onSelect: onArchive, disabled: true }], onClose);
    const row = screen.getByRole("menuitem", { name: "Archive" });
    expect(row.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(row);
    expect(onArchive).not.toHaveBeenCalled();
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    menu([{ label: "Rename", onSelect: () => undefined }], onClose);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
