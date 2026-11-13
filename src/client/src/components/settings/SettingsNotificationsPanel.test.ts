// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsNotificationsPanel } from "./SettingsNotificationsPanel";
import { emptyPushPanelState, type PushActionOutcome, type PushDevice, type PushPanelState } from "../../notifications/webPush";

/**
 * The notifications section, in the browser it is used in.
 *
 * The section answers one question in two places: "will I be told, and on which device". A reader
 * compares four rows to find the phone that stopped answering, so what each row says - whose device it
 * is, which push service carries it, when the service last accepted, what it answered when it refused -
 * is the product. The tests mount the panel and click the rendered buttons, and read the rendered text,
 * because a device list that reads well in a TemplateResult can still render nothing.
 */

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

function device(overrides: Partial<PushDevice> = {}): PushDevice {
  return {
    id: "device-1",
    label: "Safari on iPhone",
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
    pushService: "web.push.apple.com",
    tailnetLogin: "reader@example.com",
    tailnetName: "A reader",
    createdAt: "2026-11-01T08:00:00.000Z",
    lastDeliveredAt: "2026-11-02T09:30:00.000Z",
    lastFailure: undefined,
    failures: 0,
    ...overrides,
  };
}

function panelWith(
  push: Partial<PushPanelState>,
  actions: { onPushTestDevice?: (id: string) => Promise<string>; onPushRemoveDevice?: (id: string) => Promise<PushActionOutcome> } = {},
): SettingsNotificationsPanel {
  const panel = new SettingsNotificationsPanel();
  panel.availability = "granted";
  panel.wanted = true;
  panel.push = { ...emptyPushPanelState("granted"), serverConfigured: true, ...push };
  if (actions.onPushTestDevice !== undefined) panel.onPushTestDevice = actions.onPushTestDevice;
  if (actions.onPushRemoveDevice !== undefined) panel.onPushRemoveDevice = actions.onPushRemoveDevice;
  document.body.append(panel);
  return panel;
}

async function rendered(panel: SettingsNotificationsPanel): Promise<ShadowRoot> {
  await panel.updateComplete;
  const shadow = present(panel.shadowRoot, "the panel's shadow root");
  return shadow;
}

/**
 * What iOS reports, set on the harness's navigator and restored.
 *
 * The panel's iPhone advice is the sentence that sends a reader to Add to Home Screen, and it is a
 * function of two navigator facts. Stubbing them at the boundary is the whole cost of testing it.
 */
const IOS_USER_AGENT = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";

function stubIOS(state: { standalone: boolean }): () => void {
  const target: object = globalThis.navigator;
  const keys = ["userAgent", "maxTouchPoints", "standalone"] as const;
  const previous = new Map<string, PropertyDescriptor | undefined>(keys.map((key) => [key, Reflect.getOwnPropertyDescriptor(target, key)]));
  const set = (key: string, value: unknown): void => { Object.defineProperty(target, key, { value, configurable: true }); };
  set("userAgent", IOS_USER_AGENT);
  set("maxTouchPoints", 0);
  set("standalone", state.standalone);
  return () => {
    for (const key of keys) {
      const descriptor = previous.get(key);
      if (descriptor === undefined) Reflect.deleteProperty(target, key);
      else Object.defineProperty(target, key, descriptor);
    }
  };
}

function present<T>(value: T | undefined | null, label: string): NonNullable<T> {
  if (value === undefined || value === null) throw new Error(`${label} is missing`);
  return value;
}

function textOf(root: ShadowRoot): string {
  return root.textContent.replace(/\s+/gu, " ");
}

function buttonsIn(root: ShadowRoot): HTMLButtonElement[] {
  return Array.from(root.querySelectorAll("button"));
}

function button(root: ShadowRoot, label: string): HTMLButtonElement {
  const match = buttonsIn(root).find((entry) => entry.getAttribute("aria-label") === label || entry.textContent.trim() === label);
  if (match === undefined) throw new Error(`No button labelled "${label}" in ${textOf(root)}`);
  return match;
}

describe("the push device list", () => {
  it("names each device, who registered it, and what its push service answered", async () => {
    const panel = panelWith({
      self: device(),
      devices: [
        device(),
        device({ id: "device-2", label: "Chrome on Mac", pushService: "fcm.googleapis.com", tailnetLogin: "friend@example.com", tailnetName: "", lastDeliveredAt: undefined }),
      ],
    });

    const shadow = await rendered(panel);
    const text = textOf(shadow);

    expect(text).toContain("Safari on iPhone");
    expect(text).toContain("(this device)");
    expect(text).toContain("registered by A reader (reader@example.com)");
    expect(text).toContain("carried by web.push.apple.com");
    expect(text).toContain("Chrome on Mac");
    expect(text).toContain("registered by friend@example.com");
    expect(text).toContain("carried by fcm.googleapis.com");
    expect(text).toContain("no message accepted by its push service yet");
  });

  it("says a refusal with the status and the reason the push service gave, and keeps it beside a later acceptance", async () => {
    const panel = panelWith({
      devices: [device({ lastFailure: { at: "2026-11-03T10:00:00.000Z", outcome: "unauthorized", status: 403, reason: "BadJwtToken" } })],
    });

    const text = textOf(await rendered(panel));

    expect(text).toContain("last refused");
    expect(text).toContain("403 BadJwtToken");
    expect(text).toContain("refused this server's push key");
    // The acceptance is not hidden by the refusal, and the refusal is not hidden by the acceptance.
    expect(text).toContain("last accepted");
  });

  it("explains the outcome a device list has for an address the push service retired", async () => {
    const panel = panelWith({
      devices: [device({ lastFailure: { at: "2026-11-03T10:00:00.000Z", outcome: "expired", status: 410, reason: undefined } })],
    });

    expect(textOf(await rendered(panel))).toContain("the address is gone, so the device must register again");
  });

  it("says a device list that did not answer is not a list of no devices", async () => {
    const panel = panelWith({ readFailure: "The daemon did not answer", devices: [device()] });

    const text = textOf(await rendered(panel));

    expect(text).toContain("The device list did not answer (The daemon did not answer)");
    expect(text).toContain("This is not a list of no devices");
    expect(text).not.toContain("Safari on iPhone");
  });

  it("says when the server cannot read its own device file, instead of answering with an empty list", async () => {
    // The route sends no rows alongside `devicesUnknown`: a file it cannot read is a file whose devices
    // are unknown, so the panel says that and never claims "no device is registered".
    const panel = panelWith({ devicesUnknown: "the file is not JSON", devices: [] });

    const text = textOf(await rendered(panel));

    expect(text).toContain("The server cannot read its push file (the file is not JSON)");
    expect(text).toContain("is missing from what follows");
    expect(text).not.toContain("No device is registered for push notifications");
  });

  it("distinguishes an empty list from no server: a server with no key says so, an empty list says empty", async () => {
    const empty = panelWith({ devices: [] });
    expect(textOf(await rendered(empty))).toContain("No device is registered for push notifications on this PI WEB");

    const noKey = panelWith({ serverConfigured: false, serverProblem: "No VAPID key pair is available.", devices: [] });
    await noKey.updateComplete;
    expect(textOf(present(noKey.shadowRoot, "the shadow root"))).toContain("This PI WEB cannot send push: No VAPID key pair is available.");
  });
});

describe("the per-device actions", () => {
  it("tests one device by id, and reports what its push service answered", async () => {
    const onPushTestDevice = vi.fn(() => Promise.resolve("The push service accepted the message for 1 device(s)."));
    const panel = panelWith({ devices: [device(), device({ id: "device-2", label: "Chrome on Mac" })] }, { onPushTestDevice });

    const shadow = await rendered(panel);
    button(shadow, "Send a test push to Chrome on Mac").click();
    await panel.updateComplete;
    await panel.updateComplete;

    expect(onPushTestDevice).toHaveBeenCalledWith("device-2");
    expect(textOf(present(panel.shadowRoot, "the shadow root"))).toContain("The push service accepted the message for 1 device(s).");
  });

  it("removes one device by id, and says what happened", async () => {
    const onPushRemoveDevice = vi.fn((): Promise<PushActionOutcome> => Promise.resolve({ ok: true, reason: "That device is no longer registered. It registers again from its own browser." }));
    const panel = panelWith({ devices: [device()] }, { onPushRemoveDevice });

    const shadow = await rendered(panel);
    button(shadow, "Remove Safari on iPhone from the push devices").click();
    await panel.updateComplete;
    await panel.updateComplete;

    expect(onPushRemoveDevice).toHaveBeenCalledWith("device-1");
    expect(textOf(present(panel.shadowRoot, "the shadow root"))).toContain("That device is no longer registered");
  });

  it("shows the row actions, and refuses to act when the app gave the panel no action to take", async () => {
    // A row whose buttons are inert is a row that says so by being disabled, not a row that hides what
    // a reader is looking for: the same surface, in a state that cannot be used, is the state shown.
    const panel = panelWith({ devices: [device()] });

    const shadow = await rendered(panel);
    const test = button(shadow, "Send a test push to Safari on iPhone");
    const remove = button(shadow, "Remove Safari on iPhone from the push devices");

    expect(test.disabled).toBe(true);
    expect(remove.disabled).toBe(true);
  });

  it("reports a failed action as the failure it was, not as a success", async () => {
    const panel = panelWith({ devices: [device()] });
    panel.onPushRemoveDevice = () => Promise.reject(new Error("the daemon refused"));

    await rendered(panel);
    button(present(panel.shadowRoot, "the shadow root"), "Remove Safari on iPhone from the push devices").click();
    await panel.updateComplete;
    await panel.updateComplete;

    expect(textOf(present(panel.shadowRoot, "the shadow root"))).toContain("The device was not removed: the daemon refused");
  });
});

describe("the two switches", () => {
  it("keeps the notice-while-open switch and the push switch apart, and states what push adds", async () => {
    const panel = panelWith({ self: undefined, devices: [] });

    const text = textOf(await rendered(panel));

    expect(text).toContain("Reach this device when its browser is closed");
    expect(text).toContain("The notice arrives while this browser is open");
    expect(text).toContain("A push service accepting a message is how the server knows a device was woken");
    expect(text).toContain("Push is available. Turning this on registers this device's address with PI WEB.");
  });

  it("tells an iPhone browser in a tab that Safari gives push only to the installed web app, and stops saying it in the installed app", async () => {
    const restore = stubIOS({ standalone: false });
    try {
      const tab = panelWith({ devices: [] });
      expect(textOf(await rendered(tab))).toContain("Safari gives push only to a web app added to the Home Screen");
    } finally {
      restore();
    }

    const installed = stubIOS({ standalone: true });
    try {
      const app = panelWith({ devices: [] });
      expect(textOf(await rendered(app))).not.toContain("Safari gives push only to a web app added to the Home Screen");
    } finally {
      installed();
    }
  });

  it("offers to register this device again only when the server's push key changed, and says why", async () => {
    const stale = panelWith({ self: device(), keyChanged: true, devices: [device()] });
    const staleText = textOf(await rendered(stale));
    expect(staleText).toContain("registered with a push key this server no longer has");
    expect(buttonsIn(present(stale.shadowRoot, "the shadow root")).some((entry) => entry.textContent.trim() === "Register this device again")).toBe(true);

    const current = panelWith({ self: device(), keyChanged: false, devices: [device()] });
    await current.updateComplete;
    expect(buttonsIn(present(current.shadowRoot, "the shadow root")).some((entry) => entry.textContent.trim() === "Register this device again")).toBe(false);
  });
});
