import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PiSkillsResponse, PiSkillSetEnabledResponse } from "../../shared/apiTypes.js";
import { ActiveAgentProfileAccessError } from "./activeAgentProfileProvider.js";
import { PiSkillNotFoundError, PiSkillsRequestError, type PiSkillsService } from "./piSkillsService.js";
import { registerPiSkillsRoutes } from "./piSkillsRoutes.js";
import { SettingsProjectError } from "../shared/resources/settingsProjectResolver.js";

/**
 * The Skills routes, with the service faked.
 *
 * What these tests own is the answer a browser gets: which request is refused and with which
 * status, and that a project is named by id and handed to the service unchanged. What the service
 * does with pi's files is its own test's business.
 */

function response(): PiSkillsResponse {
  return {
    skills: [
      {
        name: "pdf",
        description: "Work with PDF files",
        filePath: "/home/test/.pi/skills/pdf/SKILL.md",
        baseDir: "/home/test/.pi/skills/pdf",
        scope: "global",
        origin: "agent",
        source: "user",
        preference: "default",
        enabled: true,
        validation: "valid",
      },
    ],
    diagnostics: [],
    scopes: [
      {
        scope: "global",
        skillsDir: "/home/test/.pi/skills",
        configPath: "/home/test/.pi-web/config.json",
      },
    ],
  };
}

function fakeSkillsService(): { service: PiSkillsService; list: ReturnType<typeof vi.fn>; setEnabled: ReturnType<typeof vi.fn> } {
  const list = vi.fn(() => Promise.resolve(response()));
  const setEnabled = vi.fn(() => Promise.resolve({ ...response(), requiresReload: true } satisfies PiSkillSetEnabledResponse));
  const service: PiSkillsService = { list, setEnabled };
  return { service, list, setEnabled };
}

let app: FastifyInstance;
let mocks: ReturnType<typeof fakeSkillsService>;

beforeEach(async () => {
  mocks = fakeSkillsService();
  app = Fastify({ logger: false });
  registerPiSkillsRoutes(app, mocks.service);
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe("registerPiSkillsRoutes", () => {
  it("lists the skills a machine has", async () => {
    const response = await app.inject({ method: "GET", url: "/api/pi-skills" });

    expect(response.statusCode).toBe(200);
    expect(response.json<PiSkillsResponse>().skills[0]?.name).toBe("pdf");
    expect(mocks.list).toHaveBeenCalledWith({});
  });

  it("passes a project id to the service, and never a path", async () => {
    const response = await app.inject({ method: "GET", url: "/api/pi-skills?projectId=p-1" });

    expect(response.statusCode).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith({ projectId: "p-1" });
  });

  it("turns a skill off in the scope the request named", async () => {
    const response = await app.inject({ method: "POST", url: "/api/pi-skills/set-enabled", payload: { name: "pdf", scope: "global", enabled: false } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ requiresReload: true, skills: [expect.objectContaining({ name: "pdf" })] });
    expect(mocks.setEnabled).toHaveBeenCalledWith({ name: "pdf", scope: "global", enabled: false });
  });

  it("refuses a scope that is not one of the two a skill preference can have", async () => {
    const response = await app.inject({ method: "POST", url: "/api/pi-skills/set-enabled", payload: { name: "pdf", scope: "session", enabled: false } });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: string }>().error).toContain("scope");
  });

  it("refuses a project-scope preference that names no project", async () => {
    const response = await app.inject({ method: "POST", url: "/api/pi-skills/set-enabled", payload: { name: "pdf", scope: "project", enabled: false } });

    expect(response.statusCode).toBe(400);
  });

  it("refuses a name that is empty, and a switch that is not a switch", async () => {
    expect((await app.inject({ method: "POST", url: "/api/pi-skills/set-enabled", payload: { name: "  ", scope: "global", enabled: false } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/pi-skills/set-enabled", payload: { name: "pdf", scope: "global", enabled: "off" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/pi-skills/set-enabled", payload: ["pdf"] })).statusCode).toBe(400);
  });

  it("answers a skill the scope does not offer with 404", async () => {
    mocks.setEnabled.mockRejectedValueOnce(new PiSkillNotFoundError('No skill named "gone" is available on this machine'));

    const response = await app.inject({ method: "POST", url: "/api/pi-skills/set-enabled", payload: { name: "gone", scope: "global", enabled: false } });

    expect(response.statusCode).toBe(404);
    expect(response.json<{ error: string }>().error).toContain("gone");
  });

  it("answers a project it cannot read with the resolver's own status", async () => {
    mocks.list.mockRejectedValueOnce(new SettingsProjectError(404, "Project p-9 was not found"));

    expect((await app.inject({ method: "GET", url: "/api/pi-skills?projectId=p-9" })).statusCode).toBe(404);

    mocks.list.mockRejectedValueOnce(new SettingsProjectError(400, "A project-scope request needs a project"));
    expect((await app.inject({ method: "GET", url: "/api/pi-skills?projectId=" })).statusCode).toBe(400);
  });

  it("answers a machine with no active agent profile with 503, not a stack trace", async () => {
    mocks.list.mockRejectedValueOnce(new ActiveAgentProfileAccessError({ status: "unavailable", error: "No active pi agent profile on this machine" }));

    const response = await app.inject({ method: "GET", url: "/api/pi-skills" });

    expect(response.statusCode).toBe(503);
  });

  it("keeps an unexpected failure a 500", async () => {
    mocks.list.mockRejectedValueOnce(new PiSkillsRequestError("a request problem"));
    expect((await app.inject({ method: "GET", url: "/api/pi-skills" })).statusCode).toBe(400);

    mocks.list.mockRejectedValueOnce(new Error("disk is gone"));
    expect((await app.inject({ method: "GET", url: "/api/pi-skills" })).statusCode).toBe(500);
  });

  it("registers the routes under the machine-proxy prefix", async () => {
    const prefixed = Fastify({ logger: false });
    const prefixedMocks = fakeSkillsService();
    registerPiSkillsRoutes(prefixed, prefixedMocks.service, "/api/machines/local");
    await prefixed.ready();

    try {
      expect((await prefixed.inject({ method: "GET", url: "/api/machines/local/pi-skills" })).statusCode).toBe(200);
      expect((await prefixed.inject({ method: "POST", url: "/api/machines/local/pi-skills/set-enabled", payload: { name: "pdf", scope: "global", enabled: true } })).statusCode).toBe(200);
    } finally {
      await prefixed.close();
    }
  });
});
