import type { FastifyInstance, FastifyReply } from "fastify";
import type { PiPackageScope } from "../../shared/apiTypes.js";
import { ActiveAgentProfileAccessError } from "./activeAgentProfileProvider.js";
import { PiPackageNotFoundError, PiPackageScopeError, type PiPackageService } from "./piPackageService.js";
import { SettingsProjectError } from "../shared/resources/settingsProjectResolver.js";
import { errorMessage, isRecord } from "../../shared/unknownValues.js";

class PiPackageRequestValidationError extends Error {}

/**
 * The Pi Packages routes.
 *
 * A request names a project by id, never by path: the machine that answers owns the project store,
 * and a project's packages are that machine's files. A project-scope request without a project is
 * refused here, before any settings file is opened.
 */
export function registerPiPackageRoutes(app: FastifyInstance, service: PiPackageService, prefix = "/api"): void {
  const routePrefix = normalizeRoutePrefix(prefix);

  app.get<{ Querystring: unknown }>(`${routePrefix}/pi-packages`, async (request, reply) => {
    try {
      const projectId = parseOptionalProjectId(readQuery(request.query)["projectId"]);
      return await service.list(projectId === undefined ? {} : { projectId });
    } catch (error) {
      return sendPiPackageError(reply, error);
    }
  });

  app.post<{ Body: unknown }>(`${routePrefix}/pi-packages/install`, async (request, reply) => {
    try {
      const body = requireRequestObject(request.body);
      const scope = parseOptionalScope(body["scope"]);
      const projectId = parseOptionalProjectId(body["projectId"]);
      requireProjectForScope(scope, projectId);
      return await service.install({
        source: parseRequiredSource(body["source"]),
        ...(scope === undefined ? {} : { scope }),
        ...(projectId === undefined ? {} : { projectId }),
      });
    } catch (error) {
      return sendPiPackageError(reply, error);
    }
  });

  app.post<{ Body: unknown }>(`${routePrefix}/pi-packages/remove`, async (request, reply) => {
    try {
      const body = requireRequestObject(request.body);
      const scope = parseOptionalScope(body["scope"]);
      const projectId = parseOptionalProjectId(body["projectId"]);
      requireProjectForScope(scope, projectId);
      return await service.remove({
        source: parseRequiredSource(body["source"]),
        ...(scope === undefined ? {} : { scope }),
        ...(projectId === undefined ? {} : { projectId }),
      });
    } catch (error) {
      return sendPiPackageError(reply, error);
    }
  });

  app.post<{ Body: unknown }>(`${routePrefix}/pi-packages/update`, async (request, reply) => {
    try {
      const body = request.body === undefined ? {} : requireRequestObject(request.body);
      const scope = parseOptionalScope(body["scope"]);
      const projectId = parseOptionalProjectId(body["projectId"]);
      const source = body["source"] === undefined ? undefined : parseRequiredSource(body["source"]);
      requireProjectForScope(scope, projectId);
      return await service.update({
        ...(source === undefined ? {} : { source }),
        ...(scope === undefined ? {} : { scope }),
        ...(projectId === undefined ? {} : { projectId }),
      });
    } catch (error) {
      return sendPiPackageError(reply, error);
    }
  });

  /**
   * Keeps a package installed and configured, and moves pi's filter over its resources.
   *
   * The scope is required, not inferred: a project package is a project's file, and a switch that
   * guessed "user" would edit somebody's global settings from a project card.
   */
  app.post<{ Body: unknown }>(`${routePrefix}/pi-packages/set-enabled`, async (request, reply) => {
    try {
      const body = requireRequestObject(request.body);
      const enabled = body["enabled"];
      if (typeof enabled !== "boolean") throw new PiPackageRequestValidationError("Pi package enabled must be true or false");
      const scope = parseRequiredScope(body["scope"]);
      const projectId = parseOptionalProjectId(body["projectId"]);
      requireProjectForScope(scope, projectId);
      return await service.setEnabled({
        source: parseRequiredSource(body["source"]),
        scope,
        enabled,
        ...(projectId === undefined ? {} : { projectId }),
      });
    } catch (error) {
      return sendPiPackageError(reply, error);
    }
  });
}

function normalizeRoutePrefix(prefix: string): string {
  const normalized = prefix.replace(/\/+$/u, "");
  return normalized === "" ? "/api" : normalized;
}

/** A project-scope write needs the project it writes; "user" needs nothing beside it. */
function requireProjectForScope(scope: PiPackageScope | undefined, projectId: string | undefined): void {
  if (scope === "project" && projectId === undefined) {
    throw new PiPackageRequestValidationError("A project-scope Pi package request needs a projectId");
  }
}

function parseRequiredSource(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") throw new PiPackageRequestValidationError("Pi package source must be a non-empty string");
  return value.trim();
}

function parseRequiredScope(value: unknown): PiPackageScope {
  if (value !== "user" && value !== "project") throw new PiPackageRequestValidationError("Pi package scope must be \"user\" or \"project\"");
  return value;
}

function parseOptionalScope(value: unknown): PiPackageScope | undefined {
  if (value === undefined) return undefined;
  return parseRequiredScope(value);
}

function parseOptionalProjectId(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim() === "") throw new PiPackageRequestValidationError("projectId must be a non-empty string");
  return value.trim();
}

function readQuery(query: unknown): Record<string, unknown> {
  return isRecord(query) ? query : {};
}

function requireRequestObject(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new PiPackageRequestValidationError("Pi package request body must be an object");
  return value;
}

function sendPiPackageError(reply: FastifyReply, error: unknown): FastifyReply {
  const status = error instanceof PiPackageRequestValidationError
    ? 400
    : error instanceof SettingsProjectError
      ? error.status
    : error instanceof PiPackageScopeError
      ? 403
    : error instanceof PiPackageNotFoundError
      ? 404
    : error instanceof ActiveAgentProfileAccessError
      ? 503
      : 500;
  if (status === 500) reply.log.error({ err: error }, "pi packages request failed");
  return reply.code(status).send({ error: errorMessage(error) });
}
