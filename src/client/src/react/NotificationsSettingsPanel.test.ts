// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NtfyConfig, NtfyStatus } from "../../../shared/ntfy";
import { TOPIC_STORED_PLACEHOLDER } from "../notifications/ntfyForm";

const saveNtfy = vi.fn<(ntfy: NtfyConfig, write?: { readonly clearTopic?: boolean }) => Promise<unknown>>();
const ntfyStatus = vi.fn<() => Promise<NtfyStatus>>();
const sendNtfyTest = vi.fn<(draft?: NtfyConfig) => Promise<{ delivered: boolean; attempts: number; reason?: string }>>();
const notifyTaskFinished = vi.fn<(notice: { title: string; body: string; url: string }, tag: string) => Promise<boolean>>();
const requestTaskNotificationPermission = vi.fn<() => Promise<"granted" | "denied">>();

vi.mock("../api", () => ({
  configApi: { saveNtfy: (ntfy: NtfyConfig, write: { readonly clearTopic?: boolean }) => saveNtfy(ntfy, write) },
  notificationsApi: {
    ntfyStatus: () => ntfyStatus(),
    sendNtfyTest: (draft?: NtfyConfig) => sendNtfyTest(draft),
  },
}));

vi.mock("../notifications/taskNotifications", () => ({
  notificationAvailability: () => "prompt",
  taskNotificationsWanted: () => false,
  setTaskNotificationsWanted: vi.fn(),
  requestTaskNotificationPermission: () => requestTaskNotificationPermission(),
  notifyTaskFinished: (notice: { title: string; body: string; url: string }, tag: string) => notifyTaskFinished(notice, tag),
}));

vi.mock("../browserProfile", () => ({ isIOS: () => false, isInstalledApp: () => false }));

import { NotificationsSettingsPanel } from "./NotificationsSettingsPanel";

const run = async <T,>(action: () => Promise<T>): Promise<T | undefined> => await action();

function status(fields: Partial<NtfyStatus> = {}): NtfyStatus {
  return {
    enabled: true,
    ready: true,
    topicConfigured: true,
    config: { enabled: true, serverUrl: "https://ntfy.example.com", clickUrlBase: "https://pi.example.ts.net:8505", onCompleted: true, onFailed: false, onAskUser: true },
    ...fields,
  };
}

let container: HTMLDivElement;
let root: Root;

function field(label: string): HTMLInputElement {
  const owner = [...container.querySelectorAll("label")].find((element) => element.textContent.startsWith(label));
  const input = owner?.querySelector("input");
  if (input === null || input === undefined) throw new Error(`The "${label}" field did not render.`);
  return input;
}

function button(text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find((element) => element.textContent.trim() === text);
  if (found === undefined) throw new Error(`The "${text}" button did not render.`);
  return found;
}

function check(label: string): HTMLInputElement {
  const owner = [...container.querySelectorAll("label")].find((element) => element.textContent.includes(label));
  const input = owner?.querySelector("input");
  if (input === null || input === undefined) throw new Error(`The "${label}" switch did not render.`);
  return input;
}

function buttonLabels(): string[] {
  return [...container.querySelectorAll("button")].map((element) => element.textContent.trim());
}

function text(): string {
  return container.textContent;
}

async function type(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve();
  });
}

async function click(element: HTMLButtonElement): Promise<void> {
  await act(async () => {
    element.click();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function open(statusValue: NtfyStatus = status()): Promise<void> {
  ntfyStatus.mockResolvedValue(statusValue);
  await act(async () => {
    root.render(createElement(NotificationsSettingsPanel, { busy: false, run }));
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  saveNtfy.mockReset().mockResolvedValue({});
  ntfyStatus.mockReset();
  sendNtfyTest.mockReset().mockResolvedValue({ delivered: true, attempts: 1 });
  notifyTaskFinished.mockReset().mockResolvedValue(true);
  requestTaskNotificationPermission.mockReset().mockResolvedValue("denied");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.unstubAllGlobals();
});

describe("the notifications panel", () => {
  it("prefills the ntfy fields from the stored block and never shows the topic", async () => {
    await open();

    expect(field("Server").value).toBe("https://ntfy.example.com");
    expect(field("Server address for taps").value).toBe("https://pi.example.ts.net:8505");
    expect(field("Topic").value).toBe("");
    expect(field("Topic").placeholder).toBe("•••••• stored");
    expect(text()).toContain("A topic is stored on the server. It is never shown here.");
    expect(check("Notify when a task fails").checked).toBe(false);
  });

  it("starts from the defaults, with the topic box asking for one, when nothing is configured", async () => {
    await open({ enabled: false, ready: false, reason: "ntfy is not configured.", topicConfigured: false });
    expect(field("Server").value).toBe("");
    expect(field("Topic").placeholder).toBe("your-topic");
    expect(text()).toContain("ntfy is not configured.");
    expect(buttonLabels()).not.toContain("Stop using this topic");
  });

  it("saves what the boxes say, and a blank topic box writes no topic so the stored one stays", async () => {
    await open();
    await type(field("Server"), "https://ntfy.myhome.net");
    await type(field("Server address for taps"), "https://pi.lan:8505");
    await click(button("Save ntfy settings"));

    expect(saveNtfy).toHaveBeenCalledWith({
      enabled: true,
      serverUrl: "https://ntfy.myhome.net",
      clickUrlBase: "https://pi.lan:8505",
      onCompleted: true,
      onFailed: false,
      onAskUser: true,
    }, {});
    expect(text()).toContain("Saved. The next event uses these settings.");
  });

  it("a blank server box means the public server, so turning the channel on cannot write an address nobody chose", async () => {
    await open({ enabled: true, ready: false, reason: "ntfy is not configured.", topicConfigured: false });
    await click(button("Save ntfy settings"));

    expect(saveNtfy.mock.calls[0]?.[0]).toMatchObject({ serverUrl: "https://ntfy.sh" });
    expect(saveNtfy.mock.calls[0]?.[0]).not.toHaveProperty("topic");
  });

  it("forgetting the topic is its own act, and it says what stops", async () => {
    await open();
    await click(button("Stop using this topic"));

    expect(saveNtfy).toHaveBeenLastCalledWith(expect.objectContaining({ serverUrl: "https://ntfy.example.com" }), { clearTopic: true });
    expect(text()).toContain("Saved. The topic is gone: notices stop until you type a new one.");
  });

  it("a new topic in the box is written, and the box goes back to reporting a stored one", async () => {
    await open();
    await type(field("Topic"), "secret-topic");
    await click(button("Save ntfy settings"));

    expect(saveNtfy.mock.calls[0]?.[0]).toMatchObject({ topic: "secret-topic" });
    expect(field("Topic").value).toBe("");
    expect(field("Topic").placeholder).toBe("•••••• stored");
  });

  it("the test is sent with the fields on the screen and says they are not saved yet", async () => {
    await open();
    await type(field("Topic"), "draft-topic");
    await click(button("Send a test notice through ntfy"));

    expect(sendNtfyTest).toHaveBeenCalledWith(expect.objectContaining({ topic: "draft-topic" }));
    expect(text()).toContain("ntfy accepted the test notice. The draft settings are not saved yet.");
  });

  it("a test the server refused is reported with the server's reason", async () => {
    sendNtfyTest.mockResolvedValue({ delivered: false, attempts: 2, reason: "the ntfy server answered 404" });
    await open();
    await click(button("Send a test notice through ntfy"));

    expect(text()).toContain("ntfy did not accept the test notice: the ntfy server answered 404");
  });

  it("a save the server refused keeps the draft and reports the reason", async () => {
    saveNtfy.mockRejectedValue(new Error("The ntfy topic uses characters ntfy does not allow."));
    await open();
    await type(field("Topic"), "not a topic");
    await click(button("Save ntfy settings"));

    expect(text()).toContain("The ntfy topic uses characters ntfy does not allow.");
    expect(field("Topic").value).toBe("not a topic");
  });

  it("a request that never reached the server is reported as the connection, not as a secret address", async () => {
    saveNtfy.mockRejectedValue(new TypeError("Failed to fetch"));
    await open();
    await click(button("Save ntfy settings"));

    expect(text()).toContain("The browser could not reach PI WEB to complete this request.");
  });

  it("the browser channel's test notice waits for the permission the browser gave", async () => {
    await open();

    expect(button("Send a test notice in this browser").disabled).toBe(true);
    expect(text()).toContain("This browser has not been asked yet.");

    requestTaskNotificationPermission.mockResolvedValue("granted");
    await click(button("Ask the browser for permission"));
    expect(text()).toContain("This browser allows notifications.");
  });

  it("a browser-channel notice that the page posted is reported as posted", async () => {
    requestTaskNotificationPermission.mockResolvedValue("granted");
    await open();
    await click(button("Ask the browser for permission"));
    expect(button("Send a test notice in this browser").disabled).toBe(false);
    await click(button("Send a test notice in this browser"));

    expect(notifyTaskFinished).toHaveBeenCalledWith(expect.objectContaining({ title: "PI WEB" }), "task-test");
    expect(text()).toContain("A notice went to the notification centre.");
  });

  it("refuses to edit ntfy while the settings stored on the server are unknown", async () => {
    await openWithoutStatus();

    expect(buttonLabels()).not.toContain("Save ntfy settings");
    expect(buttonLabels()).toContain("Try again");
    expect(text()).toContain("this browser cannot reach PI WEB");
    expect(text()).toContain("The settings are not shown, and nothing is written");
  });

  it("a retry that reads the settings renders the form, and its topic box stays blank", async () => {
    await openWithoutStatus();
    ntfyStatus.mockResolvedValue(status());

    await click(button("Try again"));

    expect(ntfyStatus).toHaveBeenCalledTimes(2);
    expect(buttonLabels()).toContain("Save ntfy settings");
    expect(field("Topic").value).toBe("");
    expect(field("Topic").placeholder).toBe(TOPIC_STORED_PLACEHOLDER);
  });

  async function openWithoutStatus(): Promise<void> {
    ntfyStatus.mockRejectedValueOnce(new Error("this browser cannot reach PI WEB"));
    await act(async () => {
      root.render(createElement(NotificationsSettingsPanel, { busy: false, run }));
      await Promise.resolve();
    });
  }
});
