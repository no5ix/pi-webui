import { describe, expect, it, vi } from "vitest";
import type { NtfyConfig } from "./apiTypes.js";
import { mergeNtfyConfig } from "./pluginConfigPrivacy.js";
import {
  ntfyClickUrl,
  ntfyEndpointUrl,
  ntfyNoticeHeaders,
  ntfyReadiness,
  ntfyTopicConfigured,
  ntfyWantsEvent,
  NTFY_EVENT_FIELDS,
  NTFY_REDACTED_TOPIC,
  NtfyConfigError,
  parseNtfyConfig,
  publicNtfyConfig,
  redactNtfySecret,
  sendNtfyNotice,
  validateNtfyServerUrl,
  validateNtfyTopic,
  type NtfyNotice,
} from "./ntfy.js";

/** A notice the transport tests post. */
function notice(over: Partial<NtfyNotice> = {}): NtfyNotice {
  return { event: "completed", title: "PI WEB · work", message: "Task finished.", dedupeKey: "k", ...over };
}

/** Reading a header back the way ntfy reads it: an encoded word, decoded. */
function decodeRfc2047Title(header: string): string {
  const encoded = /^=\?UTF-8\?B\?(.*)\?=$/u.exec(header);
  if (encoded === null) return header;
  return Buffer.from(encoded[1] ?? "", "base64").toString("utf8");
}

/** A fetch that answers with these responses, in order, and records what it was asked to send. */
function postedFetch(...responses: (Response | Error)[]): { fetchImpl: typeof fetch; calls: { url: string; body: BodyInit | null }[] } {
  const calls: { url: string; body: BodyInit | null }[] = [];
  const fetchImpl: typeof fetch = (input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
    calls.push({ url: urlOf(input), body: init?.body ?? null });
    const next = responses.shift();
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(next ?? new Response("", { status: 200 }));
  };
  return { fetchImpl, calls };
}

/** The address a fetch was pointed at, in the shape the assertions read. */
function urlOf(input: URL | RequestInfo): string {
  return typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
}

describe("ntfy config parsing", () => {
  it("reads a complete block", () => {
    const config = parseNtfyConfig({ enabled: true, serverUrl: "https://ntfy.example.com", topic: "reader-phone", onCompleted: true, onFailed: false, onAskUser: true, clickUrlBase: "https://pi.example.ts.net", timeoutMs: 8000 }, "config");
    expect(config).toEqual({ enabled: true, serverUrl: "https://ntfy.example.com", topic: "reader-phone", onCompleted: true, onFailed: false, onAskUser: true, clickUrlBase: "https://pi.example.ts.net", timeoutMs: 8000 });
  });

  it("accepts an empty block, which is a provider that is off", () => {
    expect(parseNtfyConfig({}, "config")).toEqual({});
  });

  it("refuses a server address that carries credentials", () => {
    expect(() => parseNtfyConfig({ serverUrl: "https://user:secret@ntfy.sh" }, "config")).toThrow(NtfyConfigError);
  });

  it("treats an empty topic as no topic, which keeps the stored one", () => {
    // The panel leaves the box empty to mean "keep what is stored", so an empty write is not a value.
    expect(parseNtfyConfig({ topic: "" }, "config")).toEqual({});
  });

  it("refuses a timeout outside the bounds", () => {
    expect(() => parseNtfyConfig({ timeoutMs: 1 }, "config")).toThrow(NtfyConfigError);
  });

  it("names the file in the complaint", () => {
    expect(() => parseNtfyConfig("nope", "/etc/config.json")).toThrow(/\/etc\/config\.json/u);
  });
});

describe("ntfy readiness", () => {
  it("is not ready without a config, and says why", () => {
    const readiness = ntfyReadiness(undefined);
    expect(readiness.ready).toBe(false);
    expect(typeof readiness.reason).toBe("string");
  });

  it("is not ready while the master switch is off, even with a topic", () => {
    expect(ntfyReadiness({ enabled: false, serverUrl: "https://ntfy.sh", topic: "phone" }).ready).toBe(false);
  });

  it("is not ready with a server and no topic", () => {
    expect(ntfyReadiness({ enabled: true, serverUrl: "https://ntfy.sh" }).ready).toBe(false);
  });

  it("is ready with a server and a topic", () => {
    expect(ntfyReadiness({ enabled: true, serverUrl: "https://ntfy.sh", topic: "phone" })).toEqual({ ready: true });
  });

  it("refuses a topic that is not a single path segment", () => {
    expect(() => parseNtfyConfig({ topic: "a/b" }, "config")).toThrow(NtfyConfigError);
  });

  it("is not ready with a topic and no server", () => {
    expect(ntfyReadiness({ enabled: true, topic: "phone" }).ready).toBe(false);
  });
});

describe("ntfy event switches", () => {
  it("sends nothing while the master switch is off", () => {
    const config = { enabled: false, topic: "phone", onCompleted: true, onFailed: true, onAskUser: true };
    expect(ntfyWantsEvent(config, "completed")).toBe(false);
    expect(ntfyWantsEvent(config, "failed")).toBe(false);
    expect(ntfyWantsEvent(config, "ask-user")).toBe(false);
  });

  it("asks only for the events the reader switched on", () => {
    const config = { enabled: true, topic: "phone", onCompleted: true, onFailed: false };
    expect(ntfyWantsEvent(config, "completed")).toBe(true);
    expect(ntfyWantsEvent(config, "failed")).toBe(false);
    // A switch the reader never touched is off, not on: a provider that starts sending unasked notices is worse than one that is quiet.
    expect(ntfyWantsEvent(config, "ask-user")).toBe(false);
  });

  it("has a switch for every event the panel offers", () => {
    const switches: readonly string[] = NTFY_EVENT_FIELDS.map((field) => field.key);
    expect(switches).toEqual(["onCompleted", "onFailed", "onAskUser"]);
  });
});

describe("ntfy topic privacy", () => {
  it("keeps the topic out of the config a browser reads", () => {
    const publicConfig = publicNtfyConfig({ enabled: true, serverUrl: "https://ntfy.sh", topic: "reader-secret-topic", onCompleted: true });
    const json = JSON.stringify(publicConfig);
    expect(json).not.toContain("reader-secret-topic");
    // No key at all, not a marker: a marker is a legal topic, and a settings screen that saves the
    // config it was given would store it (2026-11-13).
    expect("topic" in publicConfig).toBe(false);
    expect(publicConfig.onCompleted).toBe(true);
  });

  it("refuses a saved config that echoes the old redaction marker back as a topic", () => {
    // A settings save round-trips the config the browser was shown. If a redacted answer's marker were
    // accepted, every later notice would go to a public topic anyone can subscribe to.
    const stored: NtfyConfig = { enabled: true, serverUrl: "https://ntfy.sh", topic: "reader-secret-topic" };
    const echoed = { ...stored, topic: NTFY_REDACTED_TOPIC };
    expect(mergeNtfyConfig(stored, echoed)?.topic).toBe("reader-secret-topic");
  });

  it("keeps the stored topic when a save names none, and drops it only when the write says to", () => {
    const stored: NtfyConfig = { enabled: true, serverUrl: "https://ntfy.sh", topic: "reader-secret-topic", onFailed: true };
    expect(mergeNtfyConfig(stored, { enabled: true, onFailed: true })?.topic).toBe("reader-secret-topic");
    expect(mergeNtfyConfig(stored, { enabled: true }, { clearTopic: true })?.topic).toBeUndefined();
    expect(mergeNtfyConfig(stored, { topic: "a-new-topic" })?.topic).toBe("a-new-topic");
  });

  it("says a topic is stored without saying what it is", () => {
    expect(ntfyTopicConfigured({ topic: "reader-secret-topic" })).toBe(true);
    expect(ntfyTopicConfigured({})).toBe(false);
    expect(ntfyTopicConfigured(undefined)).toBe(false);
  });

  it("cuts the topic out of a failure's words", () => {
    expect(redactNtfySecret("POST to https://ntfy.sh/reader-secret-topic failed", ["reader-secret-topic"])).not.toContain("reader-secret-topic");
  });
});

describe("ntfy address", () => {
  it("posts to the server's publish path for the topic", () => {
    expect(ntfyEndpointUrl("https://ntfy.sh", "phone")).toBe("https://ntfy.sh/phone");
    expect(ntfyEndpointUrl("https://ntfy.example.com/", "phone")).toBe("https://ntfy.example.com/phone");
    expect(ntfyEndpointUrl("https://ntfy.example.com/ntfy", "phone")).toBe("https://ntfy.example.com/ntfy/phone");
  });

  it("refuses a server address that is not http(s) with no credentials", () => {
    expect(validateNtfyServerUrl("ftp://ntfy.sh")).toBeUndefined();
    expect(validateNtfyServerUrl("https://user@ntfy.sh")).toBeUndefined();
    expect(validateNtfyServerUrl("https://ntfy.sh/?secret=1")).toBeUndefined();
    expect(validateNtfyServerUrl("https://ntfy.sh/")).toBe("https://ntfy.sh");
  });

  it("refuses a topic that is not one path segment", () => {
    expect(validateNtfyTopic("ok.topic_1-2")).toBe("ok.topic_1-2");
    expect(validateNtfyTopic("a/b")).toBeUndefined();
    expect(validateNtfyTopic("a?b")).toBeUndefined();
  });

  it("points a tap at the session the notice is about", () => {
    // A tap target is a page, so it carries a query - the publish-address validator refuses queries, and
    // routing the click through it would silently drop every tap target the product promises.
    expect(ntfyClickUrl("https://pi.example.ts.net", "?session=abc")).toBe("https://pi.example.ts.net/?session=abc");
    expect(ntfyClickUrl("https://pi.example.ts.net/piweb/", "?session=abc")).toBe("https://pi.example.ts.net/piweb?session=abc");
    expect(ntfyClickUrl("https://pi.example.ts.net/", undefined)).toBe("https://pi.example.ts.net");
    expect(ntfyClickUrl(undefined, "?session=abc")).toBeUndefined();
    expect(ntfyClickUrl("not a url", "?session=abc")).toBeUndefined();
    expect(ntfyClickUrl("https://user@pi.example.ts.net", "?session=abc")).toBeUndefined();
  });

  it("carries the title, the tag, and the click through ntfy's headers", () => {
    const headers = ntfyNoticeHeaders(notice({ title: "PI WEB - work", tags: ["white_check_mark"] }), "https://pi.example.ts.net/?session=abc");
    expect(decodeRfc2047Title(headers["title"] ?? "")).toBe("PI WEB - work");
    expect(headers["tags"]).toBe("white_check_mark");
    expect(headers["click"]).toBe("https://pi.example.ts.net/?session=abc");
  });

  it("carries a title in any language, encoded so a header survives it", () => {
    expect(decodeRfc2047Title(ntfyNoticeHeaders(notice({ title: "PI WEB · work" }), undefined)["title"] ?? "")).toBe("PI WEB · work");
    expect(decodeRfc2047Title(ntfyNoticeHeaders(notice({ title: "会话 完成了" }), undefined)["title"] ?? "")).toBe("会话 完成了");
  });

  it("keeps a long title inside what ntfy accepts", () => {
    const headers = ntfyNoticeHeaders(notice({ title: "x".repeat(400) }), undefined);
    expect(decodeRfc2047Title(headers["title"] ?? "").length).toBeLessThanOrEqual(120);
  });
});

describe("ntfy delivery", () => {
  it("posts the message once and reports the delivery", async () => {
    const { fetchImpl, calls } = postedFetch(new Response("", { status: 200 }));
    const delivery = await sendNtfyNotice(notice({ message: "Task finished (2m 5s)." }), { enabled: true, serverUrl: "https://ntfy.sh", topic: "phone" }, { fetchImpl });
    expect(delivery).toEqual({ delivered: true, attempts: 1 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://ntfy.sh/phone");
    expect(calls[0]?.body).toBe("Task finished (2m 5s).");
  });

  it("sends nothing when there is no topic, and says why", async () => {
    const { fetchImpl, calls } = postedFetch();
    const delivery = await sendNtfyNotice(notice(), { enabled: true, serverUrl: "https://ntfy.sh" }, { fetchImpl });
    expect(calls).toHaveLength(0);
    expect(delivery.delivered).toBe(false);
    expect(delivery.attempts).toBe(0);
  });

  it("tries twice on a server that answers badly, then reports the failure", async () => {
    vi.useFakeTimers();
    try {
      const { fetchImpl, calls } = postedFetch(new Response("overloaded", { status: 509 }), new Response("overloaded", { status: 509 }));
      const sent = sendNtfyNotice(notice(), { enabled: true, serverUrl: "https://ntfy.sh", topic: "phone" }, { fetchImpl });
      await vi.advanceTimersByTimeAsync(2_000);
      const delivery = await sent;
      expect(calls).toHaveLength(2);
      expect(delivery.delivered).toBe(false);
      expect(delivery.attempts).toBe(2);
      expect(delivery.reason).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports safe nested Node fetch error codes without leaking nested messages", async () => {
    const cause = Object.assign(new Error("do not expose host or URL"), { code: "ENOTFOUND" });
    const fetchError = Object.assign(new TypeError("fetch failed"), { cause });
    const { fetchImpl } = postedFetch(fetchError, fetchError);
    vi.useFakeTimers();
    try {
      const sent = sendNtfyNotice(notice(), { enabled: true, serverUrl: "https://ntfy.sh", topic: "reader-secret-topic" }, { fetchImpl });
      await vi.advanceTimersByTimeAsync(2_000);
      const delivery = await sent;
      expect(delivery.delivered).toBe(false);
      expect(delivery.reason).toContain("ENOTFOUND");
      expect(delivery.reason).not.toContain("do not expose");
      expect(delivery.reason).not.toContain("reader-secret-topic");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the topic out of the reason a failure reports", async () => {
    vi.useFakeTimers();
    try {
      const { fetchImpl } = postedFetch(new Error("connect failed to https://ntfy.sh/reader-secret-topic"), new Error("connect failed to https://ntfy.sh/reader-secret-topic"));
      const sent = sendNtfyNotice(notice(), { enabled: true, serverUrl: "https://ntfy.sh", topic: "reader-secret-topic" }, { fetchImpl });
      await vi.advanceTimersByTimeAsync(2_000);
      const delivery = await sent;
      expect(delivery.delivered).toBe(false);
      expect(delivery.reason ?? "").not.toContain("reader-secret-topic");
    } finally {
      vi.useRealTimers();
    }
  });

  it("logs the delivery without the topic", async () => {
    const lines: Record<string, unknown>[] = [];
    const { fetchImpl } = postedFetch(new Response("", { status: 200 }));
    await sendNtfyNotice(notice(), { enabled: true, topic: "reader-secret-topic" }, { fetchImpl, log: (fields) => { lines.push(fields); } });
    expect(JSON.stringify(lines)).not.toContain("reader-secret-topic");
  });
});
