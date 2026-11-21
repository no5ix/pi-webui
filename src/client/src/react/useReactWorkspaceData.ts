import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { configApi, pluginsApi, piPackagesApi, piSkillsApi, piMcpApi, sessionsApi, type Machine, type Project, type SessionInfo, type SessionStatus, type Workspace, type PiWebConfigResponse, type PiWebPluginsResponse, type PiPackagesResponse, type PiSkillsResponse, type PiMcpListResponse, type PiPackageInstallRequest, type PiPackageMutationResponse, type PiPackageRemoveRequest, type PiPackageSetEnabledRequest, type PiPackageUpdateRequest, type PiMcpServerInfo, type PiMcpSaveRequest, type PiSkillInfo, type PiSkillSetEnabledResponse, type SessionModelCatalogResponse } from "../api";
import { piPackageEnabledMessage, piPackageInstallMessage, piPackageRemoveMessage, piPackageScopedRequest, piPackageUpdateMessage } from "./settings/piPackageSettingsState";
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
import { appendSettingsFailure, beginSettingsRead, settleSettingsResource, settingsScopeKey, type SettingsReadLedger } from "./settings/settingsScope";
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
  readonly settingsScopeKey: string;
  readonly settingsProjectId: string | undefined;
  readonly setSettingsProject: (projectId: string | undefined) => void;
  readonly loadSettings: (projectId?: string) => Promise<void>;
  readonly saveSettings: (config: Partial<PiWebConfigResponse["config"]>) => Promise<void>;
  readonly setPluginEnabled: (id: string, enabled: boolean) => Promise<void>;
  readonly installPackage: (request: PiPackageInstallRequest) => Promise<PiPackageMutationResponse>;
  readonly updatePackage: (request: PiPackageUpdateRequest) => Promise<PiPackageMutationResponse>;
  readonly removePackage: (request: PiPackageRemoveRequest) => Promise<PiPackageMutationResponse>;
  readonly setPackageEnabled: (request: PiPackageSetEnabledRequest) => Promise<PiPackageMutationResponse>;
  readonly setSkillEnabled: (skill: PiSkillInfo, enabled: boolean) => Promise<PiSkillSetEnabledResponse>;
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
  const [settingsProjectId, setSettingsProjectId] = useState<string | undefined>(undefined);
  const settingsProjectIdRef = useRef<string | undefined>(undefined);
  const settingsAnswersRef = useRef<SettingsReadLedger>(beginSettingsRead("", 0));
  const settingsRequestIdRef = useRef(0);
  const settingsReadRef = useRef(false);
  const settingsReadScopeRef = useRef("");
  const settingsMachineRef = useRef<string | undefined>(undefined);
  const currentSettingsScopeKey = () => settingsScopeKey({ machineId: stateRef.current.selectedMachine?.id ?? "local", projectId: settingsProjectIdRef.current });
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

  /**
   * Records one resource's answer for one scope.
   *
   * The answer carries the scope it was read for: an answer about a project that left the screen is
   * dropped, and the page keeps saying "not read yet" for that resource instead of showing it under a
   * heading naming another project. The scope's page stops loading when the last resource has answered,
   * and a resource that answered with a failure counts as answered: the page says what failed rather
   * than loading forever.
   */
  const settleSettings = useCallback((scopeKey: string, requestId: number, apply: (current: ReactWorkspaceData["settings"]) => ReactWorkspaceData["settings"], failure: unknown) => {
    const answers = settingsAnswersRef.current;
    const settled = settleSettingsResource(answers, scopeKey, requestId);
    if (settled === answers) return;
    settingsAnswersRef.current = settled;
    const error = failure === undefined ? undefined : errorText(failure);
    setSettings(current => ({
      ...apply(current),
      loading: settled.pending > 0,
      scopeKey,
      error: appendSettingsFailure(current.error, error),
    }));
  }, []);

  /**
   * Reads the settings of one scope, resource by resource.
   *
   * Every settings page answers from one resource: the packages page from the package list, the Skills
   * page from the skill list. Reading the five as a single barrier held every page at "loading" while the
   * slowest read ran, and the slowest read is a project's MCP list, which touches that project's files and
   * can take seconds — the Skills page then named an unloaded list "no skills". Each resource lands on its
   * own, and a resource that failed is cleared for this scope: an old answer from another scope is not an
   * answer here.
   *
   * Every resource answers the ledger exactly once, including a request that throws while it is being
   * built. A barrier that waits for a request that was never made never finishes, and the page then reads
   * as "loading" and "not read yet" at the same time, forever.
   */
  const readSettingsResource = useCallback(<T,>(
    scopeKey: string,
    requestId: number,
    start: () => Promise<T>,
    land: (current: ReactWorkspaceData["settings"], value: T) => ReactWorkspaceData["settings"],
    clear: (current: ReactWorkspaceData["settings"]) => ReactWorkspaceData["settings"],
  ): Promise<void> => {
    let request: Promise<T>;
    try {
      request = start();
    } catch (failure) {
      settleSettings(scopeKey, requestId, clear, failure);
      return Promise.resolve();
    }
    return request.then(
      value => { settleSettings(scopeKey, requestId, current => land(current, value), undefined); },
      (failure: unknown) => { settleSettings(scopeKey, requestId, clear, failure); },
    );
  }, [settleSettings]);

  /**
   * Re-reads one list for the scope the page is showing, after a write answered for a narrower one.
   *
   * A global preference write answers with the machine's list, and that list has no project rows in it.
   * The Skills and MCP pages display a project scope, so applying the write's answer erased a project's
   * rows from a page whose own heading names that project, and the next toggle had nothing left to act
   * on. The write's sentence is kept as the notice; the rows come from the page's own read.
   */
  const refreshSettingsList = useCallback(async (group: "skills" | "mcp") => {
    const machineId = stateRef.current.selectedMachine?.id ?? "local";
    const project = settingsProjectIdRef.current;
    const scopeKey = settingsScopeKey({ machineId, projectId: project });
    const requestId = ++settingsRequestIdRef.current;
    settingsAnswersRef.current = beginSettingsRead(scopeKey, requestId, [group]);
    setSettings(current => ({ ...current, scopeKey, loading: true }));
    if (group === "skills") {
      await readSettingsResource(scopeKey, requestId,
        () => piSkillsApi.list(project, machineId),
        (current, value) => ({ ...current, skills: value }),
        current => ({ ...current, skills: undefined }));
      return;
    }
    await readSettingsResource(scopeKey, requestId,
      () => piMcpApi.list(project, machineId),
      (current, value) => ({ ...current, mcp: value }),
      current => ({ ...current, mcp: undefined }));
  }, [readSettingsResource]);

  const loadSettings = useCallback(async (projectId?: string) => {
    const machineId = stateRef.current.selectedMachine?.id ?? "local";
    const project = projectId ?? settingsProjectIdRef.current;
    const scopeKey = settingsScopeKey({ machineId, projectId: project });
    const requestId = ++settingsRequestIdRef.current;
    settingsReadRef.current = true;
    settingsReadScopeRef.current = scopeKey;
    settingsAnswersRef.current = beginSettingsRead(scopeKey, requestId);
    setSettings((current) => current.scopeKey === scopeKey
      ? { ...current, loading: true, error: undefined }
      : { loading: true, scopeKey });
    const answer = <T,>(start: () => Promise<T>, land: (current: ReactWorkspaceData["settings"], value: T) => ReactWorkspaceData["settings"], clear: (current: ReactWorkspaceData["settings"]) => ReactWorkspaceData["settings"]) =>
      readSettingsResource(scopeKey, requestId, start, land, clear);
    await Promise.all([
      answer(() => configApi.config(machineId), (current, value) => ({ ...current, config: value }), current => ({ ...current, config: undefined })),
      answer(() => pluginsApi.plugins(machineId), (current, value) => ({ ...current, plugins: value }), current => ({ ...current, plugins: undefined })),
      answer(() => piPackagesApi.packages({ machineId, ...(project === undefined ? {} : { projectId: project }) }), (current, value) => ({ ...current, packages: value }), current => ({ ...current, packages: undefined })),
      answer(() => piSkillsApi.list(project, machineId), (current, value) => ({ ...current, skills: value }), current => ({ ...current, skills: undefined })),
      answer(() => piMcpApi.list(project, machineId), (current, value) => ({ ...current, mcp: value }), current => ({ ...current, mcp: undefined })),
    ]);
  }, [readSettingsResource]);
  const writeSettingsForScope = (scopeKey: string, update: (current: ReactWorkspaceData["settings"]) => ReactWorkspaceData["settings"]) => {
    if (scopeKey !== currentSettingsScopeKey()) return;
    setSettings(current => update(current));
  };
  /**
   * Chooses the project the Skills and MCP pages answer for.
   *
   * A skill's and an MCP server's scope is a directory on disk, not the session in the middle column,
   * so the page picks its own project. Choosing it only moves the scope: the read that belongs to it is
   * the machine/project effect below, so there is one path that reads a scope and one ledger per read.
   */
  const setSettingsProject = useCallback((projectId: string | undefined) => {
    settingsProjectIdRef.current = projectId;
    setSettingsProjectId(projectId);
  }, []);

  useEffect(() => {
    // A settings project is a project of one machine, so it never survives a machine switch: the id
    // names a directory the new machine does not have. The new machine's pages answer for the machine
    // alone until the reader picks one of its projects.
    const machineId = state.selectedMachine?.id ?? "local";
    if (settingsMachineRef.current === machineId) return;
    settingsMachineRef.current = machineId;
    if (settingsProjectIdRef.current === undefined) return;
    settingsProjectIdRef.current = undefined;
    setSettingsProjectId(undefined);
  }, [state.selectedMachine?.id]);

  useEffect(() => {
    // A project closed while Settings had it selected leaves the same kind of dangling scope: once the
    // machine's projects are known, an id that is not among them is dropped.
    if (state.projectsLoad !== "loaded" || settingsProjectIdRef.current === undefined) return;
    if (state.projects.some(project => project.id === settingsProjectIdRef.current)) return;
    settingsProjectIdRef.current = undefined;
    setSettingsProjectId(undefined);
  }, [state.projectsLoad, state.projects, state.selectedMachine?.id]);

  useEffect(() => {
    // Keep the read on the scope that is on screen: a machine switch and a settings-project switch get a
    // read of their own. The first read is the dialog's own opening, so a page that never opened
    // Settings costs no reads, and a scope this page has read is not read twice by one switch.
    if (state.machinesLoad !== "loaded" || !settingsReadRef.current) return;
    const scopeKey = settingsScopeKey({ machineId: state.selectedMachine?.id ?? "local", projectId: settingsProjectIdRef.current });
    if (settingsReadScopeRef.current === scopeKey) return;
    void loadSettings(settingsProjectIdRef.current);
  }, [state.machinesLoad, state.selectedMachine?.id, settingsProjectId, loadSettings]);

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

  const updateMachineConfig = useCallback((machineId: string, update: (current: PiWebConfigResponse["config"]) => PiWebConfigResponse["config"]) => {
    return settingsSaveQueueRef.current(machineId, update);
  }, []);
  const saveSettings = useCallback(async (config: Partial<PiWebConfigResponse["config"]>) => {
    const current = stateRef.current;
    const machineId = current.selectedMachine?.id ?? "local";
    const scopeKey = currentSettingsScopeKey();
    const response = await updateMachineConfig(machineId, currentConfig => ({ ...currentConfig, ...config }));
    writeSettingsForScope(scopeKey, value => ({ ...value, config: response, notice: "Settings saved. Some changes may require a PI WEB restart." }));
  }, [updateMachineConfig]);
  const setPluginEnabled = useCallback(async (id: string, enabled: boolean) => {
    const currentState = stateRef.current;
    const machineId = currentState.selectedMachine?.id ?? "local";
    const scopeKey = currentSettingsScopeKey();
    const config = await updateMachineConfig(machineId, current => {
      const plugins = { ...(current.plugins ?? {}), [id]: { ...(current.plugins?.[id] ?? {}), enabled } };
      return { ...current, plugins };
    });
    const response = await pluginsApi.plugins(machineId);
    writeSettingsForScope(scopeKey, value => ({ ...value, config, plugins: response, notice: "Plugin preference saved. A server restart or reload may be required." }));
  }, [updateMachineConfig]);
  /**
   * Installs a Pi package through pi's own package manager, in the scope the request names.
   *
   * `scope: "project"` is pi's native local install (`installAndPersist(source, { local: true })`)
   * into the project the page selected, and the project id is added here, from the scope the page
   * read: a caller cannot install into a project the page is not showing. A global install is pi's
   * default location, and the same source can exist in both scopes as two independent entries.
   */
  const installPackage = useCallback(async (request: PiPackageInstallRequest) => {
    const current = stateRef.current;
    const machineId = current.selectedMachine?.id ?? "local";
    const scopeKey = currentSettingsScopeKey();
    const response = await piPackagesApi.install(piPackageScopedRequest(request, settingsProjectIdRef.current), machineId);
    writeSettingsForScope(scopeKey, value => ({ ...value, packages: response, notice: piPackageInstallMessage(response) }));
    return response;
  }, []);
  const updatePackage = useCallback(async (request: PiPackageUpdateRequest) => {
    const current = stateRef.current;
    const machineId = current.selectedMachine?.id ?? "local";
    const scopeKey = currentSettingsScopeKey();
    const response = await piPackagesApi.update(piPackageScopedRequest(request, settingsProjectIdRef.current), machineId);
    writeSettingsForScope(scopeKey, value => ({ ...value, packages: response, notice: piPackageUpdateMessage(response) }));
    return response;
  }, []);
  const removePackage = useCallback(async (request: PiPackageRemoveRequest) => {
    const current = stateRef.current;
    const machineId = current.selectedMachine?.id ?? "local";
    const scopeKey = currentSettingsScopeKey();
    const response = await piPackagesApi.remove(piPackageScopedRequest(request, settingsProjectIdRef.current), machineId);
    writeSettingsForScope(scopeKey, value => ({ ...value, packages: response, notice: piPackageRemoveMessage(response) }));
    return response;
  }, []);
  const setSkillEnabled = useCallback(async (skill: PiSkillInfo, enabled: boolean) => {
    const current = stateRef.current;
    const scopeKey = currentSettingsScopeKey();
    const response = await piSkillsApi.setEnabled({
      id: skill.id, name: skill.name, scope: skill.scope, enabled,
      ...(skill.scope === "project" && settingsProjectIdRef.current !== undefined ? { projectId: settingsProjectIdRef.current } : {}),
    }, current.selectedMachine?.id ?? "local");
    await refreshSettingsList("skills");
    writeSettingsForScope(scopeKey, value => ({ ...value, notice: response.requiresReload ? "Skill saved. Reload running sessions to apply it." : "Skill preference saved." }));
    return response;
  }, [refreshSettingsList]);
  /**
   * Turns a package's preference on or off in the scope that owns it.
   *
   * pi keeps the package's files and records the preference next to them, and answers with the whole
   * list it read for the machine. The notice follows the answer, because a package a running session
   * has already loaded keeps loading until that session reloads.
   */
  const setPackageEnabled = useCallback(async (request: PiPackageSetEnabledRequest) => {
    const current = stateRef.current;
    const machineId = current.selectedMachine?.id ?? "local";
    const scopeKey = currentSettingsScopeKey();
    const response = await piPackagesApi.setEnabled(piPackageScopedRequest(request, settingsProjectIdRef.current), machineId);
    writeSettingsForScope(scopeKey, value => ({
      ...value,
      packages: response,
      notice: piPackageEnabledMessage(response),
    }));
    return response;
  }, []);
  const setMcpEnabled = useCallback(async (server: PiMcpServerInfo, enabled: boolean) => {
    const current = stateRef.current;
    const scopeKey = currentSettingsScopeKey();
    const target = server.targets[0];
    if (!target) throw new Error("This MCP server has no writable target.");
    const response = await piMcpApi.setEnabled({
      name: server.name, target: target.kind, enabled,
      ...(target.kind === "override" && settingsProjectIdRef.current !== undefined ? { projectId: settingsProjectIdRef.current } : {}),
      scope: server.scope,
    }, current.selectedMachine?.id ?? "local");
    await refreshSettingsList("mcp");
    writeSettingsForScope(scopeKey, value => ({ ...value, notice: response.requiresReload ? "MCP configuration saved. Reload running sessions to apply it." : "MCP configuration saved." }));
  }, [refreshSettingsList]);
  const testMcp = useCallback(async (server: PiMcpServerInfo) => {
    const current = stateRef.current;
    const scopeKey = currentSettingsScopeKey();
    const response = await piMcpApi.test({ name: server.name, ...(settingsProjectIdRef.current === undefined ? {} : { projectId: settingsProjectIdRef.current }) }, current.selectedMachine?.id ?? "local");
    writeSettingsForScope(scopeKey, value => ({ ...value, mcp: response, notice: response.probe?.message ?? "MCP probe completed." }));
  }, []);
  const removeMcp = useCallback(async (server: PiMcpServerInfo) => {
    const current = stateRef.current;
    const scopeKey = currentSettingsScopeKey();
    const target = server.targets[0];
    if (!target) throw new Error("This MCP server has no writable target.");
    const response = await piMcpApi.remove({
      name: server.name, target: target.kind,
      ...(target.kind === "override" && settingsProjectIdRef.current !== undefined ? { projectId: settingsProjectIdRef.current } : {}),
      scope: server.scope,
    }, current.selectedMachine?.id ?? "local");
    await refreshSettingsList("mcp");
    writeSettingsForScope(scopeKey, value => ({ ...value, notice: response.requiresReload ? "MCP entry removed. Reload running sessions to apply it." : "MCP entry removed." }));
  }, [refreshSettingsList]);
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
    const scopeKey = currentSettingsScopeKey();
    const response = await piMcpApi.save(save, current.selectedMachine?.id ?? "local");
    await refreshSettingsList("mcp");
    writeSettingsForScope(scopeKey, value => ({
      ...value,
      notice: response.added === true
        ? `MCP server "${response.name}" added. Start a session, or reload a running one, to connect it.`
        : `MCP server "${response.name}" saved. Reload a running session to apply it.`,
    }));
  }, [refreshSettingsList]);

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
  const currentSettingsKey = settingsScopeKey({ machineId, projectId: settingsProjectId });
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
    settings,
    settingsScopeKey: currentSettingsKey,
    settingsProjectId,
    setSettingsProject,
    loadSettings,
    saveSettings,
    setPluginEnabled,
    installPackage,
    updatePackage,
    removePackage,
    setPackageEnabled,
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
