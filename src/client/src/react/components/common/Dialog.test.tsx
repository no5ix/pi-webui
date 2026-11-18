// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dialog } from "./Dialog";

describe("Dialog", () => {
  afterEach(() => {
    cleanup();
  });

  it("labels the modal with its title and shows the body", () => {
    render(
      <Dialog onClose={() => undefined} open={true} title="Rename session">
        <p>The name the machine will store.</p>
      </Dialog>,
    );
    const dialog = screen.getByRole("dialog", { name: "Rename session" });
    expect(dialog.textContent).toContain("The name the machine will store.");
  });

  it("closes on Escape and on the close button", () => {
    const onClose = vi.fn();
    render(
      <Dialog onClose={onClose} open={true} title="Rename project">
        <p>body</p>
      </Dialog>,
    );
    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("renders the footer actions so a caller can confirm", () => {
    const onConfirm = vi.fn();
    render(
      <Dialog
        footer={<button onClick={onConfirm} type="button">Save</button>}
        onClose={() => undefined}
        open={true}
        title="Add a project"
      >
        <p>path</p>
      </Dialog>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
