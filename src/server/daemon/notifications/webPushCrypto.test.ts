import { describe, expect, it } from "vitest";
import { createECDH } from "node:crypto";
import {
  base64UrlDecode,
  decryptPushPayload,
  encryptPushPayload,
  generateVapidKeyPair,
  isVapidPrivateKey,
  pushKeyMaterial,
  PUSH_PAYLOAD_LIMIT_BYTES,
  vapidJwt,
  vapidKeysFromConfig,
} from "./webPushCrypto.js";
import { answered, present } from "./notifications.testSupport.js";

describe("VAPID key pair", () => {
  it("is a P-256 pair whose public half is a raw 65-byte point", () => {
    const keys = generateVapidKeyPair();
    const publicBytes = base64UrlDecode(keys.publicKey);
    expect(publicBytes?.length).toBe(65);
    expect(publicBytes?.[0]).toBe(4);
    expect(isVapidPrivateKey(keys.privateKey)).toBe(true);
  });

  it("comes back from a config JSON key, and only when the public half matches it", () => {
    const keys = generateVapidKeyPair();
    const fromJson = vapidKeysFromConfig(keys.publicKey, JSON.stringify(keys.privateKey));
    expect(fromJson?.publicKey).toBe(keys.publicKey);
    expect(vapidKeysFromConfig(keys.publicKey, JSON.stringify({ kty: "oct", k: "abc" }))).toBeUndefined();
    const other = generateVapidKeyPair();
    expect(vapidKeysFromConfig(keys.publicKey, JSON.stringify(other.privateKey))).toBeUndefined();
    expect(vapidKeysFromConfig(keys.publicKey, "not json")).toBeUndefined();
  });
});

describe("vapidJwt", () => {
  it("audiences the push service's origin, not this application", () => {
    const keys = generateVapidKeyPair();
    const jwt = vapidJwt(keys, "https://push.example.com/send/key", "mailto:reader@example.com", 1_000, 60);
    const segments = present(jwt, "the signed VAPID token").split(".");
    const claims = answered(JSON.parse(Buffer.from(present(segments[1], "the claims segment"), "base64url").toString("utf8")), "the claims of the VAPID token");
    expect(claims["aud"]).toBe("https://push.example.com");
    expect(claims["exp"]).toBe(1_060);
    expect(claims["sub"]).toBe("mailto:reader@example.com");
  });

  it("signs a 64-byte ES256 signature, the form JWS requires", () => {
    const jwt = vapidJwt(generateVapidKeyPair(), "https://push.example.com/send/key", "https://example.com", 1_000);
    const signature = base64UrlDecode(present(present(jwt, "the signed VAPID token").split(".")[2], "the signature segment"));
    expect(signature?.length).toBe(64);
  });

  it("refuses an endpoint with no origin, so no assertion is minted for it", () => {
    expect(vapidJwt(generateVapidKeyPair(), "not-a-url", "mailto:a@b.c")).toBeUndefined();
  });
});

describe("Web Push payload encryption", () => {
  it("round-trips: the payload a device reads is the payload that was sent", () => {
    const device = createECDH("prime256v1");
    const publicDevice = device.generateKeys("base64url", "uncompressed");
    const authSecret = Buffer.concat([Buffer.from("device-auth-secret-0123456789"), Buffer.alloc(0)]).toString("base64url");
    const payload = JSON.stringify({ notification: { title: "pi-web finished", body: "Finished in 2m 14s.", tag: "session-1:task:1:completed" } });

    const encrypted = encryptPushPayload(publicDevice, authSecret, payload);
    expect(encrypted).toBeDefined();
    expect(encrypted?.contentEncoding).toBe("aes128gcm");

    const read = decryptPushPayload(device.getPrivateKey("base64url"), authSecret, present(encrypted, "the encrypted payload").body);
    expect(read).toBe(payload);
  });

  it("writes the fixed header the content coding defines: salt, record size, key length, public point", () => {
    const device = createECDH("prime256v1");
    const authSecret = present(base64UrlDecode("AAAAAAAAAAAAAAAAAAAAAA"), "the decoded auth secret").toString("base64url");
    const encrypted = encryptPushPayload(device.generateKeys("base64url", "uncompressed"), authSecret, "hi");
    const body = present(encrypted, "the encrypted payload").body;
    expect(body.readUInt32BE(16)).toBe(4096);
    expect(body.readUInt8(20)).toBe(65);
    expect(body.subarray(21, 21 + 65).length).toBe(65);
    expect(body.length).toBeGreaterThan(21 + 65 + 16);
  });

  it("refuses a key that is not a P-256 point and a secret that is too short", () => {
    const device = createECDH("prime256v1");
    const goodKey = device.generateKeys("base64url", "uncompressed");
    const secret = "AAAAAAAAAAAAAAAAAAAAAA";
    expect(encryptPushPayload("not-a-key", secret, "hi")).toBeUndefined();
    expect(encryptPushPayload(Buffer.alloc(30).toString("base64url"), secret, "hi")).toBeUndefined();
    expect(encryptPushPayload(goodKey, "short", "hi")).toBeUndefined();
  });

  it("refuses a payload that cannot fit the record the services accept", () => {
    const device = createECDH("prime256v1");
    const tooBig = "x".repeat(PUSH_PAYLOAD_LIMIT_BYTES + 500);
    expect(encryptPushPayload(device.generateKeys("base64url", "uncompressed"), "AAAAAAAAAAAAAAAAAAAAAA", tooBig)).toBeUndefined();
  });

  it("cannot be read by a device that is not the one addressed", () => {
    const senderKey = createECDH("prime256v1").generateKeys("base64url", "uncompressed");
    const secret = "AAAAAAAAAAAAAAAAAAAAAA";
    const encrypted = encryptPushPayload(senderKey, secret, "for the intended device");
    const stranger = createECDH("prime256v1");
    stranger.generateKeys("hex", "uncompressed");
    expect(decryptPushPayload(stranger.getPrivateKey("base64url"), secret, present(encrypted, "the encrypted payload").body)).toBeUndefined();
  });
});

/**
 * RFC 8291 Appendix A, published verbatim.
 *
 * A round-trip through this module alone proves nothing about the wire: a derivation that no browser
 * can reproduce encrypts and decrypts perfectly with itself, the push service accepts the bytes, and
 * the notice never arrives. These are the values the specification publishes for the same steps, so
 * the sequence is pinned to the browser and not to this file.
 */
const RFC = {
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  authSecret: "BTBZMqHH6r4Tts7J_aSIgg",
  ecdhSecret: "kyrL1jIIOHEzg3sM2ZWRHDRB62YACZhhSlknJ672kSs",
  ikm: "S4lYMb_L0FxCeq0WhDx813KgSYqU26kOyzWUdsXYyrg",
  cek: "oIhVW04MRdy2XN9CiKLxTg",
  nonce: "4h_95klXJ5E_qnoN",
  header: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  ciphertext: "8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ",
  plaintext: "When I grow up, I want to be a watermelon",
};

const bytes = (value: string) => Buffer.from(value, "base64url");

describe("the RFC 8291 worked example", () => {
  it("derives the key material the RFC publishes", () => {
    const material = pushKeyMaterial({ sharedSecret: bytes(RFC.ecdhSecret), authSecret: bytes(RFC.authSecret), uaPublic: bytes(RFC.uaPublic), asPublic: bytes(RFC.asPublic), salt: bytes(RFC.salt) });
    expect(material.ikm.toString("base64url")).toBe(RFC.ikm);
    expect(material.cek.toString("base64url")).toBe(RFC.cek);
    expect(material.nonce.toString("base64url")).toBe(RFC.nonce);
  });

  it("encrypts the example to the bytes the RFC publishes, and reads them back", () => {
    const encrypted = encryptPushPayload(RFC.uaPublic, RFC.authSecret, RFC.plaintext, {
      randomBytes: () => bytes(RFC.salt),
      ephemeralPrivateKey: RFC.asPrivate,
    });
    const body = encrypted?.body;
    expect(body).toBeDefined();
    expect(body).toStrictEqual(Buffer.concat([bytes(RFC.header), bytes(RFC.ciphertext)]));
    expect(decryptPushPayload(RFC.uaPrivate, RFC.authSecret, body ?? Buffer.alloc(0))).toBe(RFC.plaintext);
  });
});
