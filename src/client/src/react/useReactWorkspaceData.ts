import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { configApi, pluginsApi, piPackagesApi, piSkillsApi, piMcpApi, sessionsApi, type Machine, type Project, type SessionInfo, type SessionStatus, type Workspace, type PiWebConfigResponse, type PiWebPluginsResponse, type PiPackagesResponse, type PiSkillsResponse, type PiMcpListResponse, type PiPackageScope, type PiMcpServerInfo, type PiMcpSaveRequest, type PiSkillInfo, type SessionModelCatalogResponse } from "../api";
import { initialAppState, type AppState } from "../appState";
import { ProjectController } from "../controllers/projectController";
import { WorkspaceController } from "../controllers/workspaceController";
import { MachineController } from "../controllers/machineController";
import { SessionBoardController } from "../controllers/sessionBoardController";
import { boardEventOf, boardSessionsOf, type SessionBoard } from "../sync/sessionBoard";
import type { Unanswered } from "../sync/scopedResource";
import { RealtimeSocket } from "../sessionSocket";
import { SessionController } from "../controllers/sessionController";
import { SessionStorageSessionSelectionMemory } from "../controllers/sessionSelection";
import { SessionStorageWorkspaceSelectionMemory } from "../controllers/workspaceSelection";
import { readRoute, writeRoute } from "../route";
import type { GetState, SetState, UpdateUrl } from "../controllers/types";
import { machineSessionKey } from "../machineKeys";
import { saveDraft, loadDraft } from "../promptDraftStorage";
import { operationKindOf, pageMaySend, writeOutgoingOperation } from "../composerWrites";
import { effectivePromptAttachmentDelivery, type CapturedAttachment } from "../promptAttachmentCapture";
import type { PromptAttachment } from "../api";
import { createConfigWriteQueue } from "./configWriteQueue";
import { instantRefusalWords, sessionsWithInstantActions, withoutInstantTargets } from "../instantActions";
import { createWorkspaceInstantActions, projectActionIsPending, projectActionTarget, projectCloseAdmission, sessionActionIsPending, sessionActionTarget } from "./reactInstantActions";
import type { InstantActionController } from "../controllers/instantActionController";
import type { InstantAction } from "../instantActions";
import type { ProjectTrustChoice } from "../controllers/projectController";

export interface ReactWorkspaceProject {
  readonly project: Project;
  readonly workspaces: readonly Workspace[];
  readonly sessions: readonly SessionInfo[];
  readonly unknown: boolean;
}

export interface ReactWorkspaceData {
  readonly state: AppState;
  readonly projects: readonly ReactWorkspaceProject[];
  readonly board: SessionBoard | undefined;
  readonly selectedProject: Project | undefined;
  readonly selectedWorkspace: Workspace | undefined;
  readonly selectedSession: SessionInfo | undefined;
  readonly messages: AppState["messages"];
  readonly sessionStatus: SessionStatus | undefined;
  readonly modelOptions: Awaited<ReturnType<typeof sessionsApi.models>> | undefined;
  readonly modelCatalog: SessionModelCatalogResponse | undefined;
  readonly thinkingOptions: Awaited<ReturnType<typeof sessionsApi.thinkingLevels>> | undefined;
  readonly settings: { config?: PiWebConfigResponse | undefined; plugins?: PiWebPluginsResponse | undefined; packages?: PiPackagesResponse | undefined; skills?: PiSkillsResponse | undefined; mcp?: PiMcpListResponse | undefined; loading: boolean; error?: string | undefined; notice?: string | undefined; scopeKey?: string | undefined };
  readonly loadSettings: () => Promise<void>;
  readonly saveSettings: (config: Partial<PiWebConfigResponse["config"]>) => Promise<void>;
  readonly setPluginEnabled: (id: string, enabled: boolean) => Promise<void>;
  readonly installPackage: (source: string) => Promise<void>;
  readonly updatePackage: (source?: string) => Promise<void>;
  readonly removePackage: (source: string, scope: PiPackageScope) => Promise<void>;
  readonly setSkillEnabled: (skill: PiSkillInfo, enabled: boolean) => Promise<void>;
  readonly setMcpEnabled: (server: PiMcpServerInfo, enabled: boolean) => Promise<void>;
  readonly testMcp: (server: PiMcpServerInfo) => Promise<void>;
  readonly removeMcp: (server: PiMcpServerInfo) => Promise<void>;
  readonly saveMcp: (save: PiMcpSaveRequest) => Promise<void>;
  readonly selectMachine: (machine: Machine) => Promise<void>;
  readonly addMachine: (input: { name: string; baseUrl: string; token?: string }) => Promise<void>;
  readonly renameMachine: (machine: Machine, name: string) => Promise<void>;
  readonly removeMachine: (machine: Machine) => Promise<void>;
  readonly loading: boolean;
  readonly projectsError: string | undefined;
  readonly machineReadIssue: string | undefined;
  readonly sessionError: string | undefined;
  readonly draft: string;
  readonly setDraft: (value: string) => void;
  readonly selectProject: (projectId: string) => Promise<void>;
  readonly selectSession: (session: SessionInfo) => Promise<void>;
  readonly refresh: () => void;
  readonly sendPrompt: (text: string, attachments?: readonly CapturedAttachment[]) => Promise<boolean>;
  readonly stopSession: () => Promise<void>;
  readonly loadEarlierMessages: () => Promise<void>;
  readonly renameSession: (session: SessionInfo, name: string) => Promise<void>;
  readonly archiveSession: (session: SessionInfo, machineId: string) => Promise<void>;
  readonly restoreSession: (session: SessionInfo, machineId: string) => Promise<void>;
  readonly deleteArchivedSession: (session: SessionInfo, machineId: string) => Promise<void>;
  readonly instantActions: readonly InstantAction[];
  readonly undoAvailable: boolean;
  readonly sessionActionNotice: string | undefined;
  readonly closeProject: (project: Project) => void;
  readonly addProject: (path: string, create: boolean, trust: ProjectTrustChoice | undefined, machineId: string) => Promise<string | undefined>;
  readonly undoSessionAction: () => void;
  readonly pauseSessionUndo: (reason: "pointer" | "focus") => void;
  readonly resumeSessionUndo: (reason: "pointer" | "focus") => void;
  readonly startSession: () => void;
  readonly runCommand: (text: string) => Promise<void>;
}

interface Runtime {
  getState: GetState;
  setState: SetState;
  projects: ProjectController;
  workspaces: WorkspaceController;
  machines: MachineController;
  sessions: SessionController;
  boards: SessionBoardController;
  instantActions: InstantActionController;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function machineIssueText(unanswered: Unanswered | undefined): string | undefined {
  if (unanswered === undefined) return undefined;
  const miss = unanswered.miss;
  if (miss.kind === "server-error") return miss.reason || "The PI WEB server reported an error.";
  if (miss.kind === "machine-unanswering") return `Machine ${miss.machineId} is not responding.`;
  if (miss.kind === "attachments-unreadable") return "The machine cannot read queued attachments.";
  return "Cannot reach the PI WEB API. Check that the web server is running, then retry.";
}

/**
 * React owns the view, while PI WEB's existing controllers continue to own
 * listing retries, route selection, transcript convergence, stream recovery,
 * command delivery, and the durable per-device outbox.
 */
export function useReactWorkspaceData(): ReactWorkspaceData {
  const stateRef = useRef<AppState>(initialAppState());
  const [state, setReactState] = useState<AppState>(stateRef.current);
  const [machineReadIssue, setMachineReadIssue] = useState<string>();
  const runtimeRef = useRef<Runtime | undefined>(undefined);
  const [modelOptions, setModelOptions] = useState<Awaited<ReturnType<typeof sessionsApi.models>>>();
  const [modelCatalog, setModelCatalog] = useState<SessionModelCatalogResponse>();
  const [thinkingOptions, setThinkingOptions] = useState<Awaited<ReturnType<typeof sessionsApi.thinkingLevels>>>();
  const [settings, setSettings] = useState<ReactWorkspaceData["settings"]>({ loading: false });
  const settingsSaveQueueRef = useRef(createConfigWriteQueue(
    (machineId: string) => configApi.config(machineId).then(response => response.config),
    (machineId: string, config: PiWebConfigResponse["config"]) => configApi.saveConfig(config, machineId),
  ));
  const [draft, setDraftState] = useState("");
  const [board, setBoard] = useState<SessionBoard>();
  const [instantActions, setInstantActions] = useState<readonly InstantAction[]>([]);
  const [undoAvailable, setUndoAvailable] = useState(false);
  const [sessionActionNotice, setSessionActionNotice] = useState<string>();
  const realtimeRef = useRef<RealtimeSocket | undefined>(undefined);

  if (runtimeRef.current === undefined) {
    const getState: GetState = () => stateRef.current;
    const workspaceControllerRef: { current: WorkspaceController | undefined } = { current: undefined };
    const projectControllerRef: { current: ProjectController | undefined } = { current: undefined };
    const setStatePatch: SetState = (patch) => {
      const previous = stateRef.current;
      const next = { ...previous, ...patch };
      stateRef.current = next;
      setReactState(next);
      if (previous.selectedProject?.id !== next.selectedProject?.id) workspaceControllerRef.current?.selectionChanged();
    };
    const updateUrl: UpdateUrl = (options) => {
      const current = readRoute();
      const currentState = stateRef.current;
      writeRoute({
        machineId: currentState.selectedMachine?.id === "local" ? undefined : currentState.selectedMachine?.id,
        projectId: currentState.selectedProject?.id,
        workspaceId: currentState.selectedWorkspace?.id,
        sessionId: currentState.selectedSession?.id,
        tool: current.tool,
        view: current.view,
      }, options);
    };
    const sessionController = new SessionController(
      getState,
      setStatePatch,
      updateUrl,
      new SessionStorageSessionSelectionMemory(),
      {
        urlSessionId: () => readRoute().sessionId,
        catalogue: {
          projects: (machineId, wanted) => projectControllerRef.current?.answeredProjects(machineId, wanted) ?? Promise.resolve(undefined),
          workspaces: (machineId, projectId, wanted) => workspaceControllerRef.current?.answeredWorkspaces(machineId, projectId, wanted) ?? Promise.resolve(undefined),
        },
      },
    );
    const workspaceController = new WorkspaceController(
      getState,
      setStatePatch,
      updateUrl,
      sessionController,
      new SessionStorageWorkspaceSelectionMemory(),
      { opensPreferredSession: () => true },
    );
    workspaceControllerRef.current = workspaceController;
    const projectController = new ProjectController(getState, setStatePatch, workspaceController);
    projectControllerRef.current = projectController;
    const machineController = new MachineController(getState, setStatePatch, updateUrl, projectController, (unanswered) => {
      setMachineReadIssue(machineIssueText(unanswered));
    });
    const boardController = new SessionBoardController({
      knownProjects: (machineId) => machineId === (getState().selectedMachine?.id ?? "local") && getState().projectsLoad === "loaded" ? getState().projects : undefined,
    });
    const instantActions = createWorkspaceInstantActions(sessionController, boardController, projectController, (actions, undo) => {
      setInstantActions(actions);
      setUndoAvailable(undo);
    }, setSessionActionNotice);
    runtimeRef.current = {
      getState,
      setState: setStatePatch,
      projects: projectController,
      workspaces: workspaceController,
      machines: machineController,
      sessions: sessionController,
      boards: boardController,
      instantActions,
    };
  }

  const runtime = runtimeRef.current;
  const refresh = useCallback(() => {
    runtime.machines.wake();
    runtime.projects.wake();
    runtime.workspaces.wake();
    runtime.sessions.kickOutbox();
  }, [runtime]);

  useEffect(() => {
    let active = true;
    runtime.sessions.startOutbox();
    const route = readRoute();
    void runtime.machines.loadMachines(route.machineId, () => active);
    const onOnline = () => {
      runtime.machines.wake();
      runtime.projects.wake();
      runtime.workspaces.wake();
      runtime.sessions.kickOutbox();
      void runtime.sessions.recheckTranscript();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") runtime.instantActions.pageShown();
      else runtime.instantActions.pageHidden();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    onVisibilityChange();
    window.addEventListener("online", onOnline);
    return () => {
      active = false;
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      realtimeRef.current?.close();
      realtimeRef.current = undefined;
      runtime.sessions.stopOutbox();
      runtime.sessions.dispose();
      runtime.instantActions.dispose();
      runtime.boards.dispose();
      runtime.workspaces.dispose();
      runtime.projects.dispose();
      runtime.machines.dispose();
    };
  }, [runtime]);

  const lastActionMachineRef = useRef(state.selectedMachine?.id ?? "local");
  useEffect(() => {
    const machineId = state.selectedMachine?.id ?? "local";
    if (lastActionMachineRef.current !== machineId) {
      runtime.instantActions.endWindow();
      lastActionMachineRef.current = machineId;
    }
  }, [state.selectedMachine?.id, runtime]);

  useEffect(() => {
    if (state.machinesLoad === "loaded" && state.projectsLoad === "unloaded") {
      void runtime.projects.loadProjects();
    }
  }, [state.machinesLoad, state.projectsLoad, runtime]);

  useEffect(() => {
    if (state.machinesLoad !== "loaded") return;
    const machineId = state.selectedMachine?.id ?? "local";
    let active = true;
    const release = runtime.boards.watch(machineId);
    const updateBoard = () => {
      if (active) setBoard(runtime.boards.board(machineId));
    };
    const unsubscribe = runtime.boards.subscribe(updateBoard);
    updateBoard();
    void runtime.boards.browse(machineId).then(updateBoard);

    const socket = new RealtimeSocket();
    realtimeRef.current?.close();
    realtimeRef.current = socket;
    socket.connect(
      (event) => {
        if (event.type === "status.update" || event.type === "activity.update" || event.type === "session.created" || event.type === "session.name" || event.type === "session.startup") {
          runtime.sessions.applyGlobalEvent(event);
        }
        const boardEvent = boardEventOf(event);
        if (boardEvent !== undefined) runtime.boards.applyEvent(machineId, boardEvent);
      },
      () => {
        if (!active) return;
        void runtime.boards.read(machineId);
        if (machineId === (stateRef.current.selectedMachine?.id ?? "local")) {
          void runtime.projects.loadProjects();
          void runtime.sessions.hydrateSessionStatuses(machineId, { replaceKnown: true });
          void runtime.sessions.refreshCurrentWorkspaceSessions(machineId);
        }
      },
      machineId,
      () => {
        if (!active) return;
        runtime.boards.missedAnnouncements(machineId);
        if (machineId === (stateRef.current.selectedMachine?.id ?? "local")) {
          void runtime.projects.loadProjects();
          void runtime.sessions.hydrateSessionStatuses(machineId, { replaceKnown: true });
          void runtime.sessions.refreshCurrentWorkspaceSessions(machineId);
        }
      },
    );
    return () => {
      active = false;
      unsubscribe();
      release();
      socket.close();
      if (realtimeRef.current === socket) realtimeRef.current = undefined;
    };
  }, [state.machinesLoad, state.selectedMachine?.id, runtime]);

  const restoredRoute = useRef(false);
  useEffect(() => {
    if (restoredRoute.current || state.projectsLoad !== "loaded") return;
    const route = readRoute();
    const project = route.projectId === undefined ? undefined : state.projects.find(item => item.id === route.projectId);
    restoredRoute.current = true;
    if (project !== undefined) {
      void runtime.workspaces.selectProject(project, {
        workspaceId: route.workspaceId,
        sessionId: route.sessionId,
        updateUrl: false,
      });
      return;
    }
    if (route.sessionId !== undefined) {
      void runtime.sessions.openSessionAlone(route.sessionId, { updateUrl: false });
      return;
    }
    if (state.projects[0] !== undefined) void runtime.workspaces.selectProject(state.projects[0], { updateUrl: false });
  }, [state.projectsLoad, state.projects, runtime]);

  const selectedProject = state.selectedProject;
  const selectedWorkspace = state.selectedWorkspace;
  const selectedSession = state.selectedSession;

  const projects = useMemo<ReactWorkspaceProject[]>(() => withoutInstantTargets(state.projects, "close-project", state.selectedMachine?.id ?? "local", instantActions).map(project => {
    const workspaces = board?.workspaces.filter(workspace => workspace.projectId === project.id) ?? [];
    const sessions = workspaces.flatMap(workspace => boardSessionsOf(board, workspace.path) ?? []);
    const unknown = board === undefined
      || board.unknownSources.some(source => source.kind === "project" && source.projectId === project.id)
      || workspaces.some(workspace => boardSessionsOf(board, workspace.path) === undefined);
    return {
      project,
      workspaces,
      sessions: [...sessionsWithInstantActions(sessions, state.selectedMachine?.id ?? "local", instantActions)].sort((a, b) => Date.parse(b.modified) - Date.parse(a.modified)),
      unknown,
    };
  }), [state.projects, state.selectedMachine?.id, board, instantActions]);

  const selectProject = useCallback(async (projectId: string) => {
    const project = stateRef.current.projects.find(item => item.id === projectId);
    if (project !== undefined) await runtime.workspaces.selectProject(project);
  }, [runtime]);

  const selectSession = useCallback(async (session: SessionInfo) => {
    await runtime.sessions.selectSession(session);
  }, [runtime]);


  const loadSettings = useCallback(async () => {
    const current = stateRef.current;
    const machineId = current.selectedMachine?.id ?? "local";
    const scopeKey = JSON.stringify([machineId, current.selectedProject?.id]);
    setSettings({ loading: true, scopeKey });
    const results = await Promise.allSettled([
      configApi.config(machineId), pluginsApi.plugins(machineId), piPackagesApi.packages(machineId),
      piSkillsApi.list(current.selectedProject?.id, machineId),
      piMcpApi.list(current.selectedProject?.id, machineId),
    ]);
    const latest = stateRef.current;
    if (scopeKey !== JSON.stringify([latest.selectedMachine?.id ?? "local", latest.selectedProject?.id])) return;
    setSettings({
      config: results[0].status === "fulfilled" ? results[0].value : undefined,
      plugins: results[1].status === "fulfilled" ? results[1].value : undefined,
      packages: results[2].status === "fulfilled" ? results[2].value : undefined,
      skills: results[3].status === "fulfilled" ? results[3].value : undefined,
      mcp: results[4].status === "fulfilled" ? results[4].value : undefined,
      loading: false,
      scopeKey,
      error: results.some(result => result.status === "rejected")
        ? results.filter((result): result is PromiseRejectedResult => result.status === "rejected").map(result => errorText(result.reason)).join("\n")
        : undefined,
    });
  }, []);
  const writeSettingsForScope = (scopeKey: string, update: (current: ReactWorkspaceData["settings"]) => ReactWorkspaceData["settings"]) => {
    const latest = stateRef.current;
    if (scopeKey !== JSON.stringify([latest.selectedMachine?.id ?? "local", latest.selectedProject?.id])) return;
    setSettings(current => update(current));
  };
  const updateMachineConfig = useCallback((machineId: string, update: (current: PiWebConfigResponse["config"]) => PiWebConfigResponse["config"]) => {
    return settingsSaveQueueRef.current(machineId, update);
  }, []);
  const saveSettings = useCallback(async (config: Partial<PiWebConfigResponse["config"]>) => {
    const current = stateRef.current;
    const machineId = current.selectedMachine?.id ?? "local";
    const scopeKey = JSON.stringify([machineId, current.selectedProject?.id]);
    const response = await updateMachineConfig(machineId, currentConfig => ({ ...currentConfig, ...config }));
    writeSettingsForScope(scopeKey, value => ({ ...value, config: response, notice: "Settings saved. Some changes may require a PI WEB restart." }));
  }, [updateMachineConfig]);
  const setPluginEnabled = useCallback(async (id: string, enabled: boolean) => {
    const currentState = stateRef.current;
    const machineId = currentState.selectedMachine?.id ?? "local";
    const scopeKey = JSON.stringify([machineId, currentState.selectedProject?.id]);
    const config = await updateMachineConfig(machineId, current => {
      const plugins = { ...(current.plugins ?? {}), [id]: { ...(current.plugins?.[id] ?? {}), enabled } };
      return { ...current, plugins };
    });
    const response = await pluginsApi.plugins(machineId);
    writeSettingsForScope(scopeKey, value => ({ ...value, config, plugins: response, notice: "Plugin preference saved. A server restart or reload may be required." }));
  }, [updateMachineConfig]);
  const installPackage = useCallback(async (source: string) => {
    const current = stateRef.current;
    const machineId = current.selectedMachine?.id ?? "local";
    const scopeKey = JSON.stringify([machineId, current.selectedProject?.id]);
    const response = await piPackagesApi.install(source, machineId);
    writeSettingsForScope(scopeKey, value => ({ ...value, packages: response, notice: response.requiresReload === true ? "Package installed. Reload sessions to activate it." : "Package installed." }));
  }, []);
  const updatePackage = useCallback(async (source?: string) => {
    const current = stateRef.current;
    const machineId = current.selectedMachine?.id ?? "local";
    const scopeKey = JSON.stringify([machineId, current.selectedProject?.id]);
    const response = await piPackagesApi.update(source, machineId);
    writeSettingsForScope(scopeKey, value => ({ ...value, packages: response, notice: "Package update completed." }));
  }, []);
  const removePackage = useCallback(async (source: string, scope: PiPackageScope) => {
    const current = stateRef.current;
    const machineId = current.selectedMachine?.id ?? "local";
    const scopeKey = JSON.stringify([machineId, current.selectedProject?.id]);
    const response = await piPackagesApi.remove(source, scope, machineId);
    writeSettingsForScope(scopeKey, value => ({ ...value, packages: response, notice: "Package removed." }));
  }, []);
  const setSkillEnabled = useCallback(async (skill: PiSkillInfo, enabled: boolean) => {
    const current = stateRef.current;
    const scopeKey = JSON.stringify([current.selectedMachine?.id ?? "local", current.selectedProject?.id]);
    const response = await piSkillsApi.setEnabled({
      id: skill.id, name: skill.name, scope: skill.scope, enabled,
      ...(skill.scope === "project" && current.selectedProject ? { projectId: current.selectedProject.id } : {}),
    }, current.selectedMachine?.id ?? "local");
    writeSettingsForScope(scopeKey, value => ({ ...value, skills: response, notice: response.requiresReload ? "Skill saved. Reload running sessions to apply it." : "Skill preference saved." }));
  }, []);
  const setMcpEnabled = useCallback(async (server: PiMcpServerInfo, enabled: boolean) => {
    const current = stateRef.current;
    const scopeKey = JSON.stringify([current.selectedMachine?.id ?? "local", current.selectedProject?.id]);
    const target = server.targets[0];
    if (!target) throw new Error("This MCP server has no writable target.");
    const response = await piMcpApi.setEnabled({
      name: server.name, target: target.kind, enabled,
      ...(target.kind === "override" && current.selectedProject ? { projectId: current.selectedProject.id } : {}),
      scope: server.scope,
    }, current.selectedMachine?.id ?? "local");
    writeSettingsForScope(scopeKey, value => ({ ...value, mcp: response, notice: response.requiresReload ? "MCP configuration saved. Reload running sessions to apply it." : "MCP configuration saved." }));
  }, []);
  const testMcp = useCallback(async (server: PiMcpServerInfo) => {
    const current = stateRef.current;
    const scopeKey = JSON.stringify([current.selectedMachine?.id ?? "local", current.selectedProject?.id]);
    const response = await piMcpApi.test({ name: server.name, ...(current.selectedProject ? { projectId: current.selectedProject.id } : {}) }, current.selectedMachine?.id ?? "local");
    writeSettingsForScope(scopeKey, value => ({ ...value, mcp: response, notice: response.probe?.message ?? "MCP probe completed." }));
  }, []);
  const removeMcp = useCallback(async (server: PiMcpServerInfo) => {
    const current = stateRef.current;
    const scopeKey = JSON.stringify([current.selectedMachine?.id ?? "local", current.selectedProject?.id]);
    const target = server.targets[0];
    if (!target) throw new Error("This MCP server has no writable target.");
    const response = await piMcpApi.remove({
      name: server.name, target: target.kind,
      ...(target.kind === "override" && current.selectedProject ? { projectId: current.selectedProject.id } : {}),
      scope: server.scope,
    }, current.selectedMachine?.id ?? "local");
    writeSettingsForScope(scopeKey, value => ({ ...value, mcp: response, notice: response.requiresReload ? "MCP entry removed. Reload running sessions to apply it." : "MCP entry removed." }));
  }, []);
  /**
   * Writes one server's config, and says what the answer did.
   *
   * The form owns the draft and the target, so the hook only carries it to the machine the panel is
   * answering for and puts the answer under the scope it was read for. The notice follows the answer:
   * an added server has to be connected by a reload, and a saved one reaches a running session after
   * one, because pi opens its MCP connections when a session starts.
   */
  const saveMcp = useCallback(async (save: PiMcpSaveRequest) => {
    const current = stateRef.current;
    const scopeKey = JSON.stringify([current.selectedMachine?.id ?? "local", current.selectedProject?.id]);
    const response = await piMcpApi.save(save, current.selectedMachine?.id ?? "local");
    writeSettingsForScope(scopeKey, value => ({
      ...value,
      mcp: response,
      notice: response.added === true
        ? `MCP server "${response.name}" added. Start a session, or reload a running one, to connect it.`
        : `MCP server "${response.name}" saved. Reload a running session to apply it.`,
    }));
  }, []);

  const selectMachine = useCallback((machine: Machine) => runtime.machines.selectMachine(machine), [runtime]);
  const addMachine = useCallback(async (input: { name: string; baseUrl: string; token?: string }) => {
    const machine = await runtime.machines.addMachine(input);
    if (machine === undefined) throw new Error(stateRef.current.error || "The machine could not be added.");
  }, [runtime]);
  const renameMachine = useCallback(async (machine: Machine, name: string) => {
    const updated = await runtime.machines.updateMachine(machine, { name });
    if (updated === undefined) throw new Error(stateRef.current.error || "The machine could not be renamed.");
  }, [runtime]);
  const removeMachine = useCallback(async (machine: Machine) => {
    await runtime.machines.deleteMachine(machine);
    const next = runtime.machines.applyRemovedMachine(machine.id);
    if (next !== undefined) await runtime.machines.selectMachine(next);
  }, [runtime]);


  useEffect(() => {
    const session = selectedSession;
    if (session === undefined) {
      setModelOptions(undefined);
      setModelCatalog(undefined);
      setThinkingOptions(undefined);
      return;
    }
    let active = true;
    const machineId = state.selectedMachine?.id ?? "local";
    void Promise.allSettled([
      sessionsApi.models({ id: session.id, cwd: session.cwd }, machineId),
      sessionsApi.modelCatalog({ id: session.id, cwd: session.cwd }, machineId),
      sessionsApi.thinkingLevels({ id: session.id, cwd: session.cwd }, machineId),
    ]).then(([models, catalog, thinking]) => {
      if (!active) return;
      setModelOptions(models.status === "fulfilled" ? models.value : undefined);
      setModelCatalog(catalog.status === "fulfilled" ? catalog.value : undefined);
      setThinkingOptions(thinking.status === "fulfilled" ? thinking.value : undefined);
    });
    return () => { active = false; };
  }, [selectedSession?.id, selectedSession?.cwd, state.selectedMachine?.id]);

  useEffect(() => {
    if (selectedSession === undefined) {
      setDraftState("");
      return;
    }
    const key = machineSessionKey(state.selectedMachine?.id ?? "local", selectedSession.id);
    setDraftState(loadDraft(key));
  }, [selectedSession?.id, state.selectedMachine?.id]);

  const setDraft = useCallback((value: string) => {
    setDraftState(value);
    const current = stateRef.current;
    if (current.selectedSession === undefined) return;
    const key = machineSessionKey(current.selectedMachine?.id ?? "local", current.selectedSession.id);
    saveDraft(key, value);
  }, []);

  const sendPrompt = useCallback(async (text: string, captured: readonly CapturedAttachment[] = []): Promise<boolean> => {
    const current = stateRef.current;
    const session = current.selectedSession;
    if (session === undefined || session.archived === true || (text.trim() === "" && captured.length === 0)) return false;
    const trimmed = text.trim();
    if (captured.length === 0 && trimmed.startsWith("/") && !pageMaySend(trimmed)) {
      await runtime.sessions.runCommand(trimmed);
      return true;
    }
    const kind = operationKindOf(trimmed, false);
    if (captured.length === 0 && kind === "command") {
      await runtime.sessions.runCommand(trimmed);
      return true;
    }
    const machineId = current.selectedMachine?.id ?? "local";
    const scope = { machineId, sessionId: session.id, cwd: session.cwd };
    const outboxKey = machineSessionKey(machineId, session.id);
    const record = await writeOutgoingOperation(outboxKey, {
      kind,
      scope,
      text: trimmed,
      behavior: undefined,
      files: captured.length === 0 ? undefined : {
        attachments: captured.map(item => ({ kind: item.kind, name: item.name, mimeType: item.mimeType, data: item.data } satisfies PromptAttachment)),
        delivery: effectivePromptAttachmentDelivery("inline", captured),
      },
      via: undefined,
    });
    if (record === undefined) return false;
    runtime.sessions.showOutgoing(record);
    runtime.sessions.kickOutbox();
    setDraft("");
    return true;
  }, [runtime, setDraft]);

  const stopSession = useCallback(async () => {
    await runtime.sessions.stopActiveWork();
  }, [runtime]);

  const loadEarlierMessages = useCallback(async () => {
    await runtime.sessions.loadEarlierMessages();
  }, [runtime]);

  const renameSession = useCallback(async (session: SessionInfo, name: string) => {
    const machineId = stateRef.current.selectedMachine?.id ?? "local";
    if (!await runtime.sessions.renameSession(session, name, machineId)) throw new Error("The session name was not changed.");
  }, [runtime]);

  const deleteArchivedSession = useCallback((session: SessionInfo, machineId: string) => {
    const current = stateRef.current;
    if (sessionActionIsPending(runtime.instantActions.list(), machineId, session.id)) return Promise.resolve();
    const workspaces = runtime.boards.board(machineId)?.workspaces ?? [];
    setSessionActionNotice(undefined);
    const machineName = current.machines.find((machine) => machine.id === machineId)?.name ?? "This machine";
    runtime.instantActions.start({ kind: "delete-archived", machineId, machineName, dock: "none", targets: [sessionActionTarget(session, workspaces)] });
    return Promise.resolve();
  }, [runtime]);

  const startSessionAction = useCallback((kind: "archive" | "restore", session: SessionInfo, machineId: string) => {
    const current = stateRef.current;
    if (sessionActionIsPending(runtime.instantActions.list(), machineId, session.id)) return;
    const workspaces = runtime.boards.board(machineId)?.workspaces ?? [];
    setSessionActionNotice(undefined);
    const machineName = current.machines.find((machine) => machine.id === machineId)?.name ?? "This machine";
    runtime.instantActions.start({ kind, machineId, machineName, dock: "none", targets: [sessionActionTarget(session, workspaces)] });
  }, [runtime]);

  const archiveSession = useCallback((session: SessionInfo, machineId: string) => { startSessionAction("archive", session, machineId); return Promise.resolve(); }, [startSessionAction]);
  const restoreSession = useCallback((session: SessionInfo, machineId: string) => { startSessionAction("restore", session, machineId); return Promise.resolve(); }, [startSessionAction]);
  const undoSessionAction = useCallback(() => { runtime.instantActions.undoLatest(); }, [runtime]);
  const pauseSessionUndo = useCallback((reason: "pointer" | "focus") => { runtime.instantActions.pause(`react-undo-${reason}`); }, [runtime]);
  const resumeSessionUndo = useCallback((reason: "pointer" | "focus") => { runtime.instantActions.resume(`react-undo-${reason}`); }, [runtime]);

  const closeProject = useCallback((project: Project) => {
    const current = stateRef.current;
    const machineId = current.selectedMachine?.id ?? "local";
    if (projectActionIsPending(runtime.instantActions.list(), machineId, project.id)) return;
    const machineName = current.machines.find((machine) => machine.id === machineId)?.name ?? "This machine";
    const admission = projectCloseAdmission(current.machineRuntimes[machineId]);
    if (admission.kind === "refused") {
      setSessionActionNotice(instantRefusalWords("close-project", machineName, admission.reason));
      return;
    }
    setSessionActionNotice(undefined);
    runtime.instantActions.start({ kind: "close-project", machineId, machineName, dock: "none", targets: [projectActionTarget(project)] });
  }, [runtime]);

  const addProject = useCallback((path: string, create: boolean, trust: ProjectTrustChoice | undefined, machineId: string) => {
    return runtime.projects.addProject(path, create, trust, machineId);
  }, [runtime]);

  const startSession = useCallback(() => {
    runtime.sessions.startSession();
  }, [runtime]);

  const runCommand = useCallback(async (text: string) => {
    await runtime.sessions.runCommand(text);
  }, [runtime]);

  // Keep errors scoped to the read that produced them. AppState.error is a page-wide
  // notice (for example a machine health/runtime read); attributing it to the
  // project list made an unrelated transient 502 look like a terminal project
  // failure. ProjectController owns the project's answered refusal and retries
  // gateway/link misses while its listing is watched.
  const machineId = state.selectedMachine?.id ?? "local";
  const settingsScopeKey = JSON.stringify([machineId, state.selectedProject?.id]);
  const scopedSettings = settings.scopeKey === settingsScopeKey ? settings : { loading: true, scopeKey: settingsScopeKey };
  const projectsError = runtime.projects.refusal(machineId);
  const sessionError = state.transcriptFailed ?? state.statusReadFailed ?? undefined;

  return {
    state,
    projects,
    board,
    selectedProject,
    selectedWorkspace,
    selectedSession,
    messages: state.messages,
    sessionStatus: state.status,
    modelOptions,
    modelCatalog,
    thinkingOptions,
    settings: scopedSettings,
    loadSettings,
    saveSettings,
    setPluginEnabled,
    installPackage,
    updatePackage,
    removePackage,
    setSkillEnabled,
    setMcpEnabled,
    testMcp,
    removeMcp,
    saveMcp,
    selectMachine,
    addMachine,
    renameMachine,
    removeMachine,
    loading: state.machinesLoad !== "loaded" || state.projectsLoad === "unloaded" || state.projectsLoad === "loading",
    projectsError,
    machineReadIssue,
    sessionError,
    draft,
    setDraft,
    selectProject,
    selectSession,
    refresh,
    sendPrompt,
    stopSession,
    loadEarlierMessages,
    renameSession,
    archiveSession,
    restoreSession,
    deleteArchivedSession,
    instantActions,
    undoAvailable,
    sessionActionNotice,
    closeProject,
    addProject,
    undoSessionAction,
    pauseSessionUndo,
    resumeSessionUndo,
    startSession,
    runCommand,
  };
}
