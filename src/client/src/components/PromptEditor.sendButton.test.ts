// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { PromptEditor } from "./PromptEditor";
import type { PendingPrompt } from "../pendingOutbox";

/**
 * The composer's main button, as the reader sees it and presses it.
 *
 * The words on it are the session's state, and what a press does is decided at the press: the app's
 * session state arrives as `canSteer`, and `send` reads it when the message is written. So the test sets
 * the state the app would set, presses the button, and reads the outbox record the press wrote - the
 * thing that actually travels to the machine.
 */
async function composer(options: { canSteer?: boolean; isCompacting?: boolean; text?: string; writes: PendingPrompt[] }): Promise<{ editor: PromptEditor; host: ShadowRoot }> {
  const editor = new PromptEditor();
  editor.sessionId = "session-1";
  editor.machineId = "local";
  editor.cwd = "/repo";
  editor.canSteer = options.canSteer ?? false;
  editor.isCompacting = options.isCompacting ?? false;
  editor.onOutgoingWritten = (record) => { options.writes.push(record); };
  document.body.append(editor);
  await editor.updateComplete;
  await vi.waitFor(() => {
    if (Reflect.get(editor, "editor") === undefined) throw new Error("the composer's editor has not loaded");
  });
  editor.replaceText(options.text ?? "the message");
  const host = editor.shadowRoot;
  if (host === null) throw new Error("the composer rendered no shadow root");
  return { editor, host };
}

function sendButton(host: ShadowRoot): HTMLButtonElement {
  const button = host.querySelector<HTMLButtonElement>("button.send-button");
  if (button === null) throw new Error("the composer rendered no send button");
  return button;
}

async function settle(editor: PromptEditor): Promise<void> {
  await vi.waitFor(() => {
    if (Reflect.get(editor, "preparingSend") === true) throw new Error("the send is still being prepared");
  });
}

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("the composer's send button", () => {
  it("says Append to message queue while the session is working", async () => {
    const { host } = await composer({ canSteer: true, writes: [] });
    const button = sendButton(host);
    expect(button.textContent).toContain("Append to message queue");
    expect(button.getAttribute("aria-label")).toBe("Append to message queue");
    expect(button.getAttribute("title")).toContain("queue");
  });

  it("says Send when the session is idle", async () => {
    const { host } = await composer({ writes: [] });
    expect(sendButton(host).textContent).toContain("Send");
  });

  it("appends to the queue when pressed mid-turn, rather than steering the turn", async () => {
    const writes: PendingPrompt[] = [];
    const { editor, host } = await composer({ canSteer: true, text: "next thing", writes });
    sendButton(host).click();
    await settle(editor);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.behavior).toBe("followUp");
    expect(writes[0]?.text).toBe("next thing");
  });

  it("sends when pressed on an idle session", async () => {
    const writes: PendingPrompt[] = [];
    const { editor, host } = await composer({ canSteer: false, text: "the thing", writes });
    sendButton(host).click();
    await settle(editor);
    expect(writes).toHaveLength(1);
    // An idle session has no turn to join, so the record names no behavior: pi takes it as the next prompt.
    expect(writes[0]?.behavior).toBeUndefined();
  });

  it("decides from the session at the moment of the press, not from the label it was drawn with", async () => {
    // The task finished between the render and the click. The press reads the state, so the message goes
    // now instead of queueing behind work that has already ended.
    const writes: PendingPrompt[] = [];
    const { editor, host } = await composer({ canSteer: true, text: "late one", writes });
    editor.canSteer = false;
    await editor.updateComplete;
    expect(sendButton(host).textContent).toContain("Send");
    sendButton(host).click();
    await settle(editor);
    expect(writes[0]?.behavior).toBeUndefined();
  });

  it("queues while the history is being compacted", async () => {
    const writes: PendingPrompt[] = [];
    const { editor, host } = await composer({ isCompacting: true, text: "queued during compaction", writes });
    expect(sendButton(host).textContent).toContain("Queue");
    sendButton(host).click();
    await settle(editor);
    expect(writes[0]?.behavior).toBe("followUp");
  });

  it("keeps the words available when the phone's row shows only the icon", async () => {
    // The narrow row hides the label; the accessible name and the tooltip carry the same words.
    const css = String(PromptEditor.styles);
    expect(css).toContain(".send-label { display: none; }");
    const { host } = await composer({ canSteer: true, writes: [] });
    const button = sendButton(host);
    expect(button.getAttribute("aria-label")).toBe("Append to message queue");
    expect(button.getAttribute("title")).toContain("current turn ends");
    expect(button.querySelector(".send-label")?.textContent).toBe("Append to message queue");
  });

  it("is disabled while a send is being prepared, in either state", async () => {
    for (const canSteer of [true, false]) {
      const { editor, host } = await composer({ canSteer, writes: [] });
      Reflect.set(editor, "preparingSend", true);
      await editor.updateComplete;
      expect(sendButton(host).disabled).toBe(true);
    }
  });
});
