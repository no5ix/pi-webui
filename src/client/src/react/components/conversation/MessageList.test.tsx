// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatLine } from "../../../components/shared";
import { MessageList } from "./MessageList";

const userLine: ChatLine = {
  role: "user",
  parts: [{ type: "text", text: "Take a screenshot of the docs site" }],
};

const assistantLine: ChatLine = {
  role: "assistant",
  parts: [{ type: "text", text: "Saved it to docs/assets/demo.png" }],
};

const toolLine: ChatLine = {
  role: "assistant",
  parts: [
    { type: "toolCall", toolCallId: "call-1", toolName: "bash", summary: "capture-browser-screenshot" },
    { type: "toolResult", toolCallId: "call-1", toolName: "bash", text: "wrote docs/assets/demo.png", isError: false },
  ],
};

function renderList(overrides: Partial<ComponentProps<typeof MessageList>> = {}) {
  const props: ComponentProps<typeof MessageList> = {
    machineId: "local",
    sessionId: "session-1",
    messages: [userLine, assistantLine, toolLine],
    streaming: false,
    connection: "live",
    hasOlder: false,
    hasNewer: false,
    loadingOlder: false,
    loadingNewer: false,
    wide: false,
    onOlder: vi.fn(),
    onNewer: vi.fn(),
    ...overrides,
  };
  const view = render(<MessageList {...props} />);
  return { view, props };
}

describe("the transcript", () => {
  afterEach(() => {
    cleanup();
  });

  it("draws what was said, in order, by role", () => {
    const { view } = renderList();
    const text = view.container.textContent ?? "";
    expect(text).toContain("Take a screenshot of the docs site");
    expect(text).toContain("Saved it to docs/assets/demo.png");
    const user = text.indexOf("Take a screenshot");
    const assistant = text.indexOf("Saved it to docs/assets");
    expect(user).toBeGreaterThanOrEqual(0);
    expect(assistant).toBeGreaterThan(user);
  });

  it("collapses a tool group to a count and reveals its rows when opened", () => {
    const { view } = renderList();
    const collapsed = view.container.querySelector("[aria-expanded=\"false\"]");
    expect(collapsed).not.toBeNull();
    expect(collapsed?.textContent ?? "").not.toContain("bash");
    fireEvent.click(collapsed ?? document.createElement("div"));
    const opened = view.container.textContent ?? "";
    expect(opened).toContain("capture-browser-screenshot");
    expect(opened).not.toContain("wrote docs/assets/demo.png");
    const rowHead = view.container.querySelector("[data-testid=\"tool-row-bash\"] .piw-tool-row__head");
    expect(rowHead).not.toBeNull();
    fireEvent.click(rowHead ?? document.createElement("div"));
    expect(view.container.textContent ?? "").toContain("wrote docs/assets/demo.png");
  });

  it("asks for the older page when the reader reaches the top, and stops when there is none", () => {
    const { view, props } = renderList({ hasOlder: true });
    const scroller = view.container.querySelector(".piw-transcript") ?? document.createElement("div");
    scroller.scrollTop = 0;
    fireEvent.scroll(scroller);
    expect(props.onOlder).toHaveBeenCalledTimes(1);

    const { view: quiet, props: quietProps } = renderList({ hasOlder: false });
    const top = quiet.container.querySelector(".piw-transcript") ?? document.createElement("div");
    top.scrollTop = 0;
    fireEvent.scroll(top);
    expect(quietProps.onOlder).not.toHaveBeenCalled();
  });

  it("invites the first message only after the machine answered, not while the transcript opens", () => {
    const { view } = renderList({ connection: "opening", messages: [] });
    expect(view.container.textContent ?? "").not.toContain("No messages yet");

    const { view: answered } = renderList({ connection: "live", messages: [] });
    expect(answered.container.textContent ?? "").toContain("No messages yet");

    const { view: broken } = renderList({ connection: "failed", messages: [] });
    expect(broken.container.textContent ?? "").not.toContain("No messages yet");
  });

  it("keeps a streaming reply marked as live", () => {
    const { view } = renderList({
      streaming: true,
      connection: "live",
      messages: [userLine, { role: "assistant", parts: [{ type: "text", text: "Working on it" }] }],
    });
    expect(view.container.textContent ?? "").toContain("Working on it");
  });
});
