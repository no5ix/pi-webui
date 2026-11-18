import { useEffect, useMemo, useState, type ReactNode } from "react";
import { projectsApi, sessionsApi, sessionPinsApi } from "../../../api/clients";
import type { Project, SessionInfo, Workspace } from "../../../../../shared/apiTypes";
import { useBoard, boardRuntime } from "../../state/board";
import { useProjects, readProjects, readWorkspaces, closeProject } from "../../state/projectsStore";
import { useSelection, selectSession } from "../../state/selection";
import { registerShellCommands } from "../../state/shellCommands";
import { useNavigation, usePins, readPins, toggleProjectExpanded, expandProjects, collapseAllProjects, raiseSessionCap, setSearchText, toggleShowArchived } from "../../state/navStore";
import { IconButton } from "../common/icons";
import { ContextMenu, type ContextMenuItem } from "../common/ContextMenu";
import { LitBoundary } from "../common/LitBoundary";
import { ProjectRow, SessionRow, ShowMoreRow, StartingRow } from "./NavigationRows";
import { projectGroups, runningSessions, type BoardInput } from "./navigationModel";
import { projectMenuItems, sessionMenuItems, type SessionMenuFacts } from "./navigationMenus";
import { writeClipboardText } from "../../../clipboard";
import "./navigation.css";

/**
 * The left rail.
 *
 * It shows the machine's running sessions and the projects the reader opened,
 * built from the board, the project store and the machine's pins by one pure
 * function (`navigationModel`). A source that has not answered is named as such:
 * the rail never shows an unanswered read as an empty list.
 */
export interface NavigationPanelProps {
  machineId: string;
  onNavigate: (session: SessionInfo, workspace: Workspace) => void;
  onNewProject: () => void;
  onQuickSwitcher: () => void;
}

interface MenuState {
  anchor: DOMRect;
  items: readonly ContextMenuItem[];
}

interface Starting {
  label: string;
  problem: string | undefined;
}

export function NavigationPanel(props: NavigationPanelProps): ReactNode {
  const board = useBoard();
  const projects = useProjects();
  const navigation = useNavigation();
  const pins = usePins();
  const selection = useSelection();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [starting, setStarting] = useState<Starting | undefined>(undefined);
  const [renamingProject, setRenamingProject] = useState<Project | undefined>(undefined);
  const [renamingSession, setRenamingSession] = useState<SessionInfo | undefined>(undefined);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    void readProjects(props.machineId);
    void readPins(props.machineId);
    void boardRuntime.read({ force: true });
  }, [props.machineId]);

  useEffect(() => {
    const tick = window.setInterval(() => { setNowMs(Date.now()); }, 30_000);
    return () => { window.clearInterval(tick); };
  }, []);

  const workspaces = useMemo(() => mergeWorkspaces(board.board?.workspaces ?? [], projects.workspacesByProject), [board.board, projects.workspacesByProject]);

  const input: BoardInput = {
    sessions: board.board?.sessions ?? [],
    workspaces,
    statuses: board.statuses,
    activities: board.activities,
    unread: board.unread,
    pins: pins.value,
    selectedSessionId: selection.sessionId,
  };

  const running = useMemo(() => runningSessions(input), [board, pins, selection.sessionId, workspaces]);
  const groups = useMemo(
    () => projectGroups({ ...input, projects: projects.projects, showArchived: navigation.showArchived, query: navigation.searchText, caps: navigation.sessionCaps }),
    [board, pins, projects.projects, navigation, selection.sessionId, workspaces],
  );

  const startSession = (workspace: Workspace | undefined, project: Project | undefined): void => {
    if (workspace === undefined) {
      setStarting({ label: "This project has no workspace to start in", problem: "no workspace" });
      return;
    }
    const token = crypto.randomUUID();
    setStarting({ label: `Starting a session in ${workspace.label}`, problem: undefined });
    void sessionsApi
      .startSession(workspace.path, props.machineId, token)
      .then((created) => {
        setStarting(undefined);
        selectSession({ machineId: props.machineId, projectId: project?.id ?? workspace.projectId, workspaceId: workspace.id, sessionId: created.id });
        void boardRuntime.read({ force: true });
      })
      .catch((error: unknown) => {
        setStarting({ label: `Starting a session in ${workspace.label}`, problem: error instanceof Error ? error.message : String(error) });
      });
  };

  useEffect(() => {
    const unsubscribe = registerShellCommands([
      {
        id: "navigation.newSession",
        title: "New session",
        group: "Navigation",
        hint: "in the selected project",
        disabled: groups.length === 0 ? "No project is open" : undefined,
        run: () => {
          const group = groups.find((candidate) => candidate.sessions.some((row) => row.selected)) ?? groups[0];
          startSession(group?.workspaces[0], group?.project);
        },
      },
      { id: "navigation.quickSwitcher", title: "Quick switcher", group: "Navigation", hint: "⌘⇧P", run: () => { props.onQuickSwitcher(); }},
      { id: "navigation.expandAll", title: "Expand all projects", group: "Navigation", run: () => { expandProjects(groups.map((group) => group.project.id)); }},
      { id: "navigation.collapseAll", title: "Collapse all projects", group: "Navigation", run: () => { collapseAllProjects(); }},
    ]);
    return unsubscribe;
  }, [groups, props, startSession]);

  const openRow = (session: SessionInfo, workspace: Workspace | undefined): void => {
    props.onNavigate(session, workspace ?? fallbackWorkspace(session, workspaces));
  };

  return (
    <div className="piw-navigation" data-testid="navigation-panel">
      <div className="piw-navigation__search">
        <label className="piw-field">
          <span className="piw-label">Search sessions and projects</span>
          <input
            className="piw-input"
            onKeyDown={(event) => {
              if (event.key === "Escape") setSearchText("");
            }}
            onChange={(event) => { setSearchText(event.target.value); }}
            placeholder="Search"
            type="search"
            value={navigation.searchText}
          />
        </label>
      </div>

      <section className="piw-navigation__section">
        <header className="piw-section-header">
          <span className="piw-section-header__title">Running Sessions</span>
          <span className="piw-section-header__count">{board.board === undefined ? "?" : String(running.length)}</span>
          <span className="piw-section-header__spacer" />
          <IconButton icon="command" label="Quick switcher" onClick={() => { props.onQuickSwitcher(); }} />
        </header>
        {board.board === undefined ? <p className="piw-empty">{board.phase === "failed" ? `The machine did not answer: ${board.error ?? "no reason given"}` : "Reading this machine's sessions…"}</p> : null}
        <ul className="piw-navigation__list">
          {running.map((facts) => (
            <SessionRow
              key={facts.session.id}
              facts={facts}
              nowMs={nowMs}
              onOpen={() => { openRow(facts.session, facts.workspace); }}
              onMenu={(anchor) => { setMenu({ anchor, items: sessionMenu(facts.session, facts.pinned, facts.workspace, props.machineId, { setMenu: () => { setMenu(null); }, startSession, rename: setRenamingSession, refresh: refreshAll }) }); }}
              showPath={navigation.searchText !== ""}
            />
          ))}
        </ul>
      </section>

      <div className="piw-navigation__divider" />

      <section className="piw-navigation__section">
        <header className="piw-section-header">
          <span className="piw-section-header__title">Projects</span>
          <span className="piw-section-header__count">{String(groups.length)}</span>
          <span className="piw-section-header__spacer" />
          <IconButton icon="plus" label="Add a project" onClick={() => { props.onNewProject(); }} />
        </header>
        {pins.phase === "failed" ? <p className="piw-navigation__note">Pins are unknown: {pins.error ?? "the machine did not answer"}</p> : null}
        {projects.read.phase === "failed" ? <p className="piw-navigation__note">Projects are unknown: {projects.read.error ?? "the machine did not answer"}</p> : null}
        <ul className="piw-navigation__list">
          {groups.map((group) => {
            const expanded = navigation.expandedProjectIds.includes(group.project.id);
            return (
              <li className="piw-navigation__group" key={group.project.id}>
                <ProjectRow
                  expanded={expanded}
                  onMenu={(anchor) => { setMenu({ anchor, items: projectMenu(group.project, group.workspaces, group.pinned, navigation.showArchived, props.machineId, { startSession, rename: setRenamingProject, refresh: refreshAll, toggleArchived: toggleShowArchived }) }); }}
                  onToggle={() => {
                    toggleProjectExpanded(group.project.id);
                    if (!expanded) void readWorkspaces(group.project.id, props.machineId).catch(() => undefined);
                  }}
                  pinned={group.pinned}
                  project={group.project}
                  sessionCount={group.sessions.length + group.hiddenCount}
                />
                {expanded ? (
                  <ul className="piw-navigation__children">
                    {group.sessions.map((facts) => (
                      <SessionRow
                        key={facts.session.id}
                        facts={facts}
                        nowMs={nowMs}
                        onOpen={() => { openRow(facts.session, facts.workspace); }}
                        onMenu={(anchor) => { setMenu({ anchor, items: sessionMenu(facts.session, facts.pinned, facts.workspace, props.machineId, { setMenu: () => { setMenu(null); }, startSession, rename: setRenamingSession, refresh: refreshAll }) }); }}
                        showPath={navigation.searchText !== "" || group.projectMatched}
                      />
                    ))}
                    {group.hiddenCount === 0 ? null : <ShowMoreRow hiddenCount={group.hiddenCount} onShow={() => { raiseSessionCap(group.project.id); }} />}
                    {starting !== undefined && group.project.id === selection.projectId ? <StartingRow label={starting.label} onRetry={() => { startSession(group.workspaces[0], group.project); }} problem={starting.problem} /> : null}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
        {groups.length === 0 ? <p className="piw-empty">{navigation.searchText === "" ? "No projects are open on this machine." : "No project or session matches that search."}</p> : null}
      </section>

      <ContextMenu anchor={menu?.anchor ?? null} items={menu?.items ?? []} onClose={() => { setMenu(null); }} open={menu !== null} />

      {renamingProject !== undefined ? (
        <LitBoundary
          properties={{
            machineName: props.machineId,
            currentName: renamingProject.name,
            preview: (name: string | undefined, signal: AbortSignal) => projectsApi.renamePreview(renamingProject.id, name, props.machineId, { signal }),
            onSubmit: async (name: string) => {
              await projectsApi.renameProject(renamingProject.id, name, props.machineId);
              setRenamingProject(undefined);
              await refreshAll(props.machineId);
            },
            onCancel: () => { setRenamingProject(undefined); },
          }}
          tag="project-rename-dialog"
        />
      ) : null}

      {renamingSession !== undefined ? (
        <LitBoundary
          properties={{
            currentName: renamingSession.name ?? "",
            subject: "session",
            onSubmit: async (name: string) => {
              const trimmed = name.trim();
              if (trimmed === "") return;
              await sessionsApi.runCommand({ id: renamingSession.id, cwd: renamingSession.cwd }, `/name ${trimmed}`, props.machineId);
              setRenamingSession(undefined);
              await refreshAll(props.machineId);
            },
            onCancel: () => { setRenamingSession(undefined); },
          }}
          tag="session-rename-dialog"
        />
      ) : null}
    </div>
  );
}

interface Actions {
  setMenu: () => void;
  startSession: (workspace: Workspace | undefined, project: Project | undefined) => void;
  rename: (session: SessionInfo) => void;
  refresh: (machineId: string) => Promise<void>;
}

function sessionMenu(
  session: SessionInfo,
  pinned: boolean,
  workspace: Workspace | undefined,
  machineId: string,
  actions: Actions,
): ContextMenuItem[] {
  const facts: SessionMenuFacts = { pinned, archived: session.archived === true, hasParent: session.parentSessionPath !== undefined };
  const ref = { id: session.id, cwd: session.cwd };
  return sessionMenuItems(facts, {
    onOpen: () => { actions.setMenu(); },
    onRename: () => { actions.rename(session); },
    onTogglePin: () => {
      void sessionPinsApi.setPinned(session.id, !pinned, machineId).then(() => actions.refresh(machineId));
    },
    onContinueInNewSession: () => {
      void sessionsApi.continueInNewSession(ref, machineId).then(() => actions.refresh(machineId), () => actions.refresh(machineId));
    },
    onDetachParent: () => {
      void sessionsApi.detachParent(ref, machineId).then(() => actions.refresh(machineId));
    },
    onCopyPath: () => { void writeClipboardText(session.path); },
    onArchive: () => {
      void sessionsApi.archive(ref, machineId).then(() => actions.refresh(machineId));
    },
    onArchiveWithDescendants: () => {
      void sessionsApi.archiveWithDescendants(ref, machineId).then(() => actions.refresh(machineId));
    },
  });
}

interface ProjectActions {
  startSession: (workspace: Workspace | undefined, project: Project | undefined) => void;
  rename: (project: Project) => void;
  refresh: (machineId: string) => Promise<void>;
  toggleArchived: () => void;
}

function projectMenu(project: Project, workspaces: readonly Workspace[], pinned: boolean, showArchived: boolean, machineId: string, actions: ProjectActions): ContextMenuItem[] {
  return projectMenuItems({ pinned, showArchived }, {
    onNewSession: () => { actions.startSession(workspaces[0], project); },
    onRename: () => { actions.rename(project); },
    onTogglePin: () => {
      void sessionPinsApi.setProjectPinnedFlag(project.id, !pinned, machineId).then(() => actions.refresh(machineId));
    },
    onToggleArchived: () => { actions.toggleArchived(); },
    onClose: () => {
      void closeProject(project.id, machineId).then(() => actions.refresh(machineId));
    },
  });
}

async function refreshAll(machineId: string): Promise<void> {
  await Promise.all([readProjects(machineId), readPins(machineId), boardRuntime.read({ force: true })]);
}

function mergeWorkspaces(boardWorkspaces: readonly Workspace[], byProject: ReadonlyMap<string, readonly Workspace[]>): Workspace[] {
  const merged = new Map<string, Workspace>();
  for (const workspace of boardWorkspaces) merged.set(workspace.id, workspace);
  for (const workspaces of byProject.values()) {
    for (const workspace of workspaces) {
      if (!merged.has(workspace.id)) merged.set(workspace.id, workspace);
    }
  }
  return [...merged.values()];
}

function fallbackWorkspace(session: SessionInfo, workspaces: readonly Workspace[]): Workspace {
  const match = workspaces.find((workspace) => workspace.path === session.cwd);
  if (match !== undefined) return match;
  return {
    id: session.cwd,
    projectId: "",
    path: session.cwd,
    label: session.cwd.split("/").pop() ?? session.cwd,
    isMain: true,
    effectiveConfig: {},
  };
}

