import type { SessionInfo, SessionSubsessionInfo } from "../api";
import { sessionLabel } from "../sessionLabels";

/** What a child session is doing, as its parent's daemon reports it. */
export type SubagentState = "working" | "idle" | "error" | "unknown";

export interface SubagentRow {
  id: string;
  /** The child's own name, when the browser has its listing; absent for a child it has not listed. */
  label: string | undefined;
  /** The folder the child works in, always known: it is what the parent's daemon tracks. */
  folder: string;
  state: SubagentState;
  openable: boolean;
}

/**
 * The children of one session, as rows.
 *
 * These are sessions this app spawned on the parent's behalf (`GET
 * /sessions/:id/subsessions`), which is what the daemon can name. pi's own
 * subagent runs belong to the subagents plugin: a surface that shows children
 * shows these, and the plugin's panel is where its runs are listed. The two are
 * never merged into one count, and a branch of the conversation is neither.
 */
export function subagentRows(
  subsessions: readonly SessionSubsessionInfo[],
  knownSessions: ReadonlyMap<string, SessionInfo>,
): SubagentRow[] {
  return subsessions.map((child) => {
    const session = knownSessions.get(child.sessionId);
    return {
      id: child.sessionId,
      label: session === undefined ? undefined : sessionLabel(session),
      folder: folderName(child.cwd),
      state: child.status,
      openable: session?.cwdMissing !== true,
    };
  }).sort((a, b) => (rank(a.state) - rank(b.state)) || (a.label ?? a.folder).localeCompare(b.label ?? b.folder));
}

/** The folder a child works in, named the way a sidebar names a project. */
export function folderName(cwd: string): string {
  if (cwd === "") return "unknown folder";
  const trimmed = cwd.length > 1 && cwd.endsWith("/") ? cwd.slice(0, -1) : cwd;
  const slash = trimmed.lastIndexOf("/");
  return slash === -1 || slash === trimmed.length - 1 ? trimmed : trimmed.slice(slash + 1);
}

function rank(state: SubagentState): number {
  return state === "working" ? 0 : state === "error" ? 1 : state === "idle" ? 2 : 3;
}
