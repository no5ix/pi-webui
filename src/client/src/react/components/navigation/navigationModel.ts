import { isSessionActive } from "../../../../../shared/activity";
import type { MachinePins } from "../../../api/clients";
import type { Project, SessionActivity, SessionInfo, SessionStatus, SessionUnreadSummary, Workspace } from "../../../../../shared/apiTypes";
import { modifiedMs } from "../../../sessionOrder";
import { sessionLabel } from "../../../sessionLabels";
import { pinnedProjectIds, sessionCapFor } from "../../state/navStore";

/**
 * The navigation list, worked out before it is drawn.
 *
 * Every row the rail shows is derived from three sources that arrive at
 * different times — the project list, the machine's board (workspaces,
 * sessions, statuses, activity, unread) and the machine's pins — and the rail
 * must never present an unanswered source as an empty one. Keeping the
 * derivation here makes the rules one plain function the panel executes: which
 * sessions are running, which sessions belong to a project, what the search
 * keeps, in what order, and how many rows a project lists before a "Show N
 * more" row.
 */

/** One session row, with the scope it was fetched for attached to it. */
export interface SessionRowFacts {
  readonly session: SessionInfo;
  readonly workspace: Workspace | undefined;
  readonly status: SessionStatus | undefined;
  readonly activity: SessionActivity | undefined;
  readonly unread: SessionUnreadSummary | undefined;
  readonly pinned: boolean;
  readonly running: boolean;
  readonly selected: boolean;
}

/** One project and the sessions the rail lists under it. */
export interface ProjectGroup {
  readonly project: Project;
  readonly workspaces: readonly Workspace[];
  readonly sessions: readonly SessionRowFacts[];
  /** Sessions the project holds that the cap hides. */
  readonly hiddenCount: number;
  readonly pinned: boolean;
  /** The search matched the project itself, so the group lists its sessions unfiltered. */
  readonly projectMatched: boolean;
}

export interface BoardInput {
  readonly sessions: readonly SessionInfo[];
  readonly workspaces: readonly Workspace[];
  readonly statuses: ReadonlyMap<string, SessionStatus>;
  readonly activities: ReadonlyMap<string, SessionActivity>;
  readonly unread: ReadonlyMap<string, SessionUnreadSummary>;
  readonly pins: MachinePins | undefined;
  readonly selectedSessionId: string | undefined;
}

function workspaceByPath(workspaces: readonly Workspace[]): Map<string, Workspace> {
  const byPath = new Map<string, Workspace>();
  for (const workspace of workspaces) {
    if (!byPath.has(workspace.path)) byPath.set(workspace.path, workspace);
  }
  return byPath;
}

function rowFacts(session: SessionInfo, input: BoardInput, workspaces: Map<string, Workspace>, pinnedIds: ReadonlySet<string>): SessionRowFacts {
  const status = input.statuses.get(session.id);
  const activity = input.activities.get(session.id);
  return {
    session,
    workspace: workspaces.get(session.cwd),
    status,
    activity,
    unread: input.unread.get(session.id),
    pinned: pinnedIds.has(session.id),
    running: isSessionActive(status, activity),
    selected: input.selectedSessionId === session.id,
  };
}

const byNewestActivity = (a: SessionInfo, b: SessionInfo): number => modifiedMs(b.modified) - modifiedMs(a.modified);

/** Pinned first, then newest activity first. */
function orderedFacts(facts: readonly SessionRowFacts[]): SessionRowFacts[] {
  return [...facts].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return byNewestActivity(a.session, b.session);
  });
}

/**
 * The sessions running on this machine: a session is listed while it has work
 * in progress, which is the same test the rest of the product uses
 * (`isSessionActive`), so a session never runs in one panel and idles in
 * another.
 */
export function runningSessions(input: BoardInput): SessionRowFacts[] {
  const workspaces = workspaceByPath(input.workspaces);
  const pinnedIds = pinnedSessionSet(input.pins, undefined);
  const facts = input.sessions
    .filter((session) => session.archived !== true)
    .map((session) => rowFacts(session, input, workspaces, pinnedIds))
    .filter((row) => row.running);
  return orderedFacts(facts);
}

function projectWorkspacePaths(workspaces: readonly Workspace[], projectId: string): Set<string> {
  const paths = new Set<string>();
  for (const workspace of workspaces) {
    if (workspace.projectId === projectId) paths.add(workspace.path);
  }
  return paths;
}

function searchableSessionText(session: SessionInfo): string {
  return `${sessionLabel(session)}\n${session.cwd}`.toLowerCase();
}

function searchableProjectText(project: Project): string {
  return `${project.name}\n${project.path}`.toLowerCase();
}

export interface ProjectGroupsInput extends BoardInput {
  readonly projects: readonly Project[];
  readonly showArchived: boolean;
  readonly query: string;
  readonly caps: Readonly<Record<string, number>>;
}

/**
 * Projects with the sessions the rail lists under them.
 *
 * A session belongs to a project when its working directory is one of the
 * project's workspace paths, so the grouping follows the machine's workspace
 * list rather than a path prefix the browser guessed. Pinned projects come
 * first; the machine's own project order follows.
 */
export function projectGroups(input: ProjectGroupsInput): ProjectGroup[] {
  const workspaces = workspaceByPath(input.workspaces);
  const query = input.query.trim().toLowerCase();
  const pinnedProjects = pinnedProjectIds(input.pins);
  const groups: ProjectGroup[] = [];
  for (const project of input.projects) {
    const paths = projectWorkspacePaths(input.workspaces, project.id);
    const pinnedIds = pinnedSessionSet(input.pins, project.id);
    const projectMatched = query !== "" && searchableProjectText(project).includes(query);
    const facts = orderedFacts(
      input.sessions
        .filter((session) => paths.has(session.cwd))
        .filter((session) => input.showArchived || session.archived !== true)
        .filter((session) => projectMatched || query === "" || searchableSessionText(session).includes(query))
        .map((session) => rowFacts(session, input, workspaces, pinnedIds)),
    );
    if (query !== "" && !projectMatched && facts.length === 0) continue;
    const cap = sessionCapFor(input.caps, project.id);
    groups.push({
      project,
      workspaces: input.workspaces.filter((workspace) => workspace.projectId === project.id),
      sessions: facts.slice(0, cap),
      hiddenCount: Math.max(facts.length - cap, 0),
      pinned: pinnedProjects.has(project.id),
      projectMatched,
    });
  }
  return groups.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return 0;
  });
}

/** The sessions pinned where a row sits: machine-wide pins, plus a project's own. */
export function pinnedSessionSet(pins: MachinePins | undefined, projectId: string | undefined): ReadonlySet<string> {
  const ids = new Set(pins?.global ?? []);
  if (projectId === undefined) return ids;
  const own = pins?.projects?.get(projectId);
  if (own === undefined) return ids;
  for (const sessionId of own) ids.add(sessionId);
  return ids;
}

/** A compact age for a row's right edge: 3m, 12h, 2d. */
export function relativeTime(ms: number, nowMs: number): string {
  const age = nowMs - ms;
  if (age < 0) return "now";
  const minutes = Math.floor(age / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${String(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h`;
  return `${String(Math.floor(hours / 24))}d`;
}
