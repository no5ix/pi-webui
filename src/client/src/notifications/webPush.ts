import { request } from "../api/http";
import { resolveAppUrl, type AppUrlContext } from "../appUrl";
import { ensureNotificationRegistration } from "./taskNotifications";
import { isRecord } from "../../../shared/unknownValues";

/**
 * This browser's push subscription, and the devices this PI WEB is sending to.
 *
 * A subscription is a device's address at a push service, minted by the browser and handed to the
 * server. Three facts the panel must keep apart, because readers meet all three as "notifications
 * don't work":
 *
 * - the browser cannot do push at all (no `PushManager`, or a page on plain HTTP);
 * - the browser will not do it (the reader has not granted, or has denied, the permission);
 * - the server cannot send (no VAPID key pair, push turned off in its config).
 *
 * Subscribing is asked for once, by the switch. A subscription is registered with the server that
 * minted the VAPID key it was created with: a subscription is only deliverable by the sender that
 * holds that key pair, which is why the device list is read from the server and never assembled from
 * what this browser remembers.
 *
 * Turning push off unsubscribes at the push service as well as deleting the stored address. A
 * subscription left behind is an address someone else's sender could keep using, and a device list
 * that never shrinks is a device list nobody trusts.
 */

export type PushSupport = "unsupported" | "insecure" | "no-permission" | "denied" | "prompt" | "granted";

export interface PushDevice {
  readonly id: string;
  readonly userAgent: string;
  readonly createdAt: string;
  readonly lastDeliveredAt: string | undefined;
  readonly failures: number;
}

export interface PushPanelState {
  readonly support: PushSupport;
  readonly serverConfigured: boolean;
  readonly serverDisabled: boolean;
  readonly serverProblem: string | undefined;
  /** The VAPID public key this device's subscription must be created with. */
  readonly publicKey: string | undefined;
  readonly devices: readonly PushDevice[];
  /** This browser's own subscription, when the server has one for it. */
  readonly self: PushDevice | undefined;
  /** Why the server's answer could not be read, when it could not. */
  readonly readFailure: string | undefined;
  /** Why the server cannot read its own device file. A list that did not answer is not an empty list. */
  readonly devicesUnknown: string | undefined;
  /** This device is registered, but the server's push key has changed since: every send is refused. */
  readonly keyChanged: boolean;
}

export interface PushActionOutcome {
  readonly ok: boolean;
  /** What the reader needs to do next, when the outcome asks for something of them. */
  readonly reason: string;
}

const SUBSCRIPTION_KEY = "pi-web.push.subscription";
const REGISTERED_KEY = "pi-web.push.vapid";

export function pushSupport(): PushSupport {
  if (!Reflect.has(navigator, "serviceWorker") || !("PushManager" in window) || !("PushSubscription" in window)) return "unsupported";
  if (!window.isSecureContext) return "insecure";
  const permission = Notification.permission;
  return permission === "granted" ? "granted" : permission === "denied" ? "denied" : "prompt";
}

/** The state the panel shows, read from the server so the device list is the one it sends to. */
export async function pushPanelState(): Promise<PushPanelState> {
  const support = pushSupport();
  const selfId = storedSubscriptionId();
  try {
    const answer = await request("api/push/state", parsePushState);
    const self = answer.devices.find((device) => device.id === selfId);
    const registeredKey = storedVapidKey();
    return {
      support,
      serverConfigured: answer.configured,
      serverDisabled: answer.disabled,
      serverProblem: answer.problem,
      publicKey: answer.publicKey,
      devices: answer.devices,
      self,
      readFailure: undefined,
      devicesUnknown: answer.devicesUnknown,
      keyChanged: self !== undefined && registeredKey !== undefined && answer.publicKey !== undefined && answer.publicKey !== registeredKey,
    };
  } catch (error: unknown) {
    return {
      support,
      serverConfigured: false,
      serverDisabled: false,
      serverProblem: undefined,
      publicKey: undefined,
      devices: [],
      self: undefined,
      readFailure: error instanceof Error ? error.message : String(error),
      devicesUnknown: undefined,
      keyChanged: false,
    };
  }
}

/**
 * Register this device for push.
 *
 * The steps are in the order the browser needs them: a service worker registration first (a push
 * subscription belongs to one), permission second, the VAPID public key third, then the push manager,
 * then the server. A failure at any step says which one it was, because "notifications are off" is
 * not an answer a reader can act on.
 */
export async function enableDevicePush(): Promise<PushActionOutcome> {
  const support = pushSupport();
  if (support === "unsupported") return { ok: false, reason: "This browser has no push. On iPhone and iPad Safari gives push only to a web app added to the Home Screen." };
  if (support === "insecure") return { ok: false, reason: "Push needs an HTTPS address. Open PI WEB at its HTTPS URL - a Tailscale address with a certificate is enough - and turn this on there." };
  const registration = await ensureNotificationRegistration();
  if (registration === undefined) return { ok: false, reason: "The page could not register its service worker, and a push subscription belongs to one." };
  if (Notification.permission !== "granted") {
    const asked = await Notification.requestPermission();
    if (asked !== "granted") return { ok: false, reason: asked === "denied" ? "The browser says this site may not show notifications. Allow them in its site settings, then turn this on." : "The browser was not given permission, so nothing was registered." };
  }
  const answer = await pushPanelState();
  if (answer.serverDisabled) return { ok: false, reason: "This PI WEB has push turned off in its config (push.enabled: false)." };
  if (!answer.serverConfigured || answer.publicKey === undefined) return { ok: false, reason: answer.serverProblem ?? "This PI WEB has no VAPID key pair, so it cannot send push." };
  let subscription: PushSubscription;
  try {
    const existing = await registration.pushManager.getSubscription();
    subscription = existing ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(answer.publicKey) });
  } catch (error: unknown) {
    return { ok: false, reason: `The browser refused to create a push subscription: ${error instanceof Error ? error.message : String(error)}` };
  }
  const json = subscription.toJSON();
  const endpoint = json.endpoint;
  const p256dh = json.keys?.["p256dh"];
  const auth = json.keys?.["auth"];
  if (endpoint === undefined || p256dh === undefined || auth === undefined) return { ok: false, reason: "The browser's subscription came back without an endpoint and keys, so it was not registered." };
  try {
    const registered = await request("api/push/subscriptions", parseRegistrationAnswer, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint, keys: { p256dh, auth }, appBaseUrl: appBaseUrl(), userAgent: navigator.userAgent }),
    });
    setStoredSubscriptionId(registered.id);
    setStoredVapidKey(answer.publicKey);
    return { ok: true, reason: registered.created ? "This device is registered for push notifications." : "This device was already registered for push notifications." };
  } catch (error: unknown) {
    return { ok: false, reason: `The server refused the subscription: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** Unsubscribe this device, at the push service and on the server. */
export async function disableDevicePush(): Promise<PushActionOutcome> {
  const id = storedSubscriptionId();
  const registration = await (Reflect.has(navigator, "serviceWorker") ? navigator.serviceWorker.getRegistration() : Promise.resolve(undefined));
  const subscription = (registration === undefined ? undefined : await registration.pushManager.getSubscription()) ?? undefined;
  if (subscription !== undefined) await subscription.unsubscribe().catch(() => undefined);
  if (id !== undefined) {
    await request(`api/push/subscriptions/${encodeURIComponent(id)}`, parseRemoved, { method: "DELETE" }).catch(() => undefined);
  }
  setStoredSubscriptionId(undefined);
  setStoredVapidKey(undefined);
  return { ok: true, reason: "This device is no longer registered for push notifications." };
}

/**
 * Register this device again, at the push service as well as here.
 *
 * A browser hands back the subscription it already has, so a server that minted a new VAPID identity
 * (its key file was unreadable, or the deployment rotated its pair) keeps being refused by the push
 * service for this device, and the panel would otherwise say "already registered" forever.
 */
export async function rereregisterDevicePush(): Promise<PushActionOutcome> {
  const retired = await disableDevicePush();
  if (!retired.ok) return retired;
  const registered = await enableDevicePush();
  return { ok: registered.ok, reason: registered.ok ? "This device registered again with the server's current push key." : `Re-registering this device failed: ${registered.reason}` };
}

/** A real event, sent to every registered device, so the reader can see where the notice lands. */
export async function sendPushTest(sessionId: string, sessionName: string, projectName: string): Promise<{ targets: number; problem: string | undefined; reason: string }> {
  const answer = await request("api/push/test", parseTestAnswer, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId, sessionName, projectName }),
  });
  const failed = answer.results.filter((result) => result.outcome !== "sent").length;
  const reason = answer.targets === 0
    ? answer.problem ?? "No device is registered for push, so nothing was sent."
    : `${String(answer.targets - failed)} of ${String(answer.targets)} device(s) were woken${failed === 0 ? "." : `; ${String(failed)} refused.`}`;
  return { targets: answer.targets, problem: answer.problem, reason };
}

/**
 * The address a notification's tap is built on: this device's own application root.
 *
 * The daemon does not know the host a device typed into its browser - a laptop on the tailnet, a
 * phone at a Tailscale address, a deployment under a path prefix - so the device says, from the
 * application base the app itself resolves against. Credentials and a query are left out by the
 * builder that appends the session id.
 */
export function appBaseUrl(context: AppUrlContext = { viteBaseUrl: import.meta.env.BASE_URL, documentBaseUrl: document.baseURI }): string {
  return resolveAppUrl("/", context);
}

function applicationServerKey(publicKey: string): Uint8Array<ArrayBuffer> {
  const padded = publicKey.replace(/-/gu, "+").replace(/_/gu, "/");
  const raw = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

/**
 * The page's own storage, when the browser gave this page one.
 *
 * The getter itself is what throws - Safari raises a SecurityError for `localStorage` when site data
 * is blocked - so reading it is guarded, and a page with no storage is a page that simply does not
 * remember its own subscription.
 */
function pageStorage(): object | undefined {
  try {
    const value: unknown = Reflect.get(globalThis, "localStorage");
    return typeof value === "object" && value !== null ? value : undefined;
  } catch {
    return undefined;
  }
}

type StorageMethod = (this: object, key: string, value?: string) => unknown;

function isStorageMethod(method: unknown): method is StorageMethod {
  return typeof method === "function";
}

function storageMethod(storage: object, name: string): StorageMethod | undefined {
  const method: unknown = Reflect.get(storage, name);
  return isStorageMethod(method) ? method : undefined;
}

function storedValue(key: string): string | undefined {
  const storage = pageStorage();
  const getItem = storage === undefined ? undefined : storageMethod(storage, "getItem");
  if (getItem === undefined || storage === undefined) return undefined;
  const stored: unknown = Reflect.apply(getItem, storage, [key]);
  return typeof stored === "string" && stored !== "" ? stored : undefined;
}

function setStoredValue(key: string, value: string | undefined): void {
  const storage = pageStorage();
  if (storage === undefined) return;
  const method = storageMethod(storage, value === undefined ? "removeItem" : "setItem");
  if (method === undefined) return;
  if (value === undefined) {
    Reflect.apply(method, storage, [key]);
    return;
  }
  Reflect.apply(method, storage, [key, value]);
}

function storedSubscriptionId(): string | undefined {
  return storedValue(SUBSCRIPTION_KEY);
}

function setStoredSubscriptionId(id: string | undefined): void {
  setStoredValue(SUBSCRIPTION_KEY, id);
}

/** The VAPID public key this device's subscription was created with. A server that rotated its key
 * cannot sign for this subscription any more, and only a re-registration can fix that. */
function storedVapidKey(): string | undefined {
  return storedValue(REGISTERED_KEY);
}

function setStoredVapidKey(key: string | undefined): void {
  setStoredValue(REGISTERED_KEY, key);
}

interface ServerPushState {
  configured: boolean;
  disabled: boolean;
  problem: string | undefined;
  devicesUnknown: string | undefined;
  publicKey: string | undefined;
  devices: PushDevice[];
}

function parsePushState(value: unknown): ServerPushState {
  const record = objectRecord(value);
  const state = objectRecord(record["state"]);
  return {
    configured: state["configured"] === true,
    disabled: state["disabled"] === true,
    problem: typeof record["problem"] === "string" ? record["problem"] : undefined,
    devicesUnknown: typeof record["devicesUnknown"] === "string" && record["devicesUnknown"] !== "" ? record["devicesUnknown"] : undefined,
    publicKey: typeof record["publicKey"] === "string" && record["publicKey"] !== "" ? record["publicKey"] : undefined,
    devices: Array.isArray(record["devices"]) ? record["devices"].map(parseDevice).filter((device): device is PushDevice => device !== undefined) : [],
  };
}

function parseDevice(value: unknown): PushDevice | undefined {
  const record = objectRecord(value);
  if (typeof record["id"] !== "string" || record["id"] === "") return undefined;
  return {
    id: record["id"],
    userAgent: typeof record["userAgent"] === "string" ? record["userAgent"] : "",
    createdAt: typeof record["createdAt"] === "string" ? record["createdAt"] : "",
    lastDeliveredAt: typeof record["lastDeliveredAt"] === "string" ? record["lastDeliveredAt"] : undefined,
    failures: typeof record["failures"] === "number" && Number.isFinite(record["failures"]) ? record["failures"] : 0,
  };
}

function parseRegistrationAnswer(value: unknown): { id: string; created: boolean } {
  const record = objectRecord(value);
  if (typeof record["id"] !== "string" || record["id"] === "") throw new Error("The server did not answer with a subscription id");
  return { id: record["id"], created: record["created"] === true };
}

function parseRemoved(value: unknown): { removed: boolean } {
  return { removed: objectRecord(value)["removed"] === true };
}

function parseTestAnswer(value: unknown): { targets: number; problem: string | undefined; results: { outcome: string }[] } {
  const record = objectRecord(value);
  return {
    targets: typeof record["targets"] === "number" && Number.isFinite(record["targets"]) ? Math.max(0, Math.floor(record["targets"])) : 0,
    problem: typeof record["problem"] === "string" ? record["problem"] : undefined,
    results: Array.isArray(record["results"]) ? record["results"].map((entry) => ({ outcome: typeof objectRecord(entry)["outcome"] === "string" ? String(objectRecord(entry)["outcome"]) : "failed" })) : [],
  };
}

function objectRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}
