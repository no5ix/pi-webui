import type { SessionActivityCategory } from "../../../shared/sessionActivityState";
import type { SessionInfo } from "../api";
import { sessionLabel } from "../sessionLabels";
import { compactAge } from "./compactSpan";

/** How many of a project's sessions the sidebar lists before "Show N more". */
export const SIDEBAR_SESSIONS_BEFORE_FOLD = 5;

/** One session row inside a project group. */
export interface ProjectSessionRow {
  id: string;
  label: string;
  /** The session's state, or unknown when no status has answered for it. */
  state: SessionActivityCategory | "unknown";
  /** How long ago the session last moved; absent when its listing carries no time. */
  age: string | undefined;
  /** When the session last moved, for ordering. */
  activityAt: number;
  /** Its stored folder is gone, so the row cannot be opened. */
  unopenable: boolean;
  selected: boolean;
}

/** One project and the sessions that run in it. */
export interface ProjectSessionGroup {
  projectId: string;
  name: string;
  path: string;
  /** The project's folder is gone: the group is shown and marked, never opened. */
  folderMissing: boolean;
  expanded: boolean;
  /** Every session in the group, matching the query when one is typed. */
  total: number;
  rows: ProjectSessionRow[];
  /** How many matching sessions the folded group is not showing. */
  hiddenCount: number;
}

export interface ProjectSessionModel {
  groups: ProjectSessionGroup[];
  /** Sessions listed across all groups, matching the query. */
  sessionTotal: number;
  /** Whether a query narrowed anything. */
  filtering: boolean;
}

interface ProjectLike {
  id: string;
  name: string;
  path?: string;
  folderMissing?: boolean;
}

interface WorkspaceLike {
  id: string;
  path: string;
  projectId?: string;
}

/**
 * The sidebar's project tree: every project, and the sessions that run in it.
 *
 * A session knows the folder it runs in, not the project it belongs to, so the
 * folders of each project are the join. A folder the app has never seen under a
 * project is matched by path prefix, which is how a session in a project's own
 * root lands under the right project before its workspace has been listed.
 *
 * A session that matches no project is left out, not filed under a synthetic
 * "Other": inventing a group the app cannot navigate to is the fake-data failure.
 * A search expands the groups it matches, so a reader who types a name is not
 * asked to open each project to find it.
 */
export function projectSessionModel(input: {
  projects: readonly ProjectLike[];
  workspaces: readonly WorkspaceLike[];
  sessions: readonly SessionInfo[];
  sessionStates: ReadonlyMap<string, SessionActivityCategory>;
  expandedProjectIds: ReadonlySet<string>;
  /** Groups whose "Show N more" the reader pressed: every matching row shows, not just the recent few. */
  revealedProjectIds?: ReadonlySet<string>;
  selectedProjectId: string | undefined;
  selectedSessionId: string | undefined;
  query: string;
  now?: number;
}): ProjectSessionModel {
  const now = input.now ?? Date.now();
  const query = input.query.trim().toLowerCase();
  const filtering = query !== "";
  const rowsByProject = new Map<string, ProjectSessionRow[]>();
  const workspaceProjects = new Map(input.workspaces.map((workspace) => [workspace.path, workspace.projectId]));
  for (const session of input.sessions) {
    if (session.archived === true) continue;
    const label = sessionLabel(session);
    if (filtering && !sessionMatches(session, label, query)) continue;
    const projectId = projectOf(session.cwd, input.projects, workspaceProjects);
    if (projectId === undefined) continue;
    const list = rowsByProject.get(projectId) ?? [];
    const activityAt = parseMillis(session.modified);
    list.push({
      id: session.id,
      label,
      state: input.sessionStates.get(session.id) ?? "unknown",
      age: compactAge(session.modified, now),
      activityAt: activityAt ?? 0,
      unopenable: session.cwdMissing === true,
      selected: session.id === input.selectedSessionId,
    });
    rowsByProject.set(projectId, list);
  }

  const groups = input.projects
    .map((project) => {
      const rows = (rowsByProject.get(project.id) ?? []).slice().sort((a, b) => b.activityAt - a.activityAt);
      const expanded = filtering || input.expandedProjectIds.has(project.id) || project.id === input.selectedProjectId;
      const revealed = filtering || input.revealedProjectIds?.has(project.id) === true;
      const shown = expanded ? (revealed ? rows : rows.slice(0, SIDEBAR_SESSIONS_BEFORE_FOLD)) : [];
      return {
        projectId: project.id,
        name: project.name,
        path: project.path ?? "",
        folderMissing: project.folderMissing === true,
        expanded,
        total: rows.length,
        rows: shown,
        hiddenCount: Math.max(0, rows.length - shown.length),
      } satisfies ProjectSessionGroup;
    })
    .filter((group) => !filtering || group.total > 0);

  return {
    groups,
    sessionTotal: groups.reduce((sum, group) => sum + group.total, 0),
    filtering,
  };
}

/** The project a session runs in: its folder's project, else the project whose path contains it. */
export function projectOf(
  cwd: string,
  projects: readonly ProjectLike[],
  workspaceProjects: ReadonlyMap<string, string | undefined>,
): string | undefined {
  const fromWorkspace = workspaceProjects.get(cwd);
  if (fromWorkspace !== undefined) return fromWorkspace;
  let best: { id: string; path: string } | undefined;
  for (const project of projects) {
    const path = project.path;
    if (path === undefined || path === "") continue;
    if (cwd !== path && !cwd.startsWith(`${path}/`)) continue;
    if (best === undefined || path.length > best.path.length) best = { id: project.id, path };
  }
  return best?.id;
}

function sessionMatches(session: SessionInfo, label: string, query: string): boolean {
  if (label.toLowerCase().includes(query)) return true;
  const name = session.name?.toLowerCase() ?? "";
  if (name !== "" && name.includes(query)) return true;
  return session.firstMessage.toLowerCase().includes(query);
}

function parseMillis(iso: string): number | undefined {
  const at = Date.parse(iso);
  return Number.isFinite(at) ? at : undefined;
}
