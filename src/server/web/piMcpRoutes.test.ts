import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PiMcpListResponse, PiMcpMutationResponse } from "../../shared/apiTypes.js";
import { ActiveAgentProfileAccessError } from "./activeAgentProfileProvider.js";
import { McpConfigWriteError } from "../shared/resources/mcpConfig.js";
import { PiMcpRequestError, PiMcpServerErrorNotFound, type PiMcpService } from "./piMcpService.js";
import { registerPiMcpRoutes } from "./piMcpRoutes.js";
import { SettingsProjectError } from "../shared/resources/settingsProjectResolver.js";

/**
 * The MCP routes, with the service faked.
 *
 * A name is validated here before any file is read, because the name is the key inside `mcp.json`
 * and a name pi would reject would sit in the file unreadable. A secret is never part of a request
 * or a response, and these tests keep it that way by asserting on the exact payload.
 */

function response(): PiMcpListResponse {
  return {
    servers: [
      {
        name: "files",
        scope: "global",
        transport: "stdio",
        configured: "enabled",
        configPath: "/home/test/.pi/mcp.json",
        enabled: true,
        command: "mcp-files",
        envNames: ["FILES_TOKEN"],
        usesSecrets: true,
        probe: { state: "unprobed" },
      },
    ],
    errors: [],
    globalConfigPath: "/home/test/.pi/mcp.json",
    projectTrusted: false,
    projectScopeRead: false,
  };
}

function fakeMcpService() {
  const list = vi.fn(() => Promise.resolve(response()));
  const setEnabled = vi.fn(() => Promise.resolve({ ...response(), action: "set-enabled", name: "files", enabled: false, requiresReload: true } satisfies PiMcpMutationResponse));
  const remove = vi.fn(() => Promise.resolve({ ...response(), action: "remove", name: "files", removed: true, requiresReload: true } satisfies PiMcpMutationResponse));
  const test = vi.fn(() => Promise.resolve({ ...response(), action: "test", name: "files", probe: { state: "reachable", serverName: "files-server" }, requiresReload: false } satisfies PiMcpMutationResponse));
  const service: PiMcpService = { list, setEnabled, remove, test };
  return { service, list, setEnabled, remove, test };
}

let app: FastifyInstance;
let mocks: ReturnType<typeof fakeMcpService>;

beforeEach(async () => {
  mocks = fakeMcpService();
  app = Fastify({ logger: false });
  registerPiMcpRoutes(app, mocks.service);
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe("registerPiMcpRoutes", () => {
  it("lists the configured servers, names only", async () => {
    const response = await app.inject({ method: "GET", url: "/api/pi-mcp" });

    expect(response.statusCode).toBe(200);
    expect(response.json<PiMcpListResponse>().servers[0]).toMatchObject({ name: "files", enabled: true, envNames: ["FILES_TOKEN"], probe: { state: "unprobed" } });
    expect(JSON.stringify(response.json())).not.toContain("Bearer");
  });

  it("turns a server off in the scope that defines it", async () => {
    const response = await app.inject({ method: "POST", url: "/api/pi-mcp/set-enabled", payload: { name: "files", scope: "global", enabled: false } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ action: "set-enabled", name: "files", enabled: false, requiresReload: true });
    expect(mocks.setEnabled).toHaveBeenCalledWith({ name: "files", scope: "global", enabled: false });
  });

  it("removes a server from one file", async () => {
    const response = await app.inject({ method: "POST", url: "/api/pi-mcp/remove", payload: { name: "files", scope: "project", projectId: "p-1" } });

    expect(response.statusCode).toBe(200);
    expect(mocks.remove).toHaveBeenCalledWith({ name: "files", scope: "project", projectId: "p-1" });
  });

  it("probes a server without claiming a reload", async () => {
    const response = await app.inject({ method: "POST", url: "/api/pi-mcp/test", payload: { name: "files", scope: "global" } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ action: "test", probe: { state: "reachable", serverName: "files-server" }, requiresReload: false });
  });

  it("refuses a name pi's own MCP config would not accept", async () => {
    for (const name of ["files server", "files.v2", "", "  ", "files/svc", "文件"]) {
      const response = await app.inject({ method: "POST", url: "/api/pi-mcp/set-enabled", payload: { name, scope: "global", enabled: false } });
      expect(response.statusCode, name).toBe(400);
    }
  });

  it("refuses a switch that is not a switch, a scope that is not a scope, and a body that is not an object", async () => {
    expect((await app.inject({ method: "POST", url: "/api/pi-mcp/set-enabled", payload: { name: "files", scope: "global", enabled: "off" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/pi-mcp/set-enabled", payload: { name: "files", scope: "machine", enabled: false } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/pi-mcp/remove", payload: ["files"] })).statusCode).toBe(400);
  });

  it("refuses to edit a server an extension registered, which pi owns", async () => {
    const response = await app.inject({ method: "POST", url: "/api/pi-mcp/set-enabled", payload: { name: "files", scope: "extension", enabled: false } });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: string }>().error).toContain("extension");
  });

  it("answers a server that is not configured with 404", async () => {
    mocks.remove.mockRejectedValueOnce(new PiMcpServerErrorNotFound('No MCP server named "gone" is configured on this machine'));

    const response = await app.inject({ method: "POST", url: "/api/pi-mcp/remove", payload: { name: "gone", scope: "global" } });

    expect(response.statusCode).toBe(404);
  });

  it("answers a scope conflict with the service's own 400", async () => {
    mocks.setEnabled.mockRejectedValueOnce(new PiMcpRequestError("MCP server \"files\" is defined by the project only"));

    const response = await app.inject({ method: "POST", url: "/api/pi-mcp/set-enabled", payload: { name: "files", scope: "global", enabled: false } });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: string }>().error).toContain("project only");
  });

  it("answers a project it cannot read with the resolver's own status", async () => {
    mocks.list.mockRejectedValueOnce(new SettingsProjectError(404, "Project p-9 was not found"));

    expect((await app.inject({ method: "GET", url: "/api/pi-mcp?projectId=p-9" })).statusCode).toBe(404);
  });

  it("answers a machine with no active agent profile with 503", async () => {
    mocks.list.mockRejectedValueOnce(new ActiveAgentProfileAccessError({ status: "unavailable", error: "No active pi agent profile on this machine" }));

    expect((await app.inject({ method: "GET", url: "/api/pi-mcp" })).statusCode).toBe(503);
  });

  it("keeps an unexpected failure a 500", async () => {
    mocks.list.mockRejectedValueOnce(new Error("disk is gone"));

    expect((await app.inject({ method: "GET", url: "/api/pi-mcp" })).statusCode).toBe(500);
  });

  it("answers 400 when the file a write needs is not parseable, with only the safe reason", async () => {
    mocks.setEnabled.mockRejectedValue(new McpConfigWriteError("/pi/mcp.json: the file is not valid JSON (character 66)"));

    const response = await app.inject({ method: "POST", url: "/api/pi-mcp/set-enabled", payload: { name: "files", scope: "global", enabled: false } });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: string }>().error).toContain("the file is not valid JSON");
  });

  it("registers the routes under the machine-proxy prefix", async () => {
    const prefixed = Fastify({ logger: false });
    const prefixedMocks = fakeMcpService();
    registerPiMcpRoutes(prefixed, prefixedMocks.service, "/api/machines/local");
    await prefixed.ready();

    try {
      expect((await prefixed.inject({ method: "GET", url: "/api/machines/local/pi-mcp" })).statusCode).toBe(200);
      expect((await prefixed.inject({ method: "POST", url: "/api/machines/local/pi-mcp/test", payload: { name: "files", scope: "global" } })).statusCode).toBe(200);
    } finally {
      await prefixed.close();
    }
  });
});
