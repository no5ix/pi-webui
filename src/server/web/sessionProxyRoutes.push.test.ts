import Fastify, { type FastifyInstance } from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import type { WebSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { registerSessionProxyRoutes, type SessionProxyDaemon } from "./sessionProxyRoutes";

/**
 * The push routes live on the session daemon, and the web/API is the only thing a browser can reach.
 *
 * The proxy strips `/api` before it forwards, and the daemon serves its routes unprefixed, so a push
 * route registered on the daemon at `/api/push/state` is a route no browser can reach: the settings
 * panel reads a 404 and reports a server with no key pair. These two facts - the strip on this side
 * and the unprefixed registration on the daemon - are one contract, and it is pinned from both ends:
 * here, what the daemon is asked for; in `pushRoutes.test.ts`, what the daemon answers.
 */

const apps: FastifyInstance[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
});

async function proxyApp(): Promise<{ app: FastifyInstance; forwarded: string[] }> {
  const forwarded: string[] = [];
  const daemon: SessionProxyDaemon = {
    request: (method, path) => {
      forwarded.push(`${method} ${path}`);
      return Promise.resolve({ statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ answered: path }) });
    },
    connectWebSocket: (): WebSocket => {
      throw new Error("the push routes are not sockets");
    },
  };
  const app = Fastify({ logger: false });
  apps.push(app);
  await app.register(fastifyWebsocket);
  registerSessionProxyRoutes(app, daemon);
  await app.ready();
  return { app, forwarded };
}

describe("the session proxy carries the push routes to the daemon", () => {
  it("asks the daemon for the unprefixed push paths, for every method the settings page uses", async () => {
    const { app, forwarded } = await proxyApp();

    const state = await app.inject({ method: "GET", url: "/api/push/state" });
    const register = await app.inject({ method: "POST", url: "/api/push/subscriptions", payload: { endpoint: "https://push.example.com/a" } });
    const remove = await app.inject({ method: "DELETE", url: "/api/push/subscriptions/device-1" });
    const test = await app.inject({ method: "POST", url: "/api/push/test", payload: { sessionId: "session-1" } });

    expect([state.statusCode, register.statusCode, remove.statusCode, test.statusCode]).toEqual([200, 200, 200, 200]);
    expect(forwarded).toEqual([
      "GET /push/state",
      "POST /push/subscriptions",
      "DELETE /push/subscriptions/device-1",
      "POST /push/test",
    ]);
  });

  it("relays the daemon's answer, so the panel reports the daemon's reason and not a proxy failure", async () => {
    const { app } = await proxyApp();
    const state = await app.inject({ method: "GET", url: "/api/push/state" });
    const body: unknown = state.json();
    expect(body).toEqual({ answered: "/push/state" });
  });
});
