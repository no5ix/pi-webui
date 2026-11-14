import type { FastifyInstance, FastifyReply } from "fastify";
import type { PiMcpRemoveRequest, PiMcpScope, PiMcpSetEnabledRequest, PiMcpTestRequest, PiMcpWriteKind } from "../../shared/apiTypes.js";
import { ActiveAgentProfileAccessError } from "./activeAgentProfileProvider.js";
import { PiMcpRequestError, PiMcpServerErrorNotFound, type PiMcpService } from "./piMcpService.js";
import { McpConfigWriteError } from "../shared/resources/mcpConfig.js";
import { SettingsProjectError } from "../shared/resources/settingsProjectResolver.js";
import { errorMessage, isRecord } from "../../shared/unknownValues.js";

/** The name pi's own MCP config accepts: letters, digits, "_" and "-". */
const MCP_SERVER_NAME = /^[A-Za-z0-9_-]+$/u;

class PiMcpRequestValidationError extends Error {}

/**
 * The MCP routes.
 *
 * A request names a project by id, never by path: the machine that answers owns the project store,
 * and on a remote machine the project's folders are that machine's. A server name is validated
 * before anything reads a file, because the name is the key inside `mcp.json`.
 *
 * A write names the entry it aims at (`target`), and `scope` beside it for a PI WEB old enough to
 * know only the scope: the service reads both through one rule, so a browser and a machine that were
 * not released together agree on which file opens.
 */
export function registerPiMcpRoutes(app: FastifyInstance, service: PiMcpService, prefix = "/api"): void {
  const routePrefix = normalizeRoutePrefix(prefix);

  app.get<{ Querystring: unknown }>(`${routePrefix}/pi-mcp`, async (request, reply) => {
    try {
      const projectId = parseOptionalProjectId(readQuery(request.query)["projectId"]);
      return await service.list(projectId === undefined ? {} : { projectId });
    } catch (error) {
      return sendPiMcpError(reply, error);
    }
  });

  app.post<{ Body: unknown }>(`${routePrefix}/pi-mcp/set-enabled`, async (request, reply) => {
    try {
      return await service.setEnabled(parseSetEnabledRequest(request.body));
    } catch (error) {
      return sendPiMcpError(reply, error);
    }
  });

  app.post<{ Body: unknown }>(`${routePrefix}/pi-mcp/remove`, async (request, reply) => {
    try {
      return await service.remove(parseRemoveRequest(request.body));
    } catch (error) {
      return sendPiMcpError(reply, error);
    }
  });

  app.post<{ Body: unknown }>(`${routePrefix}/pi-mcp/test`, async (request, reply) => {
    try {
      return await service.test(parseTestRequest(request.body));
    } catch (error) {
      return sendPiMcpError(reply, error);
    }
  });
}

function normalizeRoutePrefix(prefix: string): string {
  const normalized = prefix.replace(/\/+$/u, "");
  return normalized === "" ? "/api" : normalized;
}

function parseSetEnabledRequest(body: unknown): PiMcpSetEnabledRequest {
  const fields = parseServerRequest(body);
  const enabled = fields["enabled"];
  if (typeof enabled !== "boolean") throw new PiMcpRequestValidationError("MCP enabled must be true or false");
  return { name: fields.name, ...parseWriteFields(fields, "editable"), enabled, ...fields.project };
}

function parseRemoveRequest(body: unknown): PiMcpRemoveRequest {
  const fields = parseServerRequest(body);
  return { name: fields.name, ...parseWriteFields(fields, "removable"), ...fields.project };
}

function parseTestRequest(body: unknown): PiMcpTestRequest {
  const fields = parseServerRequest(body);
  return { name: fields.name, ...fields.project };
}

/** The entry a write aims at, as the body words it: `target` for a new browser, `scope` for an old one. */
function parseWriteFields(fields: Record<string, unknown>, verb: "editable" | "removable"): { target: PiMcpWriteKind; scope?: PiMcpScope } {
  const target = parseWriteKind(fields["target"]);
  const scope = fields["scope"] === undefined ? undefined : parseScope(fields["scope"]);
  if (scope === "extension") throw new PiMcpRequestValidationError(`A server an extension registered is not ${verb} from Settings`);
  if (target === undefined && scope === undefined) {
    throw new PiMcpRequestValidationError('An MCP write must name its target: "definition" or "override"');
  }
  const resolved = target ?? (scope === "project" ? "override" : "definition");
  return scope === undefined ? { target: resolved } : { target: resolved, scope };
}

function parseWriteKind(value: unknown): PiMcpWriteKind | undefined {
  if (value === undefined) return undefined;
  if (value !== "definition" && value !== "override") throw new PiMcpRequestValidationError('MCP target must be "definition" or "override"');
  return value;
}

function parseServerRequest(body: unknown): { name: string; project: { projectId?: string }; [key: string]: unknown } {
  if (!isRecord(body)) throw new PiMcpRequestValidationError("MCP request body must be an object");
  const name = body["name"];
  if (typeof name !== "string" || name.trim() === "") throw new PiMcpRequestValidationError("MCP server name must be a non-empty string");
  if (!MCP_SERVER_NAME.test(name.trim())) throw new PiMcpRequestValidationError("MCP server name may use only letters, digits, \"_\" and \"-\"");
  const projectId = parseOptionalProjectId(body["projectId"]);
  if (projectId !== undefined && body["scope"] === "extension") {
    throw new PiMcpRequestValidationError("An extension-scope server is not project scoped");
  }
  return {
    name: name.trim(),
    project: projectId === undefined ? {} : { projectId },
    ...body,
  };
}

function parseScope(value: unknown): PiMcpScope {
  if (value !== "global" && value !== "project" && value !== "extension") {
    throw new PiMcpRequestValidationError("MCP scope must be \"global\", \"project\", or \"extension\"");
  }
  return value;
}

function parseOptionalProjectId(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim() === "") throw new PiMcpRequestValidationError("projectId must be a non-empty string");
  return value.trim();
}

function readQuery(query: unknown): Record<string, unknown> {
  return isRecord(query) ? query : {};
}

function sendPiMcpError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof SettingsProjectError) return reply.code(error.status).send({ error: error.message });
  const status = error instanceof PiMcpRequestValidationError
    ? 400
    : error instanceof McpConfigWriteError
      ? 400
    : error instanceof PiMcpRequestError
      ? 400
      : error instanceof PiMcpServerErrorNotFound
        ? 404
        : error instanceof ActiveAgentProfileAccessError
          ? 503
          : 500;
  return reply.code(status).send({ error: errorMessage(error) });
}
