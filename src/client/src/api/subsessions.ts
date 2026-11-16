import type { SessionSubsessionInfo, SessionSubsessionsSnapshot } from "../../../shared/apiTypes";
import { machineRead } from "./http";

const machinePrefix = (machineId = "local") => `api/machines/${encodeURIComponent(machineId)}`;

/**
 * The children a session started through PI WEB's subsession routes.
 *
 * The daemon tracks these in memory for the session that spawned them, so the
 * read answers only about a session the daemon is holding. The list is not
 * pi's subagent runs: those belong to the subagents plugin, which offers its own
 * list (`POST /api/plugins/subagents/runs.list`) and its own panel. A surface
 * that shows both must say which of the two it is showing.
 */
export function subsessionsPath(sessionId: string, cwd: string | undefined, machineId = "local"): string {
  const query = cwd === undefined || cwd === "" ? "" : `?cwd=${encodeURIComponent(cwd)}`;
  return `${machinePrefix(machineId)}/sessions/${encodeURIComponent(sessionId)}/subsessions${query}`;
}

export function readSubsessions(sessionId: string, cwd: string | undefined, machineId = "local"): Promise<SessionSubsessionsSnapshot> {
  return machineRead(subsessionsPath(sessionId, cwd, machineId), parseSubsessionsSnapshot, { cache: "no-store" });
}

/** An object as a record of unknowns, with no assertion: a wire answer is not trusted. */
function recordOf(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) record[key] = entry;
  return record;
}

/** A snapshot, or a refusal naming what the answer was. A missing list is unknown, not empty. */
export function parseSubsessionsSnapshot(value: unknown): SessionSubsessionsSnapshot {
  const container = recordOf(value);
  if (container === undefined) throw new Error("subsessions: expected an object");
  const list = container["subsessions"];
  if (!Array.isArray(list)) throw new Error("subsessions: expected a subsessions array");
  const subsessions: SessionSubsessionInfo[] = [];
  for (const entry of list) {
    const record = recordOf(entry);
    if (record === undefined) continue;
    const sessionId = typeof record["sessionId"] === "string" ? record["sessionId"] : "";
    if (sessionId === "") continue;
    const cwd = typeof record["cwd"] === "string" ? record["cwd"] : "";
    const status = record["status"];
    subsessions.push({
      sessionId,
      cwd,
      status: status === "working" || status === "idle" || status === "error" ? status : "unknown",
    });
  }
  return { subsessions };
}
