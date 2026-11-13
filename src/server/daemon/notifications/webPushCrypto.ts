import { isRecord } from "../../../shared/unknownValues.js";
import { createCipheriv, createDecipheriv, createECDH, createPrivateKey, generateKeyPairSync, hkdfSync, randomBytes, sign as signEcdsa } from "node:crypto";

/**
 * Web Push's two pieces of cryptography, on Node's own crypto and nothing else.
 *
 * A push message is an encrypted body sent to a third party's push service, so the payload is
 * encrypted to the device's own key (RFC 8291, the `aes128gcm` content coding) and the request is
 * authorised with a VAPID JWT the service checks against the application's key (RFC 8292). Both are
 * small, specified, and need only ES256, ECDH P-256, HKDF-SHA-256 and AES-128-GCM, all of which Node
 * ships; the alternative was a dependency that has not been released since 2021 and pulls an
 * encryption stack of its own into a server that sends notifications.
 *
 * Two numbers the wire format is built from and a reader should be able to find here: the 20-byte
 * fixed header (16-byte salt, 4-byte record size, 1-byte key length, then the ephemeral public key)
 * and the single `0x02` octet that ends the plaintext, which is what tells a receiver where the
 * message stops inside its padding.
 */

/**
 * An EC P-256 JSON Web Key.
 *
 * Declared here rather than used from the DOM's `JsonWebKey`: Node's crypto takes a key with an
 * index signature, the DOM's does not, and the two are not the same type in a project with
 * `exactOptionalPropertyTypes` on.
 */
export interface EcJsonWebKey {
  kty: "EC";
  crv: "P-256";
  d: string;
  x: string;
  y: string;
  [key: string]: unknown;
}

/** A VAPID key pair: the public key the browser sends to its push service, the private key that signs. */
export interface VapidKeyPair {
  /** The raw uncompressed P-256 public point, base64url. This is what a subscription needs. */
  readonly publicKey: string;
  /** The private key as an EC P-256 JSON Web Key. It never leaves the server that generated it. */
  readonly privateKey: EcJsonWebKey;
}

const P256_COORDINATE_BYTES = 32;
const UNCOMPRESSED_POINT_BYTES = 65;
const CEK_INFO = Buffer.concat([Buffer.from("Content-Encoding: aes128gcm", "utf8"), Buffer.from([0])]);
const NONCE_INFO = Buffer.concat([Buffer.from("Content-Encoding: nonce", "utf8"), Buffer.from([0])]);
/** The record size advertised in the header. Browsers cap a push payload at 4 KB, most of them exactly. */
export const PUSH_RECORD_SIZE_BYTES = 4096;
/** The payload this server will put inside a 4 KB record, with the header, salt and tag. */
export const PUSH_PAYLOAD_LIMIT_BYTES = 3800;
const SALT_BYTES = 16;

export function generateVapidKeyPair(): VapidKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicJwk: unknown = publicKey.export({ format: "jwk" });
  const privateJwk: unknown = privateKey.export({ format: "jwk" });
  if (!isPublicP256Jwk(publicJwk) || !isVapidPrivateKey(privateJwk)) throw new Error("Generated VAPID key is not an EC P-256 key");
  const point = base64Url(pointBytes(publicJwk.x, publicJwk.y));
  if (point === undefined) throw new Error("Generated VAPID public key carries no P-256 point");
  return { publicKey: point, privateKey: privateJwk };
}

/** The public half: an EC P-256 JWK with the point this server puts in a subscription's VAPID field. */
function isPublicP256Jwk(value: unknown): value is { x: string; y: string } {
  return isRecord(value) && value["kty"] === "EC" && value["crv"] === "P-256" && typeof value["x"] === "string" && typeof value["y"] === "string";
}

/** Whether a stored private key is the EC P-256 JWK this module can sign with. */
export function isVapidPrivateKey(value: unknown): value is EcJsonWebKey {
  if (!isRecord(value)) return false;
  return value["kty"] === "EC" && value["crv"] === "P-256" && typeof value["d"] === "string" && typeof value["x"] === "string" && typeof value["y"] === "string";
}

export function vapidKeysFromConfig(publicKey: string, privateKeyJson: string): VapidKeyPair | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(privateKeyJson);
  } catch {
    return undefined;
  }
  if (!isVapidPrivateKey(parsed)) return undefined;
  const point = base64Url(pointBytes(parsed.x, parsed.y));
  if (point === undefined || point !== publicKey.trim()) return undefined;
  return { publicKey: publicKey.trim(), privateKey: parsed };
}

/**
 * The VAPID assertion for one request.
 *
 * The audience is the push service's origin, not PI WEB's: the service is the party that checks the
 * claim, and a JWT minted for the application's own host is refused by it. `exp` is capped at
 * twenty-four hours, the ceiling RFC 8292 sets.
 */
export function vapidJwt(keys: VapidKeyPair, endpoint: string, subject: string, nowSeconds = Math.floor(Date.now() / 1000), lifetimeSeconds = 7200): string | undefined {
  const audience = endpointOrigin(endpoint);
  if (audience === undefined) return undefined;
  const header = base64UrlText(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const claims = base64UrlText(JSON.stringify({ aud: audience, exp: nowSeconds + Math.min(lifetimeSeconds, 86_400), sub: subject }));
  const signingInput = `${header}.${claims}`;
  const privateKey = createPrivateKey({ key: keys.privateKey, format: "jwk" });  // `ieee-p1363` is the fixed 64-byte r||s form JWS wants; DER would have to be unpadded by hand.
  const signature = base64Url(signEcdsa("sha256", Buffer.from(signingInput, "utf8"), { key: privateKey, dsaEncoding: "ieee-p1363" }));
  if (signature === undefined) return undefined;
  return `${signingInput}.${signature}`;
}

function endpointOrigin(endpoint: string): string | undefined {
  try {
    return new URL(endpoint).origin;
  } catch {
    return undefined;
  }
}

/**
 * The RFC 8291 section 3.4 key ladder, in one place, for both directions.
 *
 * The order is the specification's, not a choice: the ECDH secret is salted with the subscription's
 * auth secret to make the input keying material, and that is salted with the header's random salt to
 * make the content key and the nonce. Swap the two salts, pass the auth secret as an info string, or
 * leave it out, and every real browser fails the AEAD tag and shows nothing while the push service
 * accepts the bytes. The tests replay the RFC's worked example through here for that reason.
 */
export function pushKeyMaterial(input: { sharedSecret: Buffer; authSecret: Buffer; uaPublic: Buffer; asPublic: Buffer; salt: Buffer }): { ikm: Buffer; cek: Buffer; nonce: Buffer } {
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\u0000", "utf8"), input.uaPublic, input.asPublic]);
  const ikm = Buffer.from(hkdfSync("sha256", input.sharedSecret, input.authSecret, keyInfo, 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, input.salt, CEK_INFO, 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, input.salt, NONCE_INFO, 12));
  return { ikm, cek, nonce };
}

/**
 * A push body, encrypted to one device, in the `aes128gcm` content coding.
 *
 * RFC 8291 section 3.4, in the order the specification gives: the ECDH secret is combined with the
 * subscription's auth secret (the auth secret is the salt of that HKDF), and the result feeds the
 * RFC 8188 content-key derivation keyed by the header's random salt. Both salts matter: the auth
 * secret is what makes a push service that stored the bytes unable to read them, and a browser that
 * derives these keys any other way fails the AEAD tag and shows nothing.
 *
 * The ephemeral key pair is the server's per-message key. `keys.ephemeralPrivateKey` pins it, and is
 * how the RFC's own worked example is replayed against this code.
 */
export function encryptPushPayload(subscriptionPublicKey: string, subscriptionAuthToken: string, payload: string, keys: {
  randomBytes(size: number): Buffer;
  ephemeralPrivateKey?: string;
} = { randomBytes: (size) => randomBytes(size) }): { body: Buffer; contentEncoding: "aes128gcm" } | undefined {
  const uaPublic = base64UrlDecode(subscriptionPublicKey);
  const authSecret = base64UrlDecode(subscriptionAuthToken);
  if (uaPublic?.length !== UNCOMPRESSED_POINT_BYTES) return undefined;
  if (authSecret === undefined || authSecret.length < 16) return undefined;
  const salt = keys.randomBytes(SALT_BYTES);
  const ephemeral = createECDH("prime256v1");
  const pinned = base64UrlDecode(keys.ephemeralPrivateKey ?? "");
  if (keys.ephemeralPrivateKey !== undefined && pinned?.length !== 32) return undefined;
  if (pinned !== undefined) ephemeral.setPrivateKey(pinned);
  // Node's `generateKeys` makes a fresh pair even when a private key was just set, so a pinned key
  // reads its public half with `getPublicKey` and the pair stays the one that was asked for.
  const asPublic = pinned === undefined
    ? Buffer.from(ephemeral.generateKeys("hex", "uncompressed"), "hex")
    : Buffer.from(ephemeral.getPublicKey("hex", "uncompressed"), "hex");
  const shared = ephemeral.computeSecret(uaPublic);

  const { cek, nonce } = pushKeyMaterial({ sharedSecret: shared, authSecret, uaPublic, asPublic, salt });

  const plaintext = Buffer.concat([Buffer.from(payload, "utf8"), Buffer.from([2])]);
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  cipher.setAAD(Buffer.alloc(0));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);

  const headerSize = SALT_BYTES + 4 + 1 + asPublic.length;
  if (headerSize + ciphertext.length > PUSH_RECORD_SIZE_BYTES) return undefined;
  const recordSize = Buffer.alloc(4);
  recordSize.writeUInt32BE(PUSH_RECORD_SIZE_BYTES);
  return { body: Buffer.concat([salt, recordSize, Buffer.from([asPublic.length]), asPublic, ciphertext]), contentEncoding: "aes128gcm" };
}

/**
 * The same derivation, run backwards.
 *
 * A receiver (the browser's service worker, in production; a test, here) knows the salt, the record
 * header and its own key pair, and reads the payload out of a push event. Keeping the inverse next to
 * the forward direction is what makes a wire-format mistake a failing test rather than a device that
 * shows nothing.
 */
export function decryptPushPayload(subscriptionPrivateKey: string, subscriptionAuthToken: string, body: Buffer): string | undefined {
  const uaPrivate = base64UrlDecode(subscriptionPrivateKey);
  const authSecret = base64UrlDecode(subscriptionAuthToken);
  if (uaPrivate === undefined || authSecret === undefined) return undefined;
  if (body.length < SALT_BYTES + 4 + 1) return undefined;
  const salt = body.subarray(0, SALT_BYTES);
  const keyLength = body.readUInt8(SALT_BYTES + 4);
  const asPublic = body.subarray(SALT_BYTES + 5, SALT_BYTES + 5 + keyLength);
  const ciphertext = body.subarray(SALT_BYTES + 5 + keyLength);
  if (asPublic.length !== UNCOMPRESSED_POINT_BYTES || ciphertext.length < 16) return undefined;
  const uaPublic = publicPointOf(uaPrivate);
  if (uaPublic === undefined) return undefined;
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(uaPrivate);
  const shared = ecdh.computeSecret(asPublic);
  const { cek, nonce } = pushKeyMaterial({ sharedSecret: shared, authSecret, uaPublic, asPublic, salt });
  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAAD(Buffer.alloc(0));
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
  let plain: Buffer;
  try {
    plain = Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - 16)), decipher.final()]);
  } catch {
    // A payload addressed to another device fails the tag. That is the answer: no ciphertext.
    return undefined;
  }
  const delimiter = plain.lastIndexOf(2);
  if (delimiter < 0) return undefined;
  return plain.subarray(0, delimiter).toString("utf8");
}

function publicPointOf(privateKey: Buffer): Buffer | undefined {
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(privateKey);
  return Buffer.from(ecdh.getPublicKey("hex", "uncompressed"), "hex");
}

export function base64Url(value: Buffer | string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const bytes = typeof value === "string" ? Buffer.from(value, "utf8") : value;
  return bytes.toString("base64url");
}

function base64UrlText(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

export function base64UrlDecode(value: string): Buffer | undefined {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/u.test(value)) return undefined;
  const decoded = Buffer.from(value, "base64url");
  return decoded.length === 0 ? undefined : decoded;
}

function pointBytes(x: string | undefined, y: string | undefined): Buffer | undefined {
  const xb = base64UrlDecode(x ?? "");
  const yb = base64UrlDecode(y ?? "");
  if (xb === undefined || yb === undefined) return undefined;
  if (xb.length !== P256_COORDINATE_BYTES || yb.length !== P256_COORDINATE_BYTES) return undefined;
  return Buffer.concat([Buffer.from([4]), padCoordinate(xb), padCoordinate(yb)]);
}

function padCoordinate(value: Buffer): Buffer {
  if (value.length === P256_COORDINATE_BYTES) return value;
  if (value.length > P256_COORDINATE_BYTES) return value.subarray(value.length - P256_COORDINATE_BYTES);
  return Buffer.concat([Buffer.alloc(P256_COORDINATE_BYTES - value.length), value]);
}
