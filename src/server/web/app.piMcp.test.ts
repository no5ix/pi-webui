import { describe, expect, it } from "vitest";
import type { PiMcpListResponse } from "../../shared/apiTypes.js";
import { appTestContext, registerAppTestHooks } from "./app.testSupport.js";

registerAppTestHooks();

/**
 * The MCP routes as the built app serves them.
 *
 * The route module's own tests pin the statuses and the redaction; what is pinned here is that the
 * app mounts the routes at the application path and the local-machine alias, that a connection test
 * is answered through the same wiring, and that a machine's answer carries the names of what a
 * server uses and never the values.
 */
describe("buildApp Pi MCP routes", () => {
  it("lists the configured servers of the machine the app serves, with names only", async () => {
    const response = await appTestContext.app.inject({ method: "GET", url: "/api/pi-mcp" });

    expect(response.statusCode).toBe(200);
    const body = response.json<PiMcpListResponse>();
    expect(body.servers.map((server) => server.name)).toEqual(["files"]);
    expect(body.servers[0]?.envNames).toEqual(["FILES_TOKEN"]);
    expect(body.globalConfigPath).toBe("/pi/mcp.json");
    expect(JSON.stringify(body)).not.toContain("FILES_TOKEN=");
    expect(appTestContext.piMcpRequests).toEqual([{ action: "list" }]);
  });

  it("serves the same list through the local machine alias", async () => {
    const response = await appTestContext.app.inject({ method: "GET", url: "/api/machines/local/pi-mcp" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ servers: [expect.objectContaining({ name: "files" })] });
  });

  it("turns a server on, and says a reload is what connects it", async () => {
    const response = await appTestContext.app.inject({
      method: "POST",
      url: "/api/pi-mcp/set-enabled",
      payload: { name: "files", scope: "global", enabled: true },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ action: "set-enabled", requiresReload: true });
    expect(appTestContext.piMcpRequests).toEqual([{ action: "set-enabled", name: "files", scope: "global", enabled: true }]);
  });

  it("probes a server through the local machine alias", async () => {
    const response = await appTestContext.app.inject({
      method: "POST",
      url: "/api/machines/local/pi-mcp/test",
      payload: { name: "files", scope: "global" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ action: "test", probe: { state: "reachable" } });
    expect(appTestContext.piMcpRequests).toEqual([{ action: "test", name: "files", scope: "global" }]);
  });

  it("removes a server and reports the reload that takes its tools away", async () => {
    const response = await appTestContext.app.inject({
      method: "POST",
      url: "/api/pi-mcp/remove",
      payload: { name: "files", scope: "global" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ action: "remove", removed: true, requiresReload: true });
  });

  it("refuses a request that names no server, before the service sees it", async () => {
    const response = await appTestContext.app.inject({ method: "POST", url: "/api/pi-mcp/remove", payload: { scope: "global" } });

    expect(response.statusCode).toBe(400);
    expect(appTestContext.piMcpRequests).toEqual([]);
  });
});
