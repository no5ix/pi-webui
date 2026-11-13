import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createPrivateKey } from "node:crypto";
import { piWebDataDir } from "../../../config.js";
import { generateVapidKeyPair, isVapidPrivateKey, vapidKeysFromConfig, type VapidKeyPair } from "./webPushCrypto.js";
import { isRecord } from "../../../shared/unknownValues.js";

/**
 * Where the server's VAPID key pair comes from.
 *
 * A VAPID key pair is what lets a push service accept a message from this application: the public
 * key goes to the browser when it subscribes, the private key signs every request. A deployment with
 * no keys cannot send a push at all, so a daemon that found none generates one and keeps it in its
 * own data directory, readable only by its owner. That is the difference between a notification
 * feature a reader has to research and one that works on the first HTTPS start; a deployment that
 * wants to own its key pair (so a phone's subscriptions survive a reinstall of PI WEB) sets
 * `push.vapidPublicKey` and `push.vapidPrivateKey` in its config and the generated file is not used.
 *
 * The private key never goes in the repository, in a project file, or in the answer the settings
 * page reads: the config view the browser gets has it removed, and the generated file lives beside
 * the daemon's other private state.
 */

export interface VapidKeyConfig {
  /** The public key the browser sends to its push manager. */
  publicKey?: string;
  /** The signing key: an EC P-256 JWK as JSON, or a PEM private key. */
  privateKey?: string;
}

export type VapidKeySource = "config" | "generated" | "none";

export interface ResolvedVapidKeys {
  readonly keys: VapidKeyPair | undefined;
  readonly source: VapidKeySource;
  /** Why there is no key pair, in the words the settings panel shows. */
  readonly problem: string | undefined;
}

export function defaultVapidKeyFilePath(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): string {
  return join(piWebDataDir(env, cwd), "push", "vapid.json");
}

/**
 * The key pair to send with, in the order a deployment states its intent.
 *
 * Never throws and never logs a secret: a half-filled config (a public key with no private key) is
 * reported as the reason push is off, because a reader who set one key expects both to be in use.
 */
export async function resolveVapidKeys(config: VapidKeyConfig = {}, filePath = defaultVapidKeyFilePath()): Promise<ResolvedVapidKeys> {
  const publicKey = config.publicKey?.trim() ?? "";
  const privateKey = config.privateKey?.trim() ?? "";
  if (publicKey !== "" && privateKey !== "") {
    const keys = vapidKeysFromConfig(publicKey, privateKeyFromPem(privateKey) ?? privateKey);
    if (keys !== undefined) return { keys, source: "config", problem: undefined };
    return { keys: undefined, source: "none", problem: "The configured push keys do not form an EC P-256 key pair" };
  }
  if (publicKey !== "" || privateKey !== "") {
    return { keys: undefined, source: "none", problem: "Push needs both push.vapidPublicKey and push.vapidPrivateKey" };
  }  const stored = await readStoredKeys(filePath);
  if ("keys" in stored && stored.keys !== undefined) return { keys: stored.keys, source: "generated", problem: undefined };
  if ("unreadable" in stored) return await rotateUnreadableKeys(filePath, stored.unreadable);
  const generated = generateVapidKeyPair();
  const written = await writeStoredKeys(filePath, generated);
  return written
    ? { keys: generated, source: "generated", problem: undefined }
    : { keys: generated, source: "generated", problem: "The generated push key pair could not be stored, so it changes when the daemon restarts" };
}

/**
 * A key file that is there and cannot be read is moved aside before anything is written, so the
 * operator keeps the bytes the daemon could not parse, and a new identity is minted in its place.
 *
 * What is not allowed is a start that reports a healthy push service: the devices that registered
 * with the old key are unreachable from this start on, so the rotation is said in the panel that
 * shows the devices, and the file that was kept is named there.
 */
async function rotateUnreadableKeys(filePath: string, reason: string): Promise<ResolvedVapidKeys> {
  const kept = await preserveUnreadable(filePath);
  const generated = generateVapidKeyPair();
  const written = await writeStoredKeys(filePath, generated);
  const rotation = `The stored push key file could not be read (${reason})${kept === undefined ? "" : `, and was kept as ${kept}`}, so this PI WEB minted a new push identity. Every device that registered before has to register again.`;
  return { keys: generated, source: "generated", problem: written ? rotation : `${rotation} The new pair could not be stored, so it changes when the daemon restarts.` };
}

/** Move a file the daemon cannot use out of the way, so the next start can still find it. */
async function preserveUnreadable(filePath: string, keptAt = new Date()): Promise<string | undefined> {
  const kept = `${filePath}.unreadable-${String(keptAt.getTime())}`;
  try {
    await rename(filePath, kept);
    return kept;
  } catch {
    return undefined;
  }
}

/** A PEM private key becomes the JWK form this server signs with, so a key generated by any tool works. */
function privateKeyFromPem(value: string): string | undefined {
  if (!value.includes("-----BEGIN")) return undefined;
  try {
    const key = createPrivateKey({ key: value, format: "pem" });
    const jwk: unknown = key.export({ format: "jwk" });
    return isVapidPrivateKey(jwk) ? JSON.stringify(jwk) : undefined;
  } catch {
    return undefined;
  }
}

type StoredKeys = { keys: VapidKeyPair } | { keys: undefined } | { keys: undefined; unreadable: string };

async function readStoredKeys(filePath: string): Promise<StoredKeys> {
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch (error: unknown) {
    const code: unknown = error === null || typeof error !== "object" ? undefined : Reflect.get(error, "code");
    if (code === "ENOENT") return { keys: undefined };
    return { keys: undefined, unreadable: `the file could not be read: ${error instanceof Error ? error.message : String(error)}` };
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed)) return { keys: undefined, unreadable: "the file is not an object" };
    const publicKey = parsed["publicKey"];
    const privateKey = parsed["privateKey"];
    if (typeof publicKey !== "string") return { keys: undefined, unreadable: "the file carries no public key" };
    // `writeStoredKeys` writes the private half as a JSON Web Key object; an operator may have pasted
    // the JWK as a string, or a PEM block. All three arrive here, and the pair is checked against the
    // public half before it is used. A stored key that cannot be read is the expensive failure: the
    // next start mints an identity the push services have never seen, and every registered device
    // stops being reachable.
    const asJson = typeof privateKey === "string"
      ? privateKeyFromPem(privateKey) ?? privateKey
      : privateKey === undefined ? "" : JSON.stringify(privateKey);
    const pair = vapidKeysFromConfig(publicKey, asJson);
    return pair === undefined ? { keys: undefined, unreadable: "the file holds no P-256 pair that matches its public key" } : { keys: pair };
  } catch {
    return { keys: undefined, unreadable: "the file is not JSON" };
  }
}

/**
 * The key file is written beside itself and moved into place.
 *
 * A daemon killed halfway through `writeFile` would leave a half-written key file, and a key file
 * that cannot be read is the expensive failure this module exists to avoid: the next start has no
 * identity the push services know, and every registered device quietly stops being reachable.
 */
async function writeStoredKeys(filePath: string, keys: VapidKeyPair): Promise<boolean> {
  try {
    await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
    const body = `${JSON.stringify({ publicKey: keys.publicKey, privateKey: keys.privateKey }, null, 2)}\n`;
    const temporary = `${filePath}.tmp`;
    await writeFile(temporary, body, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * The `sub` claim of a VAPID assertion: a contact URL for the application, per RFC 8292.
 *
 * The default is the project's public URL rather than a local mail address, because Apple's push
 * service refuses a contact it does not consider real: measured against `web.push.apple.com`, a
 * `mailto:pi-web@localhost` assertion is answered `403 {"reason":"BadJwtToken"}` while the same
 * request with `mailto:pi-web@example.com` - or with an https URL - gets past the assertion to the
 * token check (`400 {"reason":"BadWebPushRequest"}`). A default that every iPhone and iPad refuses
 * is worse than a generic contact that every service takes, so a contact that will not be accepted is
 * replaced by the default and the swap is visible in the settings panel, which shows the subject in
 * use. A deployment that names a real contact keeps exactly what it asked for.
 */
export const DEFAULT_VAPID_SUBJECT = "https://github.com/Gang-of-Beads/pi-web";

export function effectiveVapidSubject(subject: string | undefined): string {
  const trimmed = (subject ?? "").trim();
  if (trimmed === "") return DEFAULT_VAPID_SUBJECT;
  if (/^https?:\/\//u.test(trimmed)) return trimmed;
  const address = trimmed.startsWith("mailto:") ? trimmed.slice("mailto:".length).trim() : trimmed;
  // A bare address becomes a mailto: URL; anything with the shape of a display name - a space, an
  // angle bracket - is not a contact a push service will take, and a contact that is refused on
  // every send is worse for a deployment than a generic one that is accepted.
  if (isReachableMailAddress(address)) return `mailto:${address}`;
  return DEFAULT_VAPID_SUBJECT;
}

/**
 * A mail address a push service will treat as a contact: a local part, a domain with a dot, and not
 * a machine name. `user@localhost` and `user@box` are the shapes Apple refuses, and an address with
 * no domain behind it identifies nothing to the service anyway.
 */
export function isReachableMailAddress(value: string): boolean {
  const match = /^([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+)$/u.exec(value);
  if (match === null) return false;
  const domain = match[2] ?? "";
  if (!domain.includes(".")) return false;
  const labels = domain.split(".");
  return !labels.includes("localhost") && !/^[0-9]+$/u.test(labels[labels.length - 1] ?? "");
}
