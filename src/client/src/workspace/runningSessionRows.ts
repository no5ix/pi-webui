import { isSessionActive } from "../../../shared/activity";
import { sessionActivityCategory, type SessionActivityCategory } from "../../../shared/sessionActivityState";
import type { SessionActivity, SessionInfo, SessionStatus } from "../api";
import { sessionLabel } from "../sessionLabels";
import { compactElapsedSince } from "./compactSpan";

/** One row of the running list: a session that has work a reader could stop or must wait for. */
export interface RunningSessionRow {
  id: string;
  label: string;
  /** The one category the rest of the app uses for this session, or unknown before a status answers. */
  state: SessionActivityCategory | "unknown";
  /** How long the working turn has been running, from the daemon's own turn start. Absent when it has not answered. */
  elapsed: string | undefined;
  /** When the session last moved, for ordering and the row's tooltip. */
  activityAt: number;
}

/**
 * The sessions that are genuinely running, newest work first.
 *
 * "Running" is the app's own classifier (`isSessionActive`), never the presence
 * of a row: an idle session in the list is a lie about work in progress, and a
 * session the daemon says is working is not hidden because a listing is stale.
 * A session with neither a status nor an activity is not claimed as running —
 * an unknown is not a yes.
 */
export function runningSessionRows(input: {
  sessions: readonly SessionInfo[];
  statuses: Readonly<Record<string, SessionStatus>>;
  activities: Readonly<Record<string, SessionActivity>>;
  now?: number;
}): RunningSessionRow[] {
  const now = input.now ?? Date.now();
  return input.sessions
    .filter((session) => session.archived !== true)
    .filter((session) => isSessionActive(input.statuses[session.id], input.activities[session.id]))
    .map((session): RunningSessionRow => {
      const status = input.statuses[session.id];
      const activity = input.activities[session.id];
      const category = sessionActivityCategory(status, activity);
      const moved = parseMillis(status?.lastActivityAt) ?? parseMillis(session.modified);
      return {
        id: session.id,
        label: sessionLabel(session),
        state: category ?? "unknown",
        elapsed: status?.isStreaming === true || status?.isBashRunning === true || status?.isCompacting === true
          ? compactElapsedSince(status.turnStartedAt ?? activity?.at, now)
          : undefined,
        activityAt: moved ?? 0,
      };
    })
    .sort((a, b) => b.activityAt - a.activityAt);
}

function parseMillis(iso: string | undefined): number | undefined {
  if (iso === undefined || iso === "") return undefined;
  const at = Date.parse(iso);
  return Number.isFinite(at) ? at : undefined;
}
