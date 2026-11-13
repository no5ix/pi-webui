import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { piWebDataDir } from "../../../config.js";
import { isAppBaseUrl, isPushEndpoint, type PushSubscriptionRecord, type PushSubscriptionRegistration } from "../../../shared/notificationEvents.js";
import { errorMessage, isRecord } from "../../../shared/unknownValues.js";

/**
 * The devices that asked to be told.
 *
 * A push subscription is a device's address, and a push service hands out a fresh one whenever a
 * browser re-registers: the same iPhone that clears its site data comes back with a new endpoint,
 * and a subscription whose endpoint has been unsubscribed answers 404/410 forever. So the store is
 * keyed by endpoint (one row per live address, refreshed in place) and the sender prunes the rows a
 * push service says are gone. A store that only ever grew would send every event into dead addresses
 * and fill a phone's notification centre with duplicates of the same session.
 *
 * The file sits in PI WEB's data directory next to the other daemon state. It carries device
 * addresses and browser strings, and no secrets: the VAPID private key lives in its own file, and a
 * subscription's auth secret is only ever used to encrypt a payload to that device.
 */

export interface PushSubscriptionStoreOptions {
  filePath?: string;
  now?: () => Date;
  createId?: () => string;
  logger?: { warn: (message: string) => void };
}

/**
 * What the store knows about the devices, and whether it knows anything at all.
 *
 * `devices: 0` with an `unreadable` reason is a file that did not answer, not a PI WEB with no
 * devices on it. The settings panel shows the difference, because "No device is registered" sent
 * a reader to unsubscribe a phone that was registered fine.
 */
export interface PushSubscriptionHealth {
  devices: number;
  unreadable: string | undefined;
}

export function defaultPushSubscriptionFilePath(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): string {
  return join(piWebDataDir(env, cwd), "push", "subscriptions.json");
}

export const PUSH_SUBSCRIPTION_LIMIT = 64;

interface StoredFile {
  subscriptions: PushSubscriptionRecord[];
}

export class PushSubscriptionStore {
  private readonly filePath: string;
  private readonly now: () => Date;
  private readonly createId: () => string;
  private readonly logger: { warn: (message: string) => void } | undefined;
  private cached: StoredFile | undefined;
  private unreadable: string | undefined;
  /**
   * Writes are serialized: two registrations landing together must not drop one of the rows. The chain
   * is kept resolved even when a write fails, so one full disk does not wedge the store for every
   * later registration; the caller of the failed write is told about that write.
   */
  private writing: Promise<void> = Promise.resolve();

  constructor(options: PushSubscriptionStoreOptions = {}) {
    this.filePath = options.filePath ?? defaultPushSubscriptionFilePath();
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? (() => randomUUID());
    this.logger = options.logger;
  }

  async list(): Promise<PushSubscriptionRecord[]> {
    return (await this.read()).subscriptions;
  }

  async count(): Promise<number> {
    return (await this.read()).subscriptions.length;
  }

  /**
   * Register a device. An endpoint that is already known is refreshed in place, keeping its id, so a
   * browser that re-subscribes on every load does not accumulate a row per load.
   *
   * Returns `undefined` when the file is at its limit: a device is told to ask its browser to
   * unsubscribe, which is the only party that can free an address.
   */
  async register(registration: PushSubscriptionRegistration): Promise<{ record: PushSubscriptionRecord; created: boolean } | undefined> {
    const stored = await this.read();
    const endpoint = registration.endpoint.trim();
    const existing = stored.subscriptions.find((entry) => entry.endpoint === endpoint);
    const appBaseUrl = registration.appBaseUrl?.trim() ?? "";
    const userAgent = (registration.userAgent ?? "").trim().slice(0, 256);
    if (existing !== undefined) {
      const refreshed: PushSubscriptionRecord = {
        ...existing,
        publicKey: registration.keys.p256dh,
        authToken: registration.keys.auth,
        appBaseUrl: appBaseUrl === "" ? existing.appBaseUrl : appBaseUrl,
        userAgent: userAgent === "" ? existing.userAgent : userAgent,
      };
      if (sameRecord(existing, refreshed)) return { record: existing, created: false };
      await this.write({ ...stored, subscriptions: stored.subscriptions.map((entry) => (entry.id === existing.id ? refreshed : entry)) });
      return { record: refreshed, created: false };
    }
    if (stored.subscriptions.length >= PUSH_SUBSCRIPTION_LIMIT) return undefined;
    const record: PushSubscriptionRecord = {
      id: this.createId(),
      endpoint,
      publicKey: registration.keys.p256dh,
      authToken: registration.keys.auth,
      appBaseUrl,
      userAgent,
      createdAt: this.now().toISOString(),
      lastDeliveredAt: undefined,
      failures: 0,
    };
    await this.write({ subscriptions: [...stored.subscriptions, record] });
    return { record, created: true };
  }

  async remove(id: string): Promise<boolean> {
    const stored = await this.read();
    if (!stored.subscriptions.some((entry) => entry.id === id)) return false;
    await this.write({ subscriptions: stored.subscriptions.filter((entry) => entry.id !== id) });
    return true;
  }

  /** Drop the addresses a push service says are gone, and the rows no browser will ever claim. */
  async removeMany(ids: readonly string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const stored = await this.read();
    const drop = new Set(ids);
    const kept = stored.subscriptions.filter((entry) => !drop.has(entry.id));
    const removed = stored.subscriptions.length - kept.length;
    if (removed > 0) await this.write({ subscriptions: kept });
    return removed;
  }

  /** Record a delivery, and count a failure so a permanently failing device can be reported. */
  async recordDelivery(id: string, delivered: boolean): Promise<void> {
    const stored = await this.read();
    if (!stored.subscriptions.some((entry) => entry.id === id)) return;
    const at = this.now().toISOString();
    await this.write({
      subscriptions: stored.subscriptions.map((entry) => (entry.id === id
        ? { ...entry, ...(delivered ? { lastDeliveredAt: at, failures: 0 } : { failures: entry.failures + 1 }) }
        : entry)),
    });
  }

  /**
   * The file, read once and kept.
   *
   * A daemon that reread the file for every event would let a reader's own removal disappear behind
   * a concurrent write, and the file is small: a device list, not a transcript.
   */
  private async read(): Promise<StoredFile> {
    if (this.cached !== undefined) return this.cached;
    const read = await readJson(this.filePath);
    if (!read.ok) {
      this.unreadable = read.reason;
      this.logger?.warn(`[push] the device file could not be read (${read.reason}), so no device is known and the file is left as it is`);
      this.cached = { subscriptions: [] };
      return this.cached;
    }
    this.unreadable = undefined;
    this.cached = normalize(read.value);
    return this.cached;
  }

  /** The device list as the store knows it, including the case where it knows nothing. */
  async health(): Promise<PushSubscriptionHealth> {
    const stored = await this.read();
    return { devices: stored.subscriptions.length, unreadable: this.unreadable };
  }

  private async write(next: StoredFile): Promise<void> {
    // A file this process could not read is not a file it may overwrite. Writing the empty list it
    // guessed would destroy the addresses of every device that registered before the read failed.
    if (this.unreadable !== undefined) throw new Error(`The push device file could not be read (${this.unreadable}), so nothing is written over it`);
    this.cached = next;
    const snapshot = next;
    const attempt = this.writing.then(() => writeJson(this.filePath, snapshot));
    this.writing = attempt.catch(() => undefined);
    await attempt;
  }
}

function sameRecord(a: PushSubscriptionRecord, b: PushSubscriptionRecord): boolean {
  return a.publicKey === b.publicKey && a.authToken === b.authToken && a.appBaseUrl === b.appBaseUrl && a.userAgent === b.userAgent;
}

type FileRead = { ok: true; value: unknown } | { ok: false; reason: string };

/**
 * A device file that did not answer is reported, not read as empty.
 *
 * No file at all is genuinely an empty list. A file that is half-written by a kill, unreadable, or
 * not JSON is not: read as empty, the store would answer "no devices" and then write that empty list
 * over the addresses of every device that registered.
 */
async function readJson(path: string): Promise<FileRead> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error: unknown) {
    if (isNotFound(error)) return { ok: true, value: { subscriptions: [] } };
    return { ok: false, reason: errorMessage(error) };
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return { ok: true, value: parsed };
  } catch {
    return { ok: false, reason: "the file is not JSON" };
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && Reflect.get(error, "code") === "ENOENT";
}

/** Written beside itself and moved into place: a daemon killed mid-write leaves the previous list intact. */
async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}

/**
 * Rows are read defensively: an entry that is not a push subscription is dropped rather than sent to,
 * and a row whose endpoint stopped being an HTTPS push endpoint cannot be delivered to.
 */
export function normalize(value: unknown): StoredFile {
  if (!isRecord(value)) return { subscriptions: [] };
  const entries: unknown = value["subscriptions"];
  if (!Array.isArray(entries)) return { subscriptions: [] };
  return { subscriptions: entries.filter(isSubscriptionEntry).map(toRecord) };
}

/** An entry worth keeping: it has an id, and an endpoint and keys a sender can use. */
function isSubscriptionEntry(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  return typeof value["id"] === "string" && typeof value["endpoint"] === "string" && isPushEndpoint(value["endpoint"])
    && typeof value["publicKey"] === "string" && value["publicKey"] !== "" && typeof value["authToken"] === "string" && value["authToken"] !== "";
}

/**
 * A device's base address is what a notification tap is built on, so a stored address is checked the
 * same way a registration is: a hand-edited file must not point a tap at a `javascript:` URL, at a
 * credential, or at somebody else's host with a query riding along.
 */
function webBase(value: string): string {
  return isAppBaseUrl(value) ? value : "";
}

function toRecord(entry: Record<string, unknown>): PushSubscriptionRecord {
  const text = (value: unknown, max: number): string => (typeof value === "string" ? value.slice(0, max) : "");
  const number = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0);
  return {
    id: text(entry["id"], 64),
    endpoint: text(entry["endpoint"], 2048),
    publicKey: text(entry["publicKey"], 512),
    authToken: text(entry["authToken"], 512),
    appBaseUrl: webBase(text(entry["appBaseUrl"], 512)),
    userAgent: text(entry["userAgent"], 256),
    createdAt: text(entry["createdAt"], 40),
    lastDeliveredAt: typeof entry["lastDeliveredAt"] === "string" ? text(entry["lastDeliveredAt"], 40) : undefined,
    failures: number(entry["failures"]),
  };
}
