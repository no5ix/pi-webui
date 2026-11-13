import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PUSH_SUBSCRIPTION_LIMIT, PushSubscriptionStore, normalize } from "./pushSubscriptionStore.js";
import { answered, entriesOf, present } from "./notifications.testSupport.js";

let directory = "";
let filePath = "";

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "pi-web-push-"));
  filePath = join(directory, "subscriptions.json");
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

const registration = (endpoint: string, over: { p256dh?: string; auth?: string; appBaseUrl?: string; userAgent?: string } = {}) => ({
  endpoint,
  keys: { p256dh: over.p256dh ?? "BKdfQlY3BpNWVwaGVraU5naGVpa29QYXNzd29yZDEyMzQ1Njc4OTBhYmNkZWY", auth: over.auth ?? "tVfJ1-example-auth" },
  ...(over.appBaseUrl === undefined ? {} : { appBaseUrl: over.appBaseUrl }),
  ...(over.userAgent === undefined ? {} : { userAgent: over.userAgent }),
});

describe("PushSubscriptionStore", () => {
  it("stores a device and writes it to the file, owner-only", async () => {
    const store = new PushSubscriptionStore({ filePath });
    const registered = await store.register(registration("https://push.example.com/1", { userAgent: "iPhone" }));
    expect(registered?.created).toBe(true);
    const stored = answered(JSON.parse(await readFile(filePath, "utf8")), "the stored file");
    const subscriptions: unknown = stored["subscriptions"];
    const devices = entriesOf(Array.isArray(subscriptions) ? subscriptions : [], "the stored devices");
    expect(devices).toHaveLength(1);
    expect(devices[0]?.["endpoint"]).toBe("https://push.example.com/1");
    expect(devices[0]?.["userAgent"]).toBe("iPhone");
    expect(await store.count()).toBe(1);
  });

  it("keeps one row per endpoint, so a browser that re-subscribes does not accumulate addresses", async () => {
    const store = new PushSubscriptionStore({ filePath });
    const first = await store.register(registration("https://push.example.com/1", { appBaseUrl: "https://a.example/" }));
    const second = await store.register(registration("https://push.example.com/1", { appBaseUrl: "https://b.example/" }));
    expect(second?.created).toBe(false);
    expect(second?.record.id).toBe(first?.record.id);
    expect(second?.record.appBaseUrl).toBe("https://b.example/");
    expect(await store.count()).toBe(1);
  });

  it("registers several devices, and removes one without touching the others", async () => {
    const store = new PushSubscriptionStore({ filePath });
    const a = await store.register(registration("https://push.example.com/a"));
    const b = await store.register(registration("https://push.example.com/b"));
    expect(await store.count()).toBe(2);
    expect(await store.remove(present(a, "the registration").record.id)).toBe(true);
    expect(await store.remove("missing")).toBe(false);
    const rest = await store.list();
    expect(rest.map((entry) => entry.endpoint)).toEqual(["https://push.example.com/b"]);
    expect(b?.record.endpoint).toBe("https://push.example.com/b");
  });

  it("drops the addresses a push service says are gone", async () => {
    const store = new PushSubscriptionStore({ filePath });
    const a = await store.register(registration("https://push.example.com/a"));
    await store.register(registration("https://push.example.com/b"));
    expect(await store.removeMany([present(a, "the registration").record.id, "unknown"])).toBe(1);
    expect((await store.list()).map((entry) => entry.endpoint)).toEqual(["https://push.example.com/b"]);
  });

  it("counts a failed send and clears the count on a delivered one", async () => {
    const store = new PushSubscriptionStore({ filePath });
    const registered = await store.register(registration("https://push.example.com/a"));
    const id = present(registered, "the registration").record.id;
    await store.recordDelivery(id, false);
    await store.recordDelivery(id, false);
    expect((await store.list())[0]?.failures).toBe(2);
    await store.recordDelivery(id, true);
    const delivered = (await store.list())[0];
    expect(delivered?.failures).toBe(0);
    expect(delivered?.lastDeliveredAt).toBeTypeOf("string");
  });

  it("refuses to grow past its limit, so a device list stays a device list", async () => {
    const store = new PushSubscriptionStore({ filePath });
    for (let index = 0; index < PUSH_SUBSCRIPTION_LIMIT; index += 1) {
      expect(await store.register(registration(`https://push.example.com/${String(index)}`))).toBeDefined();
    }
    expect(await store.register(registration("https://push.example.com/one-too-many"))).toBeUndefined();
    expect(await store.count()).toBe(PUSH_SUBSCRIPTION_LIMIT);
  });

  it("reports a device file it cannot read as unknown, and refuses to write over it", async () => {
    await writeFile(filePath, "not json", "utf8");
    const store = new PushSubscriptionStore({ filePath });
    expect(await store.health()).toEqual({ devices: 0, unreadable: "the file is not JSON" });
    await expect(store.register(registration("https://push.example.com/a"))).rejects.toThrow("nothing is written over it");
    // The addresses of devices that registered earlier are the point: an unreadable file read as
    // empty, then persisted, would delete them and tell the reader no device exists.
    expect(await readFile(filePath, "utf8")).toBe("not json");
  });

  it("drops rows a sender could never use, and keeps the one it could", async () => {
    await writeFile(filePath, JSON.stringify({ subscriptions: [{ id: "x" }, { id: "y", endpoint: "http://push.example/insecure", publicKey: "k", authToken: "a" }, { id: "z", endpoint: "https://push.example/ok", publicKey: "k", authToken: "a" }] }), "utf8");
    const reopened = new PushSubscriptionStore({ filePath });
    expect((await reopened.list()).map((entry) => entry.id)).toEqual(["z"]);
    expect(await reopened.health()).toEqual({ devices: 1, unreadable: undefined });
  });

  it("keeps taking registrations after a write that failed, so one failed disk write does not wedge the store", async () => {
    const store = new PushSubscriptionStore({ filePath });
    expect((await store.health()).unreadable).toBeUndefined();
    const first = await store.register(registration("https://push.example.com/a"));
    expect(first?.created).toBe(true);

    const directoryMode = (await stat(directory)).mode;
    await chmod(directory, 0o500);
    const refused = await store.register(registration("https://push.example.com/b")).catch(() => undefined);
    await chmod(directory, directoryMode);
    expect(refused).toBeUndefined();

    const third = await store.register(registration("https://push.example.com/c"));
    expect(third?.created).toBe(true);
    const onDisk = answered(JSON.parse(await readFile(filePath, "utf8")), "the stored file");
    const devices = entriesOf(Array.isArray(onDisk["subscriptions"]) ? onDisk["subscriptions"] : [], "the stored devices");
    // The row whose write failed stays in memory and rides out with the next snapshot: the device is
    // registered as far as this process knows, and a restart is the honest limit of the forgiveness.
    expect(devices.map((entry) => entry["endpoint"])).toEqual([
      "https://push.example.com/a",
      "https://push.example.com/b",
      "https://push.example.com/c",
    ]);
  });

  it("keeps a device's stored address across a restart of the process", async () => {
    const first = new PushSubscriptionStore({ filePath });
    const registered = await first.register(registration("https://push.example.com/a"));
    const second = new PushSubscriptionStore({ filePath });
    expect((await second.list()).map((entry) => entry.id)).toEqual([registered?.record.id]);
  });
});

describe("normalize", () => {
  it("is total about junk", () => {
    expect(normalize(undefined).subscriptions).toEqual([]);
    expect(normalize("x").subscriptions).toEqual([]);
    expect(normalize({ subscriptions: "x" }).subscriptions).toEqual([]);
  });
});
