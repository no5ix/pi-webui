import { initialAppState, type AppState, type MachinesLoadState, type ProjectsLoadState, type SessionsLoadState } from "../../appState";
import type { MachineHealth, SessionStatus, Workspace } from "../../../../shared/apiTypes";
import type { QualifiedContributionId } from "../../plugins/ids";
import type { WorkbenchTab } from "../state/panels";
import { boardStore } from "../state/board";
import { composerStore } from "../state/composerStore";
import { machinesStore } from "../state/machinesStore";
import { panelStore } from "../state/panels";
import { projectsStore } from "../state/projectsStore";
import { selection } from "../state/selection";
import { streamStore } from "../state/sessionStream";

/**
 * The app state a plugin is handed, projected from the React stores.
 *
 * The plugin API speaks one shape - `AppState` - because that is what every
 * contributed renderer, panel and action reads. The React shell keeps its state
 * in per-surface stores, so this module is the translation: it fills every field
 * the shell genuinely has, and starts from `initialAppState()` for the rest, so a
 * plugin reads a real empty rather than an invented value.
 *
 * Fields the React shell does not carry today, said plainly: the machine runtime
 * and status trees (only the roster and health are read), the command ledger,
 * message notes, the outbox, workspace deletion runs, the dialog states for the
 * model/thinking/theme pickers (React owns those pickers in its own surfaces),
 * and the page notice (the React shell reports through toasts, so `error` stays
 * empty). A plugin that needs one of those sees the empty state, which is the
 * truth, not a plausible value.
 */
export function pluginAppState(): AppState {
  const machines = machinesStore.get();
  const projects = projectsStore.get();
  const board = boardStore.get();
  const stream = streamStore.get();
  const panels = panelStore.get();
  const composer = composerStore.get();
  const selected = selection.get();

  const workspaces = allWorkspaces(projects.workspacesByProject);
  const boardSessions = board.board?.sessions ?? [];
  const selectedSession = boardSessions.find((session) => session.id === selected.sessionId);
  const sending = composer.sendingSessionId;

  const machineStatuses: Record<string, MachineHealth> = {};
  for (const [machineId, health] of machines.health) machineStatuses[machineId] = health;

  const sessionStatuses: Record<string, SessionStatus> = {};
  for (const [sessionId, status] of board.statuses) sessionStatuses[sessionId] = status;
  const sessionActivities: Record<string, AppState["sessionActivities"][string]> = {};
  for (const [sessionId, activity] of board.activities) sessionActivities[sessionId] = activity;

  const workspacesByProjectId: Record<string, Workspace[]> = {};
  for (const [projectId, list] of projects.workspacesByProject) workspacesByProjectId[projectId] = [...list];

  return {
    ...initialAppState(),
    machines: [...machines.machines],
    selectedMachine: machines.machines.find((machine) => machine.id === selected.machineId),
    machinesLoad: machinesLoadOf(machines.read.phase),
    machineStatuses,
    projects: [...projects.projects],
    projectsLoad: projectsLoadOf(projects.read.phase),
    workspaces,
    workspacesByProjectId,
    isLoadingWorkspaces: projects.loadingWorkspaces.size > 0,
    sessions: [...boardSessions],
    sessionsLoad: sessionsLoadOf(board.phase),
    sessionStatuses,
    sessionActivities,
    selectedProject: projects.projects.find((project) => project.id === selected.projectId),
    selectedWorkspace: workspaces.find((workspace) => workspace.id === selected.workspaceId),
    selectedSession,
    messages: [...stream.messages],
    messagePageStart: stream.pageStart,
    messagePageEnd: stream.pageEnd,
    messagePageTotal: stream.total,
    isOpeningSession: stream.connection === "opening",
    pageReadEnd: pageReadEndOf(stream.loadingOlder, stream.loadingNewer),
    transcriptFailed: stream.messages.length === 0 ? stream.error : undefined,
    status: stream.status,
    activity: stream.activity,
    statusArrival: stream.status === undefined && stream.loading ? "on-its-way" : "none",
    availableThinkingLevels: [...(composer.levels.value ?? [])],
    pendingDialogs: [...(stream.status?.pendingDialogs ?? [])],
    sendingPrompts: sending === undefined ? {} : { [sending]: true },
    streamBehind: stream.connection === "gap" ? { machineId: selected.machineId, since: Date.now() } : undefined,
    workspaceTool: panels.workbenchTab === "plugin" ? (panels.activePluginTab ?? shellWorkspaceToolIds.plugin) : shellWorkspaceToolIds[panels.workbenchTab],
    mainView: panels.mainView,
  };
}

function allWorkspaces(byProject: ReadonlyMap<string, readonly Workspace[]>): Workspace[] {
  const out: Workspace[] = [];
  for (const [, list] of byProject) out.push(...list);
  return out;
}

function machinesLoadOf(phase: string): MachinesLoadState {
  if (phase === "ready") return "loaded";
  return phase === "loading" ? "loading" : "unloaded";
}

function projectsLoadOf(phase: string): ProjectsLoadState {
  if (phase === "ready") return "loaded";
  return phase === "loading" ? "loading" : "unloaded";
}

function sessionsLoadOf(phase: string): SessionsLoadState {
  if (phase === "live" || phase === "partial" || phase === "refused") return "loaded";
  return phase === "loading" ? "loading" : "unloaded";
}

function pageReadEndOf(older: boolean, newer: boolean): AppState["pageReadEnd"] {
  if (older) return "earlier";
  if (newer) return "newer";
  return undefined;
}

/**
 * The workbench tabs the React shell owns, named under the shell's own scope. The
 * projection must report a qualified id, and the honest one is the shell's - a
 * plugin's page reports its own qualified id, and the shell's tabs are not the
 * plugin's to claim.
 */
const shellWorkspaceToolIds: Record<WorkbenchTab, QualifiedContributionId> = {
  git: "pi-web-react:git",
  files: "pi-web-react:files",
  terminal: "pi-web-react:terminal",
  goals: "pi-web-react:goals",
  plugin: "pi-web-react:none",
};

