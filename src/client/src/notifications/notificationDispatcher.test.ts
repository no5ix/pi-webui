// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { notifyBrowserChannel, type SessionEventNotice } from "./notificationDispatcher";
import { setTaskNotificationsWanted } from "./taskNotifications";

interface Posted {
  readonly title: string;
  readonly options: { body?: string; tag?: string; data?: { url?: string } };
}

/** The notification centre, as the browser answers it: it takes the notice, refuses it, or has no service worker at all. */
function browserCenter(options: { registration: boolean; throws?: boolean; visible?: boolean }) {
  const posted: Posted[] = [];
  const registration = options.registration
    ? {
      showNotification: (title: string, init?: { body?: string; tag?: string; data?: { url?: string } }): Promise<void> => {
        if (options.throws === true) return Promise.reject(new Error("the browser refused the notice"));
        posted.push({ title, options: init ?? {} });
        return Promise.resolve();
      },
    }
    : undefined;
  const notification = { permission: "granted", requestPermission: (): Promise<NotificationPermission> => Promise.resolve("granted" as const) };
  const serviceWorker = {
    getRegistration: () => Promise.resolve(registration),
    register: () => Promise.resolve(registration),
  };
  Object.defineProperty(globalThis, "Notification", { configurable: true, value: notification });
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: serviceWorker });
  if (options.visible !== undefined) Object.defineProperty(document, "visibilityState", { configurable: true, value: options.visible ? "visible" : "hidden" });
  return posted;
}

function notice(over: Partial<SessionEventNotice> = {}): SessionEventNotice {
  return { event: "completed", sessionId: "session-1", sessionName: "work", ...over };
}

afterEach(() => {
  setTaskNotificationsWanted(false);
  document.body.replaceChildren();
  localStorage.clear();
});

describe("the browser's notification channel", () => {
  it("says nothing on a device the reader never turned on", async () => {
    setTaskNotificationsWanted(false);
    const posted = browserCenter({ registration: true });
    const inPage: unknown[] = [];
    const delivery = await notifyBrowserChannel(notice(), { onInPageNotice: (n) => { inPage.push(n); } });
    expect(delivery).toBe("skipped");
    expect(posted).toHaveLength(0);
    expect(inPage).toHaveLength(0);
  });

  it("posts the notice to the device and reports that it did", async () => {
    setTaskNotificationsWanted(true);
    const posted = browserCenter({ registration: true, visible: true });
    const delivery = await notifyBrowserChannel(notice({ durationMs: 125_000 }), { url: () => "https://pi.example/?session=session-1" });
    expect(delivery).toBe("system");
    expect(posted).toHaveLength(1);
    expect(posted[0]?.title).toBe("PI WEB · work");
    expect(posted[0]?.options.body).toContain("Task finished (2m 5s)");
    expect(posted[0]?.options.data?.url).toBe("https://pi.example/?session=session-1");
  });

  it("keeps one session's notices together so finished tasks do not stack on a lock screen", async () => {
    setTaskNotificationsWanted(true);
    const posted = browserCenter({ registration: true, visible: true });
    await notifyBrowserChannel(notice({ sessionId: "session-1" }));
    await notifyBrowserChannel(notice({ sessionId: "session-1" }));
    expect(posted[0]?.options.tag).toBe(posted[1]?.options.tag);
    expect(browserCenter({ registration: true }).length).toBe(0);
  });

  it("gives a session on another machine its own notice", async () => {
    // Session ids are per daemon. Two fleet machines can run sessions that share an id, and a notice
    // that replaces the other machine's tells the reader about a task they are not watching (2026-11-13).
    setTaskNotificationsWanted(true);
    const posted = browserCenter({ registration: true, visible: true });
    await notifyBrowserChannel(notice({ sessionId: "session-1", machineId: "mac-one" }));
    await notifyBrowserChannel(notice({ sessionId: "session-1", machineId: "mac-two" }));
    expect(posted[0]?.options.tag).not.toBe(posted[1]?.options.tag);
  });

  it("puts the same words on the page when the notification centre took nothing and the reader is looking", async () => {
    // Safari does not reliably show a web notification to the focused page, so a foreground notice that
    // reports success would be a claim about a centre the page never reached.
    setTaskNotificationsWanted(true);
    browserCenter({ registration: false, visible: true });
    const inPage: { title: string; body: string }[] = [];
    const delivery = await notifyBrowserChannel(notice({ event: "ask-user", question: "Approve the tests?" }), { onInPageNotice: (n) => { inPage.push(n); } });
    expect(delivery).toBe("in-page");
    expect(inPage).toHaveLength(1);
    expect(inPage[0]?.body).toContain("Your answer is needed: Approve the tests?");
  });

  it("does not claim a notice it cannot show to a reader who is not looking", async () => {
    setTaskNotificationsWanted(true);
    browserCenter({ registration: false, visible: false });
    const inPage: unknown[] = [];
    const delivery = await notifyBrowserChannel(notice(), { onInPageNotice: (n) => { inPage.push(n); } });
    expect(delivery).toBe("failed");
    expect(inPage).toHaveLength(0);
  });

  it("falls back to the page when the centre throws", async () => {
    setTaskNotificationsWanted(true);
    browserCenter({ registration: true, throws: true, visible: true });
    const inPage: unknown[] = [];
    const delivery = await notifyBrowserChannel(notice(), { onInPageNotice: (n) => { inPage.push(n); } });
    expect(delivery).toBe("in-page");
    expect(inPage).toHaveLength(1);
  });
});
