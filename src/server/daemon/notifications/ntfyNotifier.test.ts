import { describe, expect, it } from "vitest";
import { createNtfyNotifier, type NtfyNoticeRequest } from "./ntfyNotifier";
import type { NtfyConfig } from "../../../shared/apiTypes.js";

const READY: NtfyConfig = { enabled: true, serverUrl: "https://ntfy.sh", topic: "reader-secret-topic", onCompleted: true, onFailed: true, onAskUser: true };

function request(over: Partial<NtfyNoticeRequest> = {}): NtfyNoticeRequest {
  return { event: "completed", title: "PI WEB · work", message: "Task finished.", dedupeKey: "completed\u0000s1\u0000t0", ...over };
}

/** A notifier wired to a fetch that records what it was asked to publish. */
function notifier(config: NtfyConfig | undefined, options: { status?: number; now?: () => number } = {}) {
  const posts: { url: string; body: BodyInit | null }[] = [];
  const logs: Record<string, unknown>[] = [];
  const fetchImpl: typeof fetch = (input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
    posts.push({ url: typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url, body: init?.body ?? null });
    return Promise.resolve(new Response("", { status: options.status ?? 200 }));
  };
  const instance = createNtfyNotifier({
    readConfig: () => config,
    fetchImpl,
    log: (fields) => { logs.push(fields); },
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  // The notice is fire-and-forget; one turn of the queue settles the fetch and its status write.
  const settled = async () => { await new Promise<void>((resolve) => { setTimeout(resolve, 0); }); };
  return { instance, posts, logs, settled };
}

describe("the ntfy notifier", () => {
  it("publishes a finished task to the reader's channel", async () => {
    const { instance, posts, settled } = notifier(READY);
    instance.notify(request());
    await settled();
    expect(posts).toHaveLength(1);
    expect(posts[0]?.url).toBe("https://ntfy.sh/reader-secret-topic");
    expect(posts[0]?.body).toBe("Task finished.");
    expect(instance.status().lastOutcome).toBe("delivered");
  });

  it("sends nothing when ntfy is not configured, and says so in the status a panel reads", async () => {
    const { instance, posts, settled } = notifier(undefined);
    instance.notify(request());
    await settled();
    expect(posts).toHaveLength(0);
    expect(instance.status().lastOutcome).toBe("skipped");
    expect(instance.status().configured).toBe(false);
  });

  it("sends nothing while the master switch is off", async () => {
    const { instance, posts, settled } = notifier({ ...READY, enabled: false });
    instance.notify(request());
    await settled();
    expect(posts).toHaveLength(0);
    expect(instance.status().readyReason).toBe("ntfy is switched off.");
  });

  it("sends nothing for an event the reader switched off, and says which switch", async () => {
    const { instance, posts, settled } = notifier({ ...READY, onFailed: false });
    instance.notify(request({ event: "failed", dedupeKey: "failed\u0000s1\u0000t0" }));
    await settled();
    expect(posts).toHaveLength(0);
    expect(instance.status().ready).toBe(true);
    expect(instance.status().readyReason).toContain("failed");
  });

  it("sends a question the reader asked for", async () => {
    const { instance, posts, settled } = notifier(READY);
    instance.notify(request({ event: "ask-user", dedupeKey: "ask-user\u0000s1\u0000d1" }));
    await settled();
    expect(posts).toHaveLength(1);
  });

  it("tells the phone once about a run that settles twice", async () => {
    const { instance, posts, settled } = notifier(READY);
    instance.notify(request());
    await settled();
    instance.notify(request());
    await settled();
    expect(posts).toHaveLength(1);
    expect(instance.status().lastOutcome).toBe("skipped");
  });

  it("tells the phone about the next task, whose span is a different key", async () => {
    const { instance, posts, settled } = notifier(READY);
    instance.notify(request());
    await settled();
    instance.notify(request({ dedupeKey: "completed\u0000s1\u0000t1" }));
    await settled();
    expect(posts).toHaveLength(2);
  });

  it("tells the phone about the same span again once the window has passed", async () => {
    let nowValue = 0;
    const { instance, posts, settled } = notifier(READY, { now: () => nowValue });
    instance.notify(request());
    await settled();
    nowValue = 10 * 60 * 1000;
    instance.notify(request());
    await settled();
    expect(posts).toHaveLength(2);
  });

  it("reports a server that refuses, without naming the topic", async () => {
    const { instance, posts, logs, settled } = notifier(READY, { status: 509 });
    instance.notify(request());
    await vi_advance();
    await settled();
    expect(posts.length).toBeGreaterThan(1);
    expect(instance.status().lastOutcome).toBe("failed");
    expect(JSON.stringify(instance.status())).not.toContain("reader-secret-topic");
    expect(JSON.stringify(logs)).not.toContain("reader-secret-topic");
  });

  it("never lets a notice throw at the session that produced it", () => {
    const fetchImpl: typeof fetch = (): Promise<Response> => Promise.reject(new Error("no network"));
    const instance = createNtfyNotifier({ readConfig: () => READY, fetchImpl, log: () => { /* the failure is the point */ } });
    expect(() => { instance.notify(request()); }).not.toThrow();
  });

  it("reads the config for every notice, so a Settings change needs no restart", async () => {
    let config: NtfyConfig | undefined = { ...READY, enabled: false };
    const posts: string[] = [];
    const fetchImpl: typeof fetch = (input: URL | RequestInfo): Promise<Response> => {
      posts.push(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      return Promise.resolve(new Response("", { status: 200 }));
    };
    const instance = createNtfyNotifier({ readConfig: () => config, fetchImpl });
    instance.notify(request());
    await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    expect(posts).toHaveLength(0);
    config = READY;
    instance.notify(request({ dedupeKey: "completed\u0000s1\u0000t1" }));
    await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    expect(posts).toHaveLength(1);
  });

  it("keeps at most four publishes in flight, and the rest follow", async () => {
    // Forty sessions can finish together - a daemon restart, a model coming back. Unthrottled that is
    // forty connections to one ntfy server, and the server that answers slowly is the one that drops
    // everything. The bound is the notice path's, not any task's: nothing here is on a session's path.
    const open: (() => void)[] = [];
    let inFlight = 0;
    let peak = 0;
    const fetchImpl: typeof fetch = () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      return new Promise<Response>((resolve) => {
        open.push(() => { inFlight -= 1; resolve(new Response("", { status: 200 })); });
      });
    };
    const instance = createNtfyNotifier({ readConfig: () => READY, fetchImpl });
    for (let index = 0; index < 12; index += 1) instance.notify(request({ dedupeKey: `completed\u0000s1\u0000t${String(index)}` }));
    await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    expect(peak).toBe(4);
    for (const release of open.splice(0, open.length)) release();
    await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    expect(peak).toBeLessThanOrEqual(4);
    expect(instance.status().lastOutcome).toBeDefined();
  });

  it("does not ask a second time when the server refused the request itself", async () => {
    // A 404 is an answer about these bytes: no topic by that name. The same POST is refused again, and
    // a second one only spends the reader's task on it.
    const posts: string[] = [];
    const fetchImpl: typeof fetch = (input: URL | RequestInfo): Promise<Response> => {
      posts.push(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      return Promise.resolve(new Response("topic not found", { status: 404 }));
    };
    const instance = createNtfyNotifier({ readConfig: () => READY, fetchImpl });
    instance.notify(request());
    await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    expect(posts).toHaveLength(1);
    expect(instance.status().lastOutcome).toBe("failed");
  });
});

/** The retry backoff runs on a real timer; let it pass without stalling the suite. */
async function vi_advance(): Promise<void> {
  await new Promise<void>((resolve) => { setTimeout(resolve, 1_100); });
}
