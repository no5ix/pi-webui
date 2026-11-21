import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PiPackageInfo } from "../../shared/apiTypes.js";
import { ActiveAgentProfileAccessError } from "./activeAgentProfileProvider.js";
import { PiPackageNotFoundError, PiPackageScopeError } from "./piPackageService.js";
import type { PiPackageService } from "./piPackageService.js";
import { registerPiPackageRoutes } from "./piPackageRoutes.js";

let app: FastifyInstance;
let service: PiPackageService;
let serviceMocks: ReturnType<typeof fakePiPackageService>;

beforeEach(async () => {
  serviceMocks = fakePiPackageService();
  service = serviceMocks.service;
  app = Fastify({ logger: false });
  registerPiPackageRoutes(app, service);
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe("registerPiPackageRoutes", () => {
  it("lists configured Pi packages", async () => {
    const response = await app.inject({ method: "GET", url: "/api/pi-packages" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ packages: [{ source: "npm:@acme/tools", scope: "user", filtered: false, installedPath: "/home/test/.pi/packages/tools", disabled: false, enabled: true }] });
    expect(serviceMocks.list).toHaveBeenCalledOnce();
  });

  it("registers package routes under a custom API prefix", async () => {
    const prefixedApp = Fastify({ logger: false });
    const prefixedMocks = fakePiPackageService();
    registerPiPackageRoutes(prefixedApp, prefixedMocks.service, "/api/machines/local");
    await prefixedApp.ready();

    try {
      const response = await prefixedApp.inject({ method: "GET", url: "/api/machines/local/pi-packages" });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ packages: [{ source: "npm:@acme/tools", scope: "user", filtered: false, installedPath: "/home/test/.pi/packages/tools", disabled: false, enabled: true }] });
      expect(prefixedMocks.list).toHaveBeenCalledOnce();
    } finally {
      await prefixedApp.close();
    }
  });

  /**
   * A project install is pi's native local install, and it needs the project it writes: the server
   * resolves the id to that machine's directory, so a request that names the project scope with no
   * project is refused before pi is asked, rather than guessed at the machine's own folder.
   */
  it("installs a trimmed source, globally by default and into a project when the request names one", async () => {
    const response = await app.inject({ method: "POST", url: "/api/pi-packages/install", payload: { source: "  npm:@acme/new-tools  " } });
    const scopedResponse = await app.inject({ method: "POST", url: "/api/pi-packages/install", payload: { source: "../project-tools", scope: "project", projectId: "p-1" } });
    const scopelessResponse = await app.inject({ method: "POST", url: "/api/pi-packages/install", payload: { source: "../project-tools", scope: "project" } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ action: "install", source: "npm:@acme/new-tools" });
    expect(scopedResponse.statusCode).toBe(200);
    expect(scopedResponse.json()).toMatchObject({ action: "install", source: "../project-tools", scope: "project" });
    expect(scopelessResponse.statusCode).toBe(400);
    expect(scopelessResponse.json()).toEqual({ error: "A project-scope Pi package request needs a projectId" });
    expect(serviceMocks.install).toHaveBeenNthCalledWith(1, { source: "npm:@acme/new-tools" });
    expect(serviceMocks.install).toHaveBeenNthCalledWith(2, { source: "../project-tools", scope: "project", projectId: "p-1" });
  });

  it("removes from an explicitly listed package scope, with the project that scope belongs to", async () => {
    const response = await app.inject({ method: "POST", url: "/api/pi-packages/remove", payload: { source: "../project-tools", scope: "project", projectId: "p-1" } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ action: "remove", source: "../project-tools", scope: "project", removed: true });
    expect(serviceMocks.remove).toHaveBeenCalledWith({ source: "../project-tools", scope: "project", projectId: "p-1" });
  });

  it("updates all packages when source is omitted and one package when source is provided", async () => {
    const allResponse = await app.inject({ method: "POST", url: "/api/pi-packages/update" });
    const oneResponse = await app.inject({ method: "POST", url: "/api/pi-packages/update", payload: { source: " npm:@acme/tools ", scope: "project", projectId: "p-1" } });

    expect(allResponse.statusCode).toBe(200);
    expect(oneResponse.statusCode).toBe(200);
    expect(serviceMocks.update).toHaveBeenNthCalledWith(1, {});
    expect(serviceMocks.update).toHaveBeenNthCalledWith(2, { source: "npm:@acme/tools", scope: "project", projectId: "p-1" });
  });

  it("returns stable 400 errors for invalid requests before calling the service", async () => {
    const missingSource = await app.inject({ method: "POST", url: "/api/pi-packages/install", payload: {} });
    const blankSource = await app.inject({ method: "POST", url: "/api/pi-packages/remove", payload: { source: "  " } });
    const invalidScope = await app.inject({ method: "POST", url: "/api/pi-packages/remove", payload: { source: "npm:@acme/tools", scope: "temporary" } });
    const invalidUpdate = await app.inject({ method: "POST", url: "/api/pi-packages/update", payload: { source: "" } });

    expect(missingSource.statusCode).toBe(400);
    expect(missingSource.json()).toEqual({ error: "Pi package source must be a non-empty string" });
    expect(blankSource.statusCode).toBe(400);
    expect(blankSource.json()).toEqual({ error: "Pi package source must be a non-empty string" });
    expect(invalidScope.statusCode).toBe(400);
    expect(invalidScope.json()).toEqual({ error: "Pi package scope must be \"user\" or \"project\"" });
    expect(invalidUpdate.statusCode).toBe(400);
    expect(invalidUpdate.json()).toEqual({ error: "Pi package source must be a non-empty string" });
    expect(serviceMocks.install).not.toHaveBeenCalled();
    expect(serviceMocks.remove).not.toHaveBeenCalled();
    expect(serviceMocks.update).not.toHaveBeenCalled();
  });

  it("enables and disables a package in the scope the request names", async () => {
    const disable = await app.inject({ method: "POST", url: "/api/pi-packages/set-enabled", payload: { source: "npm:@acme/tools", scope: "user", enabled: false } });
    const enable = await app.inject({ method: "POST", url: "/api/pi-packages/set-enabled", payload: { source: "../project-tools", scope: "project", enabled: true, projectId: "p-1" } });
    const missingProject = await app.inject({ method: "POST", url: "/api/pi-packages/set-enabled", payload: { source: "../project-tools", scope: "project", enabled: true } });

    expect(disable.statusCode).toBe(200);
    expect(disable.json()).toMatchObject({ action: "set-enabled", source: "npm:@acme/tools", scope: "user", enabled: false, requiresReload: true });
    expect(enable.statusCode).toBe(200);
    expect(enable.json()).toMatchObject({ action: "set-enabled", source: "../project-tools", scope: "project", enabled: true });
    expect(missingProject.statusCode).toBe(400);
    expect(serviceMocks.setEnabled).toHaveBeenCalledTimes(2);
    expect(serviceMocks.setEnabled).toHaveBeenNthCalledWith(1, { source: "npm:@acme/tools", scope: "user", enabled: false });
    expect(serviceMocks.setEnabled).toHaveBeenNthCalledWith(2, { source: "../project-tools", scope: "project", enabled: true, projectId: "p-1" });
  });

  /**
   * A scope the machine will not act in — an untrusted project, above all — is the reader's answer to
   * read, not a server fault and not a validation typo, so it answers 403 with the service's sentence.
   */
  it("answers a scope the machine refuses with 403, and an unknown project with the resolver's status", async () => {
    serviceMocks.setEnabled.mockRejectedValueOnce(new PiPackageScopeError("This project is not trusted, so its Pi packages are not read, changed, or installed. Trust the project in pi first."));
    const refused = await app.inject({ method: "POST", url: "/api/pi-packages/set-enabled", payload: { source: "../x", scope: "project", enabled: false, projectId: "p-1" } });

    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toEqual({ error: "This project is not trusted, so its Pi packages are not read, changed, or installed. Trust the project in pi first." });
  });

  it("lists the project scope a request asked for, by id", async () => {
    const response = await app.inject({ method: "GET", url: "/api/pi-packages?projectId=p-1" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ projectId: "p-1" });
    expect(serviceMocks.list).toHaveBeenCalledWith({ projectId: "p-1" });

    const blank = await app.inject({ method: "GET", url: "/api/pi-packages?projectId=" });
    expect(blank.statusCode).toBe(400);
  });

  it("answers 404 when the named scope does not configure the package", async () => {
    serviceMocks.setEnabled.mockRejectedValueOnce(new PiPackageNotFoundError("No Pi package \"npm:@acme/gone\" is configured in the user scope"));

    const response = await app.inject({ method: "POST", url: "/api/pi-packages/set-enabled", payload: { source: "npm:@acme/gone", scope: "user", enabled: false } });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "No Pi package \"npm:@acme/gone\" is configured in the user scope" });
  });

  it("refuses an enable request with no scope, so a switch cannot guess the global file", async () => {
    const missingScope = await app.inject({ method: "POST", url: "/api/pi-packages/set-enabled", payload: { source: "npm:@acme/tools", enabled: false } });
    const missingEnabled = await app.inject({ method: "POST", url: "/api/pi-packages/set-enabled", payload: { source: "npm:@acme/tools", scope: "user" } });
    const missingSource = await app.inject({ method: "POST", url: "/api/pi-packages/set-enabled", payload: { scope: "user", enabled: false } });

    expect(missingScope.statusCode).toBe(400);
    expect(missingScope.json()).toEqual({ error: "Pi package scope must be \"user\" or \"project\"" });
    expect(missingEnabled.statusCode).toBe(400);
    expect(missingEnabled.json()).toEqual({ error: "Pi package enabled must be true or false" });
    expect(missingSource.statusCode).toBe(400);
    expect(serviceMocks.setEnabled).not.toHaveBeenCalled();
  });

  it("returns 503 when the daemon-owned active profile is unavailable", async () => {
    serviceMocks.list.mockRejectedValueOnce(new ActiveAgentProfileAccessError({ status: "unavailable", error: "connect ECONNREFUSED" }));

    const response = await app.inject({ method: "GET", url: "/api/pi-packages" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "Active agent profile is unavailable: connect ECONNREFUSED" });
  });

  it("returns stable 500 errors for package-manager failures", async () => {
    serviceMocks.install.mockRejectedValueOnce(new Error("install failed"));

    const response = await app.inject({ method: "POST", url: "/api/pi-packages/install", payload: { source: "npm:@acme/fails" } });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "install failed" });
  });
});

function fakePiPackageService() {
  const packages: PiPackageInfo[] = [{ source: "npm:@acme/tools", scope: "user", filtered: false, installedPath: "/home/test/.pi/packages/tools", disabled: false, enabled: true }];
  const list = vi.fn<PiPackageService["list"]>((request) => Promise.resolve({ packages: [...packages], ...(request.projectId === undefined ? {} : { projectId: request.projectId }) }));
  const install = vi.fn<PiPackageService["install"]>((request) => Promise.resolve({ action: "install", source: request.source, scope: request.scope ?? "user", packages: [...packages] }));
  const remove = vi.fn<PiPackageService["remove"]>((request) => Promise.resolve({ action: "remove", source: request.source, scope: request.scope ?? "user", removed: true, packages: [...packages] }));
  const update = vi.fn<PiPackageService["update"]>((request) => Promise.resolve({ action: "update", ...(request.source === undefined ? {} : { source: request.source }), ...(request.scope === undefined ? {} : { scope: request.scope }), packages: [...packages] }));
  const setEnabled = vi.fn<PiPackageService["setEnabled"]>((request) => Promise.resolve({ action: "set-enabled", source: request.source, scope: request.scope, enabled: request.enabled, requiresReload: true, packages: [...packages] }));
  const service: PiPackageService = { list, install, remove, update, setEnabled };
  return { service, list, install, remove, update, setEnabled };
}
