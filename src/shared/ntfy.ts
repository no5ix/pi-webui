/**
 * ntfy as a notification provider: the rules this repository follows, in one place.
 *
 * ntfy is a plain HTTP POST: the message is the body, the title and the click target are headers,
 * and the topic is the address. That is the whole protocol, and it is why PI WEB adds no daemon,
 * no push subscription store and no VAPID key pair for it - one `fetch` reaches a phone that has
 * the ntfy app open, from the machine the task runs on, whether any browser is running or not.
 *
 * Two properties of the protocol decide the shape of this module.
 *
 * **The topic is a bearer secret on the public server.** Anyone who knows `ntfy.sh/<topic>` can
 * publish to that topic, and - which is worse - anyone who knows it can *read* every notice, which
 * in PI WEB means session names and what the agent was working on. So the topic never leaves the
 * server: config responses carry a presence flag (`ntfyConfigured`), never the value; the settings
 * panel writes it and reads back only that it is set; and every error that goes to a log, a response
 * or the reader has the topic redacted out of it, because a server's own message tends to quote the
 * URL it refused.
 *
 * **Delivery is best-effort.** ntfy answers 2xx and the message is queued; there is no read receipt
 * and no retry the sender can see. A notification is therefore never allowed to be part of a task's
 * path: the daemon fires it and does not await it, a timeout bounds the fetch, a retry is bounded,
 * and a failure is recorded as this provider's status only - the browser channel and the task itself
 * are unaffected.
 */

import { isRecord, errorMessage } from "./unknownValues.js";

/** What a reader can be told about. One switch per event, per provider; `NTFY_EVENT_FIELDS` is the list. */
export type NotificationEvent = "completed" | "failed" | "ask-user";

/** An ntfy server's defaults, and the bounds the protocol imposes. */
export const DEFAULT_NTFY_SERVER_URL = "https://ntfy.sh";
export const NTFY_DEFAULT_TIMEOUT_MS = 5_000;
export const NTFY_MIN_TIMEOUT_MS = 500;
export const NTFY_MAX_TIMEOUT_MS = 30_000;
export const NTFY_MAX_ATTEMPTS = 2;
/** ntfy's own limits (docs/server-config: message size, title, priority 1-5). */
export const NTFY_MAX_TITLE_CHARS = 120;
export const NTFY_MAX_MESSAGE_CHARS = 1024;
/** A topic is the whole address on the public server, and ntfy caps it at 48 characters. */
export const NTFY_MAX_TOPIC_CHARS = 48;
const TOPIC_PATTERN = /^[A-Za-z0-9._-]+$/u;

/**
 * Where notices go, and which events the reader asked for.
 *
 * Every field is optional: a stored config that names nothing is a provider that is off, and a
 * partial write from the settings panel must not clear the parts the reader did not touch.
 */
export interface NtfyConfig {
  enabled?: boolean;
  /** The server that receives the POST; defaults to the public `https://ntfy.sh`. */
  serverUrl?: string;
  /** The topic. Effectively a bearer secret on a public server, so it is never sent to a browser. */
  topic?: string;
  onCompleted?: boolean;
  onFailed?: boolean;
  onAskUser?: boolean;
  /** Where a tap lands. Absent means the notice carries no click target. */
  clickUrlBase?: string;
  timeoutMs?: number;
}

/** One notice to deliver. The provider adds the protocol's own fields. */
export interface NtfyNotice {
  readonly event: NotificationEvent;
  readonly title: string;
  readonly message: string;
  /** Deduplication key. A second event with the same key while the first is recent is not sent. */
  readonly dedupeKey: string;
  /** Extra click target appended to `clickUrlBase`; a provider-relative route such as `?session=abc`. */
  readonly route?: string;
  /** ntfy tag emoji, e.g. `white_check_mark`. */
  readonly tags?: readonly string[];
}

/** What one delivery attempt cost, in the words a reader can act on. */
export interface NtfyDelivery {
  readonly delivered: boolean;
  readonly attempts: number;
  /** Why it failed, with the topic redacted. Absent when it was delivered. */
  readonly reason?: string;
  /** Why nothing was sent at all: off, unconfigured, refused by a switch, deduplicated. */
  readonly skipped?: NtfySkip;
}

export type NtfySkip = "disabled" | "unconfigured" | "event-off" | "duplicate";

/**
 * What the server says about the ntfy channel: the switches, the server, and that a topic exists.
 *
 * The topic is absent by construction. The panel edits the channel from this, and writes a topic it
 * never sees again.
 */
export interface NtfyStatus {
  enabled: boolean;
  ready: boolean;
  reason?: string;
  topicConfigured: boolean;
  config?: NtfyConfig;
}

/** A config the reader wrote that cannot be used. Carried as a message for the settings panel. */
export class NtfyConfigError extends Error {
  override name = "NtfyConfigError";
}

/** Which switches the reader's config asks for, per event. A config that is off answers false for all. */
export function ntfyWantsEvent(config: NtfyConfig | undefined, event: NotificationEvent): boolean {
  if (config?.enabled !== true) return false;
  const switches: Record<NotificationEvent, boolean | undefined> = {
    completed: config.onCompleted,
    failed: config.onFailed,
    "ask-user": config.onAskUser,
  };
  return switches[event] === true;
}

/** The config field that switches an event. */
export type NtfyEventSwitch = "onCompleted" | "onFailed" | "onAskUser";

/**
 * The switches a settings panel offers, in the order it shows them, with the words it shows them in.
 *
 * One list for both providers, because the events are the product's and not a provider's: a reader who
 * asks to be told when a task fails asks every channel that exists. A panel that hardcodes its own rows
 * is a panel that drifts from the events the daemon can emit.
 */
export const NTFY_EVENT_FIELDS: readonly { readonly key: NtfyEventSwitch; readonly label: string }[] = [
  { key: "onCompleted", label: "Notify when a task completes" },
  { key: "onFailed", label: "Notify when a task fails" },
  { key: "onAskUser", label: "Notify when PI WEB asks me for input" },
];

/**
 * Whether a config is complete enough to deliver: enabled, with a usable server and a topic.
 * `reason` is the sentence the settings panel shows when it is not.
 */
export function ntfyReadiness(config: NtfyConfig | undefined): { ready: boolean; reason?: string } {
  if (config === undefined) return { ready: false, reason: "ntfy is not configured." };
  if (config.enabled !== true) return { ready: false, reason: "ntfy is configured but switched off." };
  const server = validateNtfyServerUrl(config.serverUrl);
  if (server === undefined) return { ready: false, reason: "The ntfy server URL is missing or not an http(s) address." };
  const topic = validateNtfyTopic(config.topic);
  if (topic === undefined) return { ready: false, reason: "The ntfy topic is missing or uses characters ntfy does not allow." };
  return { ready: true };
}

/**
 * An http(s) origin with an optional path prefix, no credentials, no query, no fragment.
 *
 * Credentials in the URL are refused because the authorization header is the supported way and a
 * `user:pass@` prefix ends up in access logs. A path prefix is allowed because self-hosted ntfy is
 * commonly mounted behind a reverse proxy (`https://example.com/ntfy`).
 */
export function validateNtfyServerUrl(value: string | undefined): string | undefined {
  const text = value?.trim();
  if (text === undefined || text === "") return undefined;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
  if (url.username !== "" || url.password !== "") return undefined;
  if (url.search !== "" || url.hash !== "") return undefined;
  if (url.hostname === "") return undefined;
  return url.toString().replace(/\/+$/u, "");
}

/** A topic ntfy accepts, or undefined. */
export function validateNtfyTopic(value: string | undefined): string | undefined {
  const text = value?.trim();
  if (text === undefined || text === "") return undefined;
  if (text.length > NTFY_MAX_TOPIC_CHARS) return undefined;
  if (!TOPIC_PATTERN.test(text)) return undefined;
  return text;
}

/** A click base, validated the same way as the server URL. Undefined means "no tap target". */
export function validateNtfyClickUrlBase(value: string | undefined): string | undefined {
  const text = value?.trim();
  if (text === undefined || text === "") return undefined;
  return validateNtfyServerUrl(text);
}

/** The POST target: the server plus the topic. A server typed with a trailing slash must not post to `//topic`. */
export function ntfyEndpointUrl(serverUrl: string, topic: string): string {
  return `${serverUrl.replace(/\/+$/u, "")}/${encodeURIComponent(topic)}`;
}

/** The headers ntfy reads, with the title carried base64 so any language survives a header. */
export function ntfyNoticeHeaders(notice: NtfyNotice, clickUrl: string | undefined): Record<string, string> {
  const title = notice.title.slice(0, NTFY_MAX_TITLE_CHARS);
  const headers: Record<string, string> = {
    title: encodeRfc2047(title),
    priority: "4",
    // ntfy keeps one message per key; a second notice for the same session replaces the first
    // instead of stacking a pile of finished tasks on a phone.
    "slug": slugKey(notice.dedupeKey),
  };
  if (clickUrl !== undefined) headers["click"] = clickUrl;
  if (notice.tags !== undefined && notice.tags.length > 0) headers["tags"] = notice.tags.join(",");
  return headers;
}

/** The body, cut to the size ntfy accepts. */
export function ntfyNoticeBody(message: string): string {
  return message.slice(0, NTFY_MAX_MESSAGE_CHARS);
}

/** `https://host/ntfy` + `?session=x` → `https://host/ntfy?session=x`; a base that is not a URL yields nothing. */
export function ntfyClickUrl(clickUrlBase: string | undefined, route: string | undefined): string | undefined {
  if (clickUrlBase === undefined) return undefined;
  const base = validateNtfyClickUrlBase(clickUrlBase);
  if (base === undefined) return undefined;
  if (route === undefined || route === "") return base;
  // The route arrives in the shape the browser's own routing reads it (`?session=<id>`), and the click
  // header wants one address, so the join depends on which part of a URL the route is.
  const target = route.startsWith("/")
    ? `${base}${route}`
    : route.startsWith("?")
      ? `${base}${base.includes("?") ? "&" : ""}${route}`
      : `${base}/${route}`;
  // The route is a query, which the server-URL validator refuses on purpose (a publish address takes
  // no query). A tap target is a page address, so it is checked for what makes it unsafe to send: not
  // http(s), or credentials baked into it.
  return validateNtfyTargetUrl(target);
}

/** An http(s) address with no credentials, path and query allowed: what a tap may point at. */
function validateNtfyTargetUrl(text: string): string | undefined {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
  if (url.username !== "" || url.password !== "") return undefined;
  if (url.hostname === "") return undefined;
  return url.toString();
}

/**
 * The config as it reaches a browser: the topic is dropped, and a presence flag says it is set.
 *
 * This is the whole exposure rule for ntfy in one function, so a config response, a proxy read of a
 * remote machine, and a parsed remote response all agree.
 */
/**
 * The ntfy block as it may leave the server: the switches and the server, and no topic at all.
 *
 * A ntfy topic is a bearer secret - anyone who can name it can publish to the device behind it, with no
 * login and no approval - so it never travels to a browser. The answer keeps the shape and drops the
 * key; the panel shows "a topic is stored" from `ntfyTopicConfigured`, which is the whole truth a
 * browser is given. The value is dropped rather than replaced with a marker: a marker that is a legal
 * topic can be written back by a settings save that echoes the config it was given, and the literal
 * `redacted` is a topic anyone on the public server can subscribe to (2026-11-13).
 * {@link NTFY_REDACTED_TOPIC} stays only so an old client's echoed marker is recognised and refused.
 */
export const NTFY_REDACTED_TOPIC = "redacted";

export function publicNtfyConfig(config: NtfyConfig): NtfyConfig {
  // `delete`, not a marker value: "redacted" is a legal topic, and a settings screen that saves the
  // config it was shown would store it as the reader's channel (2026-11-13).
  const copy: Record<string, unknown> = { ...config };
  delete copy["topic"];
  return copy;
}

/** Whether a config has a topic, without saying what it is. */
export function ntfyTopicConfigured(config: NtfyConfig | undefined): boolean {
  return config?.topic !== undefined && config.topic !== "";
}

/**
 * Every copy of the topic out of a string, so a server's own message ("failed to reach
 * https://ntfy.sh/my-secret-topic") never carries it into a log line, an API answer, or the panel.
 * The percent-encoded form is cut as well: a proxy that echoes the request target writes
 * `/my%2Dsecret`, which a plain split leaves standing.
 */
export function redactNtfySecret(text: string, secrets: readonly (string | undefined)[]): string {
  let redacted = text;
  for (const secret of secrets) {
    const value = secret?.trim();
    if (value === undefined || value === "") continue;
    const forms = [value];
    const encoded = encodeURIComponent(value);
    if (encoded !== value) forms.push(encoded);
    for (const form of forms) redacted = redacted.split(form).join("[redacted]");
  }
  return redacted;
}

/**
 * An ntfy request's answer, read the way the server answers: a JSON `{ id, ... }` on 2xx.
 *
 * `retryable` is the answer to "is it worth asking again": a 4xx is a refusal of the request itself -
 * no topic, a topic that is not allowed, a body the server will not take - and the same bytes are
 * refused the second time. A timeout, a 5xx, and a 429 are worth one more try.
 */
export function ntfyDeliveryOutcome(response: Response, body: string): { accepted: boolean; reason?: string; retryable: boolean } {
  if (response.ok) return { accepted: true, retryable: false };
  const status = response.status;
  const detail = body.trim().slice(0, 200);
  return {
    accepted: false,
    reason: `ntfy answered ${String(status)}${detail === "" ? "." : `: ${detail}`}`,
    retryable: status >= 500 || status === 429 || status === 408,
  };
}

/**
 * One notice, sent: the attempts, the timeout, and the redaction.
 *
 * This is the transport, shared by the two callers that need it - the session daemon, which sends a
 * run's notices, and the web process, which answers the Settings panel's **Send a test notice** -
 * because a test that travelled by a different path would prove nothing about the real one.
 *
 * ntfy answers 2xx once it has accepted the message, so a bounded retry after a timeout is the whole
 * recovery strategy: at most {@link NTFY_MAX_ATTEMPTS} tries, one pause between them, and a fetch that
 * cannot outlive its timeout. Nothing here throws; a failure is a {@link NtfyDelivery} whose `reason`
 * has the topic cut out of it, because an endpoint's own message tends to name the URL it refused.
 */
export async function sendNtfyNotice(
  notice: NtfyNotice,
  config: NtfyConfig,
  options: { fetchImpl?: typeof fetch; now?: () => number; log?: (fields: Record<string, unknown>, message: string) => void } = {},
): Promise<NtfyDelivery> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => Date.now());
  const serverUrl = validateNtfyServerUrl(config.serverUrl) ?? DEFAULT_NTFY_SERVER_URL;
  const topic = validateNtfyTopic(config.topic);
  if (topic === undefined) return { delivered: false, attempts: 0, reason: "The ntfy topic is not set." };
  const timeoutMs = config.timeoutMs ?? NTFY_DEFAULT_TIMEOUT_MS;
  const click = ntfyClickUrl(validateNtfyClickUrlBase(config.clickUrlBase), notice.route);
  const url = ntfyEndpointUrl(serverUrl, topic);
  const headers = ntfyNoticeHeaders(notice, click);
  const body = ntfyNoticeBody(notice.message);
  let reason = "ntfy did not answer.";
  let attempts = 0;
  for (let attempt = 1; attempt <= NTFY_MAX_ATTEMPTS; attempt += 1) {
    attempts = attempt;
    const started = now();
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { ...headers, "content-type": "text/plain; charset=utf-8" },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await response.text().catch(() => "");
      const outcome = ntfyDeliveryOutcome(response, text);
      if (outcome.accepted) {
        options.log?.({ event: notice.event, attempts: attempt, ms: now() - started }, "ntfy notice delivered");
        return { delivered: true, attempts: attempt };
      }
      reason = outcome.reason ?? reason;
      if (!outcome.retryable) break;
    } catch (error: unknown) {
      reason = errorMessage(error);
    }
    if (attempt < NTFY_MAX_ATTEMPTS) await sleepMs(NTFY_RETRY_BACKOFF_MS);
  }
  const safeReason = redactNtfySecret(reason, [topic, config.clickUrlBase, config.serverUrl]);
  options.log?.({ event: notice.event, reason: safeReason }, "ntfy notice failed");
  return { delivered: false, attempts: attempts, reason: safeReason };
}

export const NTFY_RETRY_BACKOFF_MS = 1_000;

/**
 * The pause between attempts. It is bounded by the backoff at most one second long, and nothing on a
 * task's path waits for it - a daemon shutting down mid-notice spends at most that on the last attempt.
 */
function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/** A dedupe key that is also a valid ntfy slug: ASCII, short, no separators that break a header. */
function slugKey(key: string): string {
  const cleaned = key.replace(/[^A-Za-z0-9._-]/gu, "-").slice(0, 48);
  return cleaned === "" ? "pi-web" : cleaned;
}

function encodeRfc2047(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64 = btoa(binary);
  return `=?UTF-8?B?${base64}?=`;
}

/** A config block read from a request body or a config file. Rejects anything it does not know. */
export function parseNtfyConfig(value: unknown, source: string): NtfyConfig {
  if (!isRecord(value)) throw new NtfyConfigError(`${source} ntfy must be an object`);
  const config: NtfyConfig = {};
  for (const key of ["enabled", "onCompleted", "onFailed", "onAskUser"] as const) {
    const flag = value[key];
    if (flag !== undefined) {
      if (typeof flag !== "boolean") throw new NtfyConfigError(`${source} ntfy ${key} must be true or false`);
      config[key] = flag;
    }
  }
  const serverUrl = readOptionalString(value["serverUrl"]);
  if (serverUrl !== undefined) {
    const normalized = validateNtfyServerUrl(serverUrl);
    if (normalized === undefined) throw new NtfyConfigError(`${source} ntfy serverUrl must be an http(s) address without credentials`);
    config.serverUrl = normalized;
  }
  const topic = readOptionalString(value["topic"]);
  if (topic !== undefined) {
    const validated = validateNtfyTopic(topic);
    if (validated === undefined) throw new NtfyConfigError(`${source} ntfy topic must be 1-${String(NTFY_MAX_TOPIC_CHARS)} characters of letters, digits, dot, underscore or hyphen`);
    config.topic = validated;
  }
  const clickUrlBase = readOptionalString(value["clickUrlBase"]);
  if (clickUrlBase !== undefined) {
    const validated = validateNtfyClickUrlBase(clickUrlBase);
    if (validated === undefined) throw new NtfyConfigError(`${source} ntfy clickUrlBase must be an http(s) address without credentials`);
    config.clickUrlBase = validated;
  }
  const timeoutMs = value["timeoutMs"];
  if (timeoutMs !== undefined) {
    if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs < NTFY_MIN_TIMEOUT_MS || timeoutMs > NTFY_MAX_TIMEOUT_MS) {
      throw new NtfyConfigError(`${source} ntfy timeoutMs must be between ${String(NTFY_MIN_TIMEOUT_MS)} and ${String(NTFY_MAX_TIMEOUT_MS)}`);
    }
    config.timeoutMs = timeoutMs;
  }
  return config;
}

function readOptionalString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return "";
  return value.trim() === "" ? undefined : value.trim();
}
