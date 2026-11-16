import type { SessionActivity, SessionStatus } from "../../../shared/apiTypes";
import { sessionActivityCategory } from "../../../shared/sessionActivityState";

/** What a line of the background rail says the work is doing. */
export type BackgroundState = "running" | "queued" | "waiting" | "failed" | "idle";

export interface BackgroundRow {
  id: string;
  label: string;
  /** The quieter tail: where, how many, how long. */
  detail: string;
  state: BackgroundState;
}

/**
 * The work a session has that is not the message on screen.
 *
 * The rail reports only what the daemon states. A session's status carries the
 * queued prompts, the count of runs the session started that outlive its turn,
 * the dialogs it is blocked on, and whether it is compacting, stopping,
 * streaming, or running a command. What it does not carry is a list of
 * individual background runs: a plugin that owns such a list offers its own
 * surface, and the rail counts them rather than naming them, so a number is
 * never presented as a list of things the app has not read.
 *
 * No row means the session reports nothing, which the caller says out loud.
 * Silence is not "idle": a session whose status has not arrived is unknown, and
 * the caller says that too.
 */
export function backgroundRows(input: {
  status: SessionStatus | undefined;
  activity: SessionActivity | undefined;
}): BackgroundRow[] {
  const status = input.status;
  if (status === undefined) return [];
  const rows: BackgroundRow[] = [];
  const dialogs = status.pendingDialogs ?? [];
  if (dialogs.length > 0) {
    rows.push({
      id: "waiting",
      label: dialogs.length === 1 ? "Waiting for an answer" : `Waiting for ${String(dialogs.length)} answers`,
      detail: dialogs[0]?.title ?? "",
      state: "waiting",
    });
  }
  const queued = status.queuedMessages;
  const queuedCount = status.pendingMessageCount;
  if (queuedCount > 0) {
    rows.push({
      id: "queued",
      label: queuedCount === 1 ? "1 message queued" : `${String(queuedCount)} messages queued`,
      detail: queued[0]?.text ?? "",
      state: "queued",
    });
  }
  const runs = status.backgroundRunCount ?? 0;
  if (runs > 0) {
    rows.push({
      id: "background-runs",
      label: runs === 1 ? "1 run started by this session is still going" : `${String(runs)} runs started by this session are still going`,
      detail: status.lastRunDurationMs === undefined ? "" : `last turn ${String(Math.round(status.lastRunDurationMs / 1000))}s`,
      state: "running",
    });
  }
  const category = sessionActivityCategory(status, input.activity);
  if (category === "working" || category === "opening" || category === "background") {
    rows.push({
      id: "activity",
      label: category === "opening" ? "Opening this session" : input.activity?.label ?? "Working",
      detail: input.activity?.detail ?? (status.isCompacting ? "compacting" : status.isBashRunning ? "running a command" : ""),
      state: "running",
    });
  }
  if (category === "error") {
    rows.push({ id: "error", label: "The last run ended in an error", detail: input.activity?.detail ?? "", state: "failed" });
  }
  if (status.isStopping === true) {
    rows.push({ id: "stopping", label: "Stopping the run you stopped", detail: "", state: "running" });
  }
  return rows;
}
