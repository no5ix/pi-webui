import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, readdirSync, existsSync, writeFileSync, statSync, mkdirSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_VAPID_SUBJECT, defaultVapidKeyFilePath, effectiveVapidSubject, isReachableMailAddress, resolveVapidKeys } from "./vapidKeys.js";
import { base64UrlDecode, generateVapidKeyPair, isVapidPrivateKey } from "./webPushCrypto.js";
import { projectScopeName } from "./sessionNotices.js";
import { answered, present } from "./notifications.testSupport.js";
import { isRecord } from "../../../shared/unknownValues.js";

let directory = "";
let filePath = "";

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "pi-web-vapid-"));
  filePath = join(directory, "push", "vapid.json");
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe("resolveVapidKeys", () => {
  it("uses the keys the config carries, and writes no file", async () => {
    const configured = generateVapidKeyPair();
    const loaded = await resolveVapidKeys({ publicKey: configured.publicKey, privateKey: JSON.stringify(configured.privateKey) }, filePath);
    expect(loaded).toMatchObject({ source: "config", problem: undefined });
    expect(loaded.keys?.publicKey).toBe(configured.publicKey);
    expect(existsSync(filePath)).toBe(false);
  });

  it("generates a P-256 pair when the config has none, and keeps it for the next start", async () => {
    const first = await resolveVapidKeys({}, filePath);
    expect(first.source).toBe("generated");
    expect(first.problem).toBeUndefined();
    const generated = present(first.keys, "the generated pair");
    expect(base64UrlDecode(generated.publicKey)?.length).toBe(65);
    expect(isVapidPrivateKey(generated.privateKey)).toBe(true);
    const written = answered(JSON.parse(readFileSync(filePath, "utf8")), "the stored key file");
    expect(written["publicKey"]).toBe(generated.publicKey);

    const second = await resolveVapidKeys({}, filePath);
    expect(second.keys).toEqual(generated);
    // The file's shape is the contract between one start and the next: the private half is a P-256 JWK
    // beside the public point. A start that cannot read it mints a new identity, and every registered
    // device quietly stops being reachable.
    const onDisk = answered(JSON.parse(readFileSync(filePath, "utf8")), "the stored key file");
    expect(onDisk["publicKey"]).toBe(generated.publicKey);
    expect(onDisk["privateKey"]).toMatchObject({ kty: "EC", crv: "P-256" });
  });

  it("writes the private half owner-only, because it is the identity every push service accepts", async () => {
    await resolveVapidKeys({}, filePath);
    expect(statSync(filePath).mode & 0o777).toBe(0o600);
  });

  it("says so when the generated pair cannot be stored, instead of pretending it is durable", async () => {
    const blocked = join(directory, "blocked");
    writeFileSync(blocked, "not a directory");
    const loaded = await resolveVapidKeys({}, join(blocked, "vapid.json"));
    expect(loaded.keys).toBeDefined();
    expect(loaded.problem).toContain("restarts");
  });

  it("accepts a PEM private key, the form openssl and the services' own generators write", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const exported: unknown = publicKey.export({ format: "jwk" });
    if (!isRecord(exported) || typeof exported["x"] !== "string" || typeof exported["y"] !== "string") throw new Error("the generated test key is not a P-256 JWK");
    const publicPoint = Buffer.concat([
      Buffer.from(new Uint8Array([4])),
      Buffer.from(exported["x"], "base64url"),
      Buffer.from(exported["y"], "base64url"),
    ]).toString("base64url");
    const loaded = await resolveVapidKeys({ publicKey: publicPoint, privateKey: pem }, filePath);
    expect(loaded.source).toBe("config");
    expect(loaded.keys?.publicKey).toBe(publicPoint);
    expect(isVapidPrivateKey(present(loaded.keys, "the configured pair").privateKey)).toBe(true);
  });

  it("refuses a configured pair that is half-configured, in both directions", async () => {
    const publicOnly = await resolveVapidKeys({ publicKey: "BKdf-public" }, filePath);
    expect(publicOnly.keys).toBeUndefined();
    expect(publicOnly.problem).toContain("vapidPublicKey");

    const privateOnly = await resolveVapidKeys({ privateKey: JSON.stringify({ kty: "EC", crv: "P-256", x: "x", y: "y", d: "d" }) }, filePath);
    expect(privateOnly.keys).toBeUndefined();
    expect(privateOnly.problem).toContain("vapidPrivateKey");
  });

  it("refuses a configured private key that is not a P-256 key, and says so", async () => {
    const loaded = await resolveVapidKeys({ publicKey: "BKdf-public", privateKey: "ssh-rsa AAAA" }, filePath);
    expect(loaded.keys).toBeUndefined();
    expect(loaded.problem).toContain("P-256");
  });

  it("keeps a key file it cannot read, mints a new identity, and says every device has to register again", async () => {
    mkdirSync(join(directory, "push"), { recursive: true });
    writeFileSync(filePath, "half-written by a kill");
    const answer = await resolveVapidKeys({}, filePath);
    expect(answer.keys).toBeDefined();
    expect(answer.source).toBe("generated");
    // The old file is the operator's way back, and the rotation is said out loud: a daemon that
    // reported a healthy push service here would leave every registered device unreachable.
    expect(answer.problem).toContain("register again");
    const kept = readdirSync(join(directory, "push")).filter((name) => name.startsWith("vapid.json.unreadable-"));
    expect(kept).toHaveLength(1);
    expect(readFileSync(join(directory, "push", present(kept[0], "the preserved key file")), "utf8")).toBe("half-written by a kill");
    expect((await resolveVapidKeys({}, filePath)).keys).toEqual(answer.keys);
  });

  it("is total about a file it cannot read, and a file that is not a key pair", async () => {
    mkdirSync(join(directory, "push"), { recursive: true });
    writeFileSync(filePath, "not json");
    expect((await resolveVapidKeys({}, filePath)).source).toBe("generated");

    writeFileSync(filePath, JSON.stringify({ publicKey: "nope" }));
    expect((await resolveVapidKeys({}, filePath)).keys).toBeDefined();

    writeFileSync(filePath, JSON.stringify({ publicKey: "nope", privateKey: { kty: "oct", k: "secret" } }));
    // A stored file that holds no usable pair is a start with no key: the daemon mints one and says
    // so through `source`, because the devices registered under the old identity need to be told.
    const replaced = await resolveVapidKeys({}, filePath);
    expect(replaced.source).toBe("generated");
    expect(replaced.keys).toBeDefined();

    // A configured pair that does not match its public half is the case with no keys at all.
    const mismatched = await resolveVapidKeys({ publicKey: "nope", privateKey: JSON.stringify(generateVapidKeyPair().privateKey) }, filePath);
    expect(mismatched.keys).toBeUndefined();
    expect(mismatched.problem).toContain("P-256");
  });

  it("lives under the data directory, beside the daemon's other private state", () => {
    const env: NodeJS.ProcessEnv = { PI_WEB_DATA_DIR: join(directory, "data") };
    const path = defaultVapidKeyFilePath(env, directory);
    expect(path).toBe(join(directory, "data", "push", "vapid.json"));
  });
});

describe("effectiveVapidSubject", () => {
  it("keeps a contact the push services accept, and defaults to one that invents no domain", () => {
    expect(effectiveVapidSubject("mailto:reader@example.com")).toBe("mailto:reader@example.com");
    expect(effectiveVapidSubject("https://example.com/contact")).toBe("https://example.com/contact");
    expect(effectiveVapidSubject("")).toBe(DEFAULT_VAPID_SUBJECT);
    expect(effectiveVapidSubject(undefined)).toBe(DEFAULT_VAPID_SUBJECT);
  });

  it("turns a bare address into the mailto URL a push service expects", () => {
    expect(effectiveVapidSubject("reader@example.com")).toBe("mailto:reader@example.com");
  });

  it("refuses to send a contact that is not a contact", () => {
    expect(effectiveVapidSubject("Reader <reader@example.com>")).toBe(DEFAULT_VAPID_SUBJECT);
  });

  it("replaces the contacts Apple's push service answers 403 BadJwtToken for", () => {
    // Measured against https://web.push.apple.com: a `mailto:pi-web@localhost` assertion is refused as
    // a bad token, and the same request with `mailto:pi-web@example.com` gets through to the token check.
    expect(effectiveVapidSubject("mailto:pi-web@localhost")).toBe(DEFAULT_VAPID_SUBJECT);
    expect(effectiveVapidSubject("mailto:pi-web@localhost.local")).toBe(DEFAULT_VAPID_SUBJECT);
    expect(effectiveVapidSubject("pi-web@localhost")).toBe(DEFAULT_VAPID_SUBJECT);
    expect(effectiveVapidSubject("pi-web@box")).toBe(DEFAULT_VAPID_SUBJECT);
    expect(effectiveVapidSubject("mailto:pi-web@127.0.0.1")).toBe(DEFAULT_VAPID_SUBJECT);
    expect(effectiveVapidSubject("mailto:pi-web@example.com")).toBe("mailto:pi-web@example.com");
  });

  it("says what a mail address must look like for a push service to treat it as a contact", () => {
    expect(isReachableMailAddress("reader@example.com")).toBe(true);
    expect(isReachableMailAddress("reader+pi@sub.example.co.uk")).toBe(true);
    expect(isReachableMailAddress("reader@localhost")).toBe(false);
    expect(isReachableMailAddress("reader@localhost.local")).toBe(false);
    expect(isReachableMailAddress("reader@127.0.0.1")).toBe(false);
    expect(isReachableMailAddress("reader")).toBe(false);
    expect(isReachableMailAddress("Reader <reader@example.com>")).toBe(false);
  });
});

describe("projectScopeName", () => {
  const projects = [
    { name: "app", path: "/srv/app" },
    { name: "nested", path: "/srv/app/nested" },
    { name: "other", path: "/other" },
  ];

  it("picks the deepest project folder a session's working directory sits in", () => {
    expect(projectScopeName(projects, "/srv/app/nested/work")).toBe("nested");
    expect(projectScopeName(projects, "/srv/app")).toBe("app");
    expect(projectScopeName(projects, "/srv/app/elsewhere")).toBe("app");
    expect(projectScopeName(projects, "/other/x")).toBe("other");
  });

  it("does not let a prefix that is not a path boundary claim a folder", () => {
    expect(projectScopeName(projects, "/srv/app-extension")).toBe("");
    expect(projectScopeName(projects, "/srv/application")).toBe("");
  });

  it("is total about the cases that would invent a project", () => {
    expect(projectScopeName(projects, "")).toBe("");
    expect(projectScopeName([], "/srv/app")).toBe("");
    expect(projectScopeName(["junk", null, 7, { path: "/srv" }], "/srv/app")).toBe("");
  });
});
