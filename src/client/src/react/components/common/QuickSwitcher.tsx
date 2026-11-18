import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Machine, Project, SessionInfo } from "../../../../../shared/apiTypes";
import { machinesApi, sessionPinsApi } from "../../../api/clients";
import { LitBoundary } from "./LitBoundary";
import { useLayerKey, closeLayer } from "../../state/panels";
import { useBoard } from "../../state/board";
import { usePins, readPins } from "../../state/navStore";
import { useProjects } from "../../state/projectsStore";
import { selectSession, useSelection } from "../../state/selection";

/**
 * The session quick switcher.
 *
 * The browser's ⌘⇧P switcher is the app's own surface — its search, its unread
 * marks, its pin row — so React hosts it and feeds it the projection the rail
 * already keeps: the sessions this machine lists, the projects that name them,
 * the recorded pins, and whether the list has answered at all. Choosing a session
 * selects it in the shell; Escape, Back, or a click outside returns to the
 * workspace.
 */
export interface QuickSwitcherProps {
  onNewSession: () => void;
}

export function QuickSwitcher(props: QuickSwitcherProps): ReactNode {
  const layer = useLayerKey();
  const board = useBoard();
  const pins = usePins();
  const projects = useProjects();
  const selected = useSelection();
  const [machines, setMachines] = useState<readonly Machine[]>([]);

  useEffect(() => {
    void machinesApi.machines().then((answer) => { setMachines(answer); }, () => { setMachines([]); });
  }, []);

  useEffect(() => {
    void readPins(selected.machineId);
  }, [selected.machineId]);

  const pinnedIds = pins.value === undefined ? [] : pins.value.global;
  const firstMachine = machines[0];
  const machineId = firstMachine === undefined ? "local" : firstMachine.id;
  const sessions = useMemo(
    () => sessionsOf(board.board?.sessions ?? [], projects.projects, machineId, pinnedIds, board.unread),
    [board.board, board.unread, projects.projects, machineId, pinnedIds],
  );

  if (layer !== "switcher") return null;

  return (
    <LitBoundary
      onElement={(element) => {
        assign(element, "sessions", sessions);
        assign(element, "sessionsLoaded", board.board !== undefined);
        assign(element, "pinnedSessionIds", pinnedIds);
        assign(element, "onOpen", (session: { id: string; machineId?: string }) => {
          selectSession({ machineId: session.machineId ?? selected.machineId, sessionId: session.id });
          closeLayer();
        });
        assign(element, "onOpenPinned", (sessionId: string, pinned: boolean) => {
          void sessionPinsApi.setPinned(sessionId, pinned, selected.machineId).then(() => readPins(selected.machineId), () => undefined);
        });
        assign(element, "onNewSession", () => {
          closeLayer();
          props.onNewSession();
        });
        assign(element, "onCancel", closeLayer);
      }}
      tag="quick-switcher"
    />
  );
}

function sessionsOf(
  entries: readonly SessionInfo[],
  projects: readonly Project[],
  machineId: string,
  pins: readonly string[],
  unread: ReadonlyMap<string, { sessionId: string }>,
): readonly unknown[] {
  const projectByPath = new Map(projects.map((project) => [project.path, project]));
  return entries.map((info) => {
    const project = projectByPath.get(info.path);
    return {
      id: info.id,
      machineId,    
      label: info.name,
      sublabel: project?.name ?? info.cwd,
      status: "idle",
      unreadCount: unread.has(info.id) ? 1 : 0,
      unreadTools: 0,
      pinned: pins.includes(info.id),
      created: info.created,
      modified: info.modified,
    };
  });
}

function assign(element: HTMLElement, name: string, value: unknown): void {
  Reflect.set(element, name, value);
}
