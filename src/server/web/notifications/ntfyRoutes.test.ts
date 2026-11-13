import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerNtfyRoutes } from "./ntfyRoutes.js";
import type { NtfyConfig } from "../../../shared/apiTypes.js";

const READY: NtfyConfig = { enabled: true, serverUrl: "https://ntfy.sh", topic: "reader-secret-topic", onCompleted: true };

function appServing(config: NtfyConfig | undefined, status = 200) {
  const posts: string[] = [];
  const fetchImpl: typeof fetch = (input: URL | RequestInfo): Promise<Response> => {
    posts.push(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    return Promise.resolve(new Response("", { status }));
  };
  const app = Fastify({ logger: false });
  registerNtfyRoutes(app, { readConfig: () => config, fetchImpl });
  return { app, posts };
}

describe("the ntfy status route", () => {
  it("says a configured channel is ready, without naming its topic", async () => {
    const { app } = appServing(READY);
    const response = await app.inject({ method: "GET", url: "/api/notifications/ntfy/status" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ enabled: true, ready: true, topicConfigured: true });
    expect(response.body).not.toContain("reader-secret-topic");
    await app.close();
  });

  it("says an unconfigured channel is not ready, and why", async () => {
    const { app } = appServing(undefined);
    const response = await app.inject({ method: "GET", url: "/api/notifications/ntfy/status" });
    expect(response.json()).toMatchObject({ enabled: false, ready: false, topicConfigured: false });
    expect(response.json<{ reason: string }>().reason).toBeTruthy();
    await app.close();
  });

  it("shows the switches a reader saved, with the topic replaced", async () => {
    const { app } = appServing({ ...READY, onFailed: false, onAskUser: true });
    const response = await app.inject({ method: "GET", url: "/api/notifications/ntfy/status" });
    expect(response.json<{ config: NtfyConfig }>().config).toMatchObject({ onCompleted: true, onFailed: false, onAskUser: true });
    expect(response.body).not.toContain("reader-secret-topic");
    await app.close();
  });
});

describe("the ntfy test route", () => {
  it("publishes a test notice and reports that it arrived", async () => {
    const { app, posts } = appServing(READY);
    const response = await app.inject({ method: "POST", url: "/api/notifications/ntfy/test" });
    expect(response.json()).toMatchObject({ delivered: true, attempts: 1 });
    expect(posts).toEqual(["https://ntfy.sh/reader-secret-topic"]);
    await app.close();
  });

  it("refuses to test a channel that is not configured, and publishes nothing", async () => {
    const { app, posts } = appServing(undefined);
    const response = await app.inject({ method: "POST", url: "/api/notifications/ntfy/test" });
    expect(response.statusCode).toBe(400);
    expect(posts).toHaveLength(0);
    await app.close();
  });

  it("refuses a channel that is switched off, and says so", async () => {
    const { app, posts } = appServing({ ...READY, enabled: false });
    const response = await app.inject({ method: "POST", url: "/api/notifications/ntfy/test" });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: string }>().error).toBeTruthy();
    expect(posts).toHaveLength(0);
    await app.close();
  });

  it("answers with the failure when the server refuses, and keeps the topic out of the answer", async () => {
    const { app } = appServing(READY, 509);
    const response = await app.inject({ method: "POST", url: "/api/notifications/ntfy/test" });
    expect(response.json<{ delivered: boolean }>().delivered).toBe(false);
    expect(response.body).not.toContain("reader-secret-topic");
    await app.close();
  }, 15_000);

  it("publishes the block the panel is showing, so a test answers the question that was asked", async () => {
    // A reader who has typed a server and a topic, and not saved, asked whether those work. A notice
    // posted to the stored block answers a different question.
    const { app, posts } = appServing(READY);
    const response = await app.inject({
      method: "POST",
      url: "/api/notifications/ntfy/test",
      payload: { ntfy: { serverUrl: "https://ntfy.example.org", topic: "drafted-topic", onCompleted: true } },
    });
    expect(response.json<{ delivered: boolean }>().delivered).toBe(true);
    expect(posts).toEqual(["https://ntfy.example.org/drafted-topic"]);
    await app.close();
  }, 15_000);

  it("refuses a draft that names a server that is not one, and publishes nothing", async () => {
    // The draft is tested with the parser a save uses, so a test proves the bytes a save would store; a
    // draft that cannot publish is answered with the reason, not with a notice to the old channel.
    const { app, posts } = appServing(READY);
    const response = await app.inject({ method: "POST", url: "/api/notifications/ntfy/test", payload: { ntfy: { serverUrl: "not a url" } } });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: string }>().error).toBeTruthy();
    expect(posts).toHaveLength(0);
    await app.close();
  }, 15_000);
});
