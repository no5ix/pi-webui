import type { FastifyInstance, FastifyReply } from "fastify";
import type { PiSkillScope, PiSkillSetEnabledRequest } from "../../shared/apiTypes.js";
import { ActiveAgentProfileAccessError } from "./activeAgentProfileProvider.js";
import type { PiSkillsService } from "./piSkillsService.js";
import { PiSkillNotFoundError, PiSkillsRequestError } from "./piSkillsService.js";
import { SettingsProjectError } from "../shared/resources/settingsProjectResolver.js";
import { errorMessage, isRecord } from "../../shared/unknownValues.js";

class PiSkillsRequestValidationError extends Error {}

/**
 * The Skills routes.
 *
 * A request names a project by id, never by path: the machine that answers owns the project store,
 * and on a remote machine the project's folders are that machine's, not this browser's.
 */
export function registerPiSkillsRoutes(app: FastifyInstance, service: PiSkillsService, prefix = "/api"): void {
  const routePrefix = normalizeRoutePrefix(prefix);

  app.get<{ Querystring: unknown }>(`${routePrefix}/pi-skills`, async (request, reply) => {
    try {
      const projectId = parseOptionalProjectId(readQuery(request.query)["projectId"]);
      return await service.list(projectId === undefined ? {} : { projectId });
    } catch (error) {
      return sendPiSkillsError(reply, error);
    }
  });

  app.post<{ Body: unknown }>(`${routePrefix}/pi-skills/set-enabled`, async (request, reply) => {
    try {
      return await service.setEnabled(parseSetEnabledRequest(request.body));
    } catch (error) {
      return sendPiSkillsError(reply, error);
    }
  });
}

function normalizeRoutePrefix(prefix: string): string {
  const normalized = prefix.replace(/\/+$/u, "");
  return normalized === "" ? "/api" : normalized;
}

function parseSetEnabledRequest(body: unknown): PiSkillSetEnabledRequest {
  if (!isRecord(body)) throw new PiSkillsRequestValidationError("Skill request body must be an object");
  const name = body["name"];
  if (typeof name !== "string" || name.trim() === "") throw new PiSkillsRequestValidationError("Skill name must be a non-empty string");
  const scope = parseScope(body["scope"]);
  const enabled = body["enabled"];
  if (typeof enabled !== "boolean") throw new PiSkillsRequestValidationError("Skill enabled must be true or false");
  const projectId = parseOptionalProjectId(body["projectId"]);
  if (scope === "project" && projectId === undefined) {
    throw new PiSkillsRequestValidationError("A project-scope skill preference needs a projectId");
  }
  return { name: name.trim(), scope, enabled, ...(projectId === undefined ? {} : { projectId }) };
}

function parseScope(value: unknown): PiSkillScope {
  if (value !== "global" && value !== "project") throw new PiSkillsRequestValidationError("Skill scope must be \"global\" or \"project\"");
  return value;
}

function parseOptionalProjectId(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim() === "") throw new PiSkillsRequestValidationError("projectId must be a non-empty string");
  return value.trim();
}

function readQuery(query: unknown): Record<string, unknown> {
  return isRecord(query) ? query : {};
}

function sendPiSkillsError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof SettingsProjectError) return reply.code(error.status).send({ error: error.message });
  const status = error instanceof PiSkillsRequestValidationError || error instanceof PiSkillsRequestError
    ? 400
    : error instanceof PiSkillNotFoundError
      ? 404
      : error instanceof ActiveAgentProfileAccessError
        ? 503
        : 500;
  return reply.code(status).send({ error: errorMessage(error) });
}
