import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { DESKTOP_SIDE_BY_SIDE_MEDIA_QUERY, PHONE_LAYOUT_MEDIA_QUERY } from "../../breakpoints";
import type { Project, SessionInfo, SessionRef, Workspace } from "../../../../shared/apiTypes";
import { useBoard } from "../state/board";
import { usePanels, usePanelPersistence, setPanelWidth, togglePanel, type ResizablePanelSide } from "../state/panels";
import { useProjects, readProjects } from "../state/projectsStore";
import { selectSession, useSelection } from "../state/selection";
import { useSessionStreamSession } from "../state/sessionStream";
import { useThemeSystemFollow } from "../state/theme";
import { useSelectionUrl } from "../state/selection";
import { dragPanelWidth, keyboardPanelWidth, panelConstraints } from "../state/panels";
import { CommandPalette } from "../components/common/CommandPalette";
import { QuickSwitcher } from "../components/common/QuickSwitcher";
import { SettingsOverlay } from "../components/common/SettingsOverlay";
import { NewProjectDialog } from "../components/common/NewProjectDialog";
import { Toasts } from "../components/common/Toasts";
import { WindowBar } from "./WindowBar";
import { NavigationPanel } from "../components/navigation/NavigationPanel";
import { ConversationPanel } from "../components/conversation/ConversationPanel";
import { WorkbenchPanel } from "../components/workbench/WorkbenchPanel";
import { selectWorkbenchTab } from "../state/shellCommands";
import { useShellShortcuts } from "../state/shellShortcuts";

/**
 * The application shell.
 *
 * It owns three things and nothing else: the columns (widths, collapse, which
 * column a phone is looking at), the subject (the machine, project, workspace
 * and session the URL names), and the layers (palette, switcher, settings,
 * dialogs, toasts). Every panel is handed its subject and reads its own data;
 * the shell never reaches into a panel's state.
 */
export type ShellLayout = "three" | "two" | "phone";

export interface Subject {
  machineId: string;
  project: Project | undefined;
  workspace: Workspace | undefined;
  session: SessionRef | undefined;
  sessionInfo: SessionInfo | undefined;
}

export function AppShell(): ReactNode {
  const board = useBoard();
  const projects = useProjects();
  const panels = usePanels();
  const selected = useSelection();
  const [layout, setLayout] = useState<ShellLayout>(readLayout);
  const [layer, setLayer] = useState<Layer>("none");
  const dragging = useRef<ResizablePanelSide | undefined>(undefined);

  usePanelPersistence();
  useSelectionUrl();
  useThemeSystemFollow();

  useEffect(() => {
    void readProjects(selected.machineId);
  }, [selected.machineId]);

  useEffect(() => {
    const onResize = (): void => setLayout(readLayout());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const subject = useMemo<Subject>(() => resolveSubject(board, projects.projects, selected), [board, projects.projects, selected]);
  useSessionStreamSession(subject.session, selected.machineId);

  const grid = useMemo(() => gridTemplate(panels, layout), [panels, layout]);

  const onNavigate = useCallback((session: SessionInfo, workspace: Workspace): void => {
    selectSession({
      machineId: selected.machineId,
      projectId: workspace.projectId,
      workspaceId: workspace.id,
      sessionId: session.id,
    });
    if (layout === "phone") setLayer("none");
  }, [layout, selected.machineId]);

  useShellShortcuts({
    onCommandPalette: () => setLayer("palette"),
    onQuickSwitcher: () => setLayer("switcher"),
    onSettings: () => setLayer("settings"),
    onToggleNavigation: () => togglePanel("navigation"),
    onToggleWorkbench: () => togglePanel("workspace"),
    onWorkbenchTab: (tab) => selectWorkbenchTab(tab),
  });

  const columns = (
    <div
      className="piw-columns"
      data-layout={layout}
      data-navigation-collapsed={String(panels.navigationCollapsed)}
      data-workbench-collapsed={String(panels.workbenchCollapsed)}
      style={{ "--piw-columns-template": grid } as CSSProperties}
    >
      {showsNavigation(layout, panels) === true ? (
        <>
          <section aria-label="Navigation" className="piw-panel piw-panel--navigation">
            <NavigationPanel machineId={selected.machineId} onNavigate={onNavigate} onNewProject={() => setLayer("new-project")} onQuickSwitcher={() => setLayer("switcher")} />
          </section>
          <ResizeHandle side="navigation" />
        </>
      ) : null}
      <section aria-label="Conversation" className="piw-panel piw-panel--conversation">
        <ConversationPanel machineId={selected.machineId} subject={subject} layout={layout} onOpenSettings={() => setLayer("settings")} />
      </section>
      {showsWorkbench(layout, panels) === true ? (
        <>
          <ResizeHandle side="workspace" />
          <section aria-label="Workbench" className="piw-panel piw-panel--workbench">
            <WorkbenchPanel machineId={selected.machineId} subject={subject} />
          </section>
        </>
      ) : null}
    </div>
  );

  return (
    <div className="piw-canvas" data-dragging={dragging.current === undefined ? "false" : "true"}>
      <div className="piw-window">
        <WindowBar
          machineId={selected.machineId}
          subject={subject}
          layout={layout}
          onCommandPalette={() => setLayer("palette")}
          onQuickSwitcher={() => setLayer("switcher")}
          onSettings={() => setLayer("settings")}
        />
        {columns}
      </div>
      <CommandPalette open={layer === "palette"} onClose={() => setLayer("none")} machineId={selected.machineId} subject={subject} />
      <QuickSwitcher open={layer === "switcher"} onClose={() => setLayer("none")} machineId={selected.machineId} />
      <SettingsOverlay open={layer === "settings"} onClose={() => setLayer("none")} machineId={selected.machineId} />
      <NewProjectDialog open={layer === "new-project"} onClose={() => setLayer("none")} machineId={selected.machineId} />
      <Toasts />
    </div>
  );
}

type Layer = "none" | "palette" | "switcher" | "settings" | "new-project";

function ResizeHandle(props: { side: ResizablePanelSide }): ReactNode {
  const panels = usePanels();
  const constraints = panelConstraints(props.side);
  const start = useRef<{ x: number; width: number } | undefined>(undefined);
  const [dragging, setDragging] = useState(false);
  const width = props.side === "navigation" ? panels.navigationWidth : panels.workbenchWidth;

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId);
    start.current = { x: event.clientX, width };
    setDragging(true);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const origin = start.current;
    if (origin === undefined) return;
    setPanelWidth(props.side, dragPanelWidth(props.side, origin.width, origin.x, event.clientX));
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    start.current = undefined;
    setDragging(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    const next = keyboardPanelWidth(props.side, width, event.key);
    if (next === undefined) return;
    event.preventDefault();
    setPanelWidth(props.side, next);
  };

  return (
    <button
      aria-label={`${props.side === "navigation" ? "Navigation" : "Workbench"} width`}
      aria-orientation="vertical"
      aria-valuemax={constraints.maxWidth}
      aria-valuemin={constraints.minWidth}
      aria-valuenow={width}
      className="piw-resize-handle"
      data-dragging={String(dragging)}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      role="separator"
      tabIndex={0}
      type="button"
    />
  );
}

function readLayout(): ShellLayout {
  if (window.matchMedia(PHONE_LAYOUT_MEDIA_QUERY).matches) return "phone";
  if (window.matchMedia(DESKTOP_SIDE_BY_SIDE_MEDIA_QUERY).matches) return "three";
  return "two";
}

function showsNavigation(layout: ShellLayout, panels: { navigationCollapsed: boolean }): boolean {
  if (layout === "phone") return !panels.navigationCollapsed;
  return !panels.navigationCollapsed;
}

function showsWorkbench(layout: ShellLayout, panels: { workbenchCollapsed: boolean }): boolean {
  if (panels.workbenchCollapsed) return false;
  if (layout === "phone") return false;
  return true;
}

function gridTemplate(panels: { navigationCollapsed: boolean; navigationWidth: number; workbenchCollapsed: boolean; workbenchWidth: number }, layout: ShellLayout): string {
  if (layout === "phone") return "minmax(0, 1fr)";
  const navigation = panels.navigationCollapsed ? [] : [`${String(panels.navigationWidth)}px`, "7px"];
  const workbench = panels.workbenchCollapsed ? [] : ["7px", `${String(panels.workbenchWidth)}px`];
  return [...navigation, "minmax(0, 1fr)", ...workbench].join(" ");
}

/**
 * The URL names a session; the board says where it lives. A session the board
 * has is opened at its own workspace, and a selection that named a project
 * opens that project's main workspace, so a bookmark and a click land on the
 * same subject.
 */
export function resolveSubject(board: ReturnType<typeof useBoard>, projects: readonly Project[], selected: ReturnType<typeof useSelection>): Subject {
  const sessions = board.board?.sessions ?? [];
  const workspaces = board.board?.workspaces ?? [];
  const sessionInfo = selected.sessionId === undefined ? undefined : sessions.find((session) => session.id === selected.sessionId);
  const sessionWorkspace = sessionInfo === undefined ? undefined : workspaces.find((workspace) => workspace.path === sessionInfo.cwd);
  const project = projects.find((candidate) => candidate.id === selected.projectId);
  const workspace =
    workspaces.find((candidate) => candidate.id === selected.workspaceId)
    ?? sessionWorkspace
    ?? workspaces.find((candidate) => candidate.projectId === selected.projectId && candidate.isMain)
    ?? workspaces.find((candidate) => candidate.projectId === selected.projectId);
  const session: SessionRef | undefined = sessionInfo === undefined
    ? (selected.sessionId === undefined || selected.sessionId === "" ? undefined : { id: selected.sessionId, cwd: workspace?.path ?? "" })
    : { id: sessionInfo.id, cwd: sessionInfo.cwd };
  return {
    machineId: selected.machineId,
    project: project ?? (workspace === undefined ? undefined : projects.find((candidate) => candidate.id === workspace.projectId)),
    workspace,
    session,
    sessionInfo,
  };
}
