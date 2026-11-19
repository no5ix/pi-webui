import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { workspacesApi, type FileContentResponse, type FileTreeEntry, type Project, type SessionInfo, type SessionStatus, type Workspace } from "../api";
import { initialAppState, type AppState } from "../appState";
import { ProjectController } from "../controllers/projectController";
import { WorkspaceController } from "../controllers/workspaceController";
import { MachineController } from "../controllers/machineController";
import { SessionBoardController } from "../controllers/sessionBoardController";
import { boardEventOf, boardSessionsOf, type SessionBoard } from "../sync/sessionBoard";
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
import { effectivePromptAttachmentDelivery, type CapturedAttachment } from "../promptAttachmentCapture";
import type { PromptAttachment } from "../api";

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
  readonly fileEntries: readonly FileTreeEntry[];
  readonly filePath: string;
  readonly selectedFile: FileContentResponse | undefined;
  readonly loading: boolean;
  readonly projectsError: string | undefined;
  readonly sessionError: string | undefined;
  readonly filesError: string | undefined;
  readonly draft: string;
  readonly setDraft: (value: string) => void;
  readonly selectProject: (projectId: string) => Promise<void>;
  readonly selectSession: (session: SessionInfo) => Promise<void>;
  readonly refresh: () => void;
  readonly loadDirectory: (path?: string) => Promise<void>;
  readonly loadFile: (path: string) => Promise<void>;
  readonly saveFile: (path: string, content: string) => Promise<void>;
  readonly uploadFile: (file: File) => Promise<void>;
  readonly sendPrompt: (text: string, attachments?: readonly CapturedAttachment[]) => Promise<boolean>;
  readonly stopSession: () => Promise<void>;
  readonly startSession: () => void;
  readonly runCommand: (text: string) => Promise<void>;
}

type Runtime = {
  getState: GetState;
  setState: SetState;
  projects: ProjectController;
  workspaces: WorkspaceController;
  machines: MachineController;
  sessions: SessionController;
  boards: SessionBoardController;
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * React owns the view, while PI WEB's existing controllers continue to own
 * listing retries, route selection, transcript convergence, stream recovery,
 * command delivery, and the durable per-device outbox.
 */
export function useReactWorkspaceData(): ReactWorkspaceData {
  const stateRef = useRef<AppState>(initialAppState());
  const [state, setReactState] = useState<AppState>(stateRef.current);
  const runtimeRef = useRef<Runtime | undefined>(undefined);
  const [fileEntries, setFileEntries] = useState<readonly FileTreeEntry[]>([]);
  const [filePath, setFilePath] = useState("");
  const [selectedFile, setSelectedFile] = useState<FileContentResponse>();
  const [filesError, setFilesError] = useState<string>();
  const [draft, setDraftState] = useState("");
  const [board, setBoard] = useState<SessionBoard>();
  const realtimeRef = useRef<RealtimeSocket | undefined>(undefined);

  if (runtimeRef.current === undefined) {
    const getState: GetState = () => stateRef.current;
    let workspaceController: WorkspaceController | undefined;
    const setStatePatch: SetState = (patch) => {
      const previous = stateRef.current;
      const next = { ...previous, ...patch };
      stateRef.current = next;
      setReactState(next);
      if (previous.selectedProject?.id !== next.selectedProject?.id) workspaceController?.selectionChanged();
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
    let projectController: ProjectController | undefined;
    const sessionController = new SessionController(
      getState,
      setStatePatch,
      updateUrl,
      new SessionStorageSessionSelectionMemory(),
      {
        urlSessionId: () => readRoute().sessionId,
        catalogue: {
          projects: (machineId, wanted) => projectController?.answeredProjects(machineId, wanted) ?? Promise.resolve(undefined),
          workspaces: (machineId, projectId, wanted) => workspaceController?.answeredWorkspaces(machineId, projectId, wanted) ?? Promise.resolve(undefined),
        },
      },
    );
    workspaceController = new WorkspaceController(
      getState,
      setStatePatch,
      updateUrl,
      sessionController,
      new SessionStorageWorkspaceSelectionMemory(),
      { opensPreferredSession: () => true },
    );
    projectController = new ProjectController(getState, setStatePatch, workspaceController);
    const machineController = new MachineController(getState, setStatePatch, updateUrl, projectController);
    const boardController = new SessionBoardController({
      knownProjects: (machineId) => machineId === (getState().selectedMachine?.id ?? "local") && getState().projectsLoad === "loaded" ? getState().projects : undefined,
    });
    runtimeRef.current = {
      getState,
      setState: setStatePatch,
      projects: projectController,
      workspaces: workspaceController,
      machines: machineController,
      sessions: sessionController,
      boards: boardController,
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
    window.addEventListener("online", onOnline);
    return () => {
      active = false;
      window.removeEventListener("online", onOnline);
      realtimeRef.current?.close();
      realtimeRef.current = undefined;
      runtime.sessions.stopOutbox();
      runtime.sessions.dispose();
      runtime.boards.dispose();
      runtime.workspaces.dispose();
      runtime.projects.dispose();
      runtime.machines.dispose();
    };
  }, [runtime]);

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

  const projects = useMemo<ReactWorkspaceProject[]>(() => state.projects.map(project => {
    const workspaces = board?.workspaces.filter(workspace => workspace.projectId === project.id) ?? [];
    const sessions = workspaces.flatMap(workspace => boardSessionsOf(board, workspace.path) ?? []);
    const unknown = board === undefined
      || board.unknownSources.some(source => source.kind === "project" && source.projectId === project.id)
      || workspaces.some(workspace => boardSessionsOf(board, workspace.path) === undefined);
    return {
      project,
      workspaces,
      sessions: sessions.sort((a, b) => Date.parse(b.modified) - Date.parse(a.modified)),
      unknown,
    };
  }), [state.projects, board]);

  const selectProject = useCallback(async (projectId: string) => {
    const project = stateRef.current.projects.find(item => item.id === projectId);
    if (project !== undefined) await runtime.workspaces.selectProject(project);
  }, [runtime]);

  const selectSession = useCallback(async (session: SessionInfo) => {
    await runtime.sessions.selectSession(session);
  }, [runtime]);

  const loadDirectory = useCallback(async (path = "") => {
    const current = stateRef.current;
    const project = current.selectedProject;
    const workspace = current.selectedWorkspace;
    if (project === undefined || workspace === undefined) return;
    setFilesError(undefined);
    setSelectedFile(undefined);
    setFilePath(path);
    try {
      const result = await workspacesApi.workspaceTree(project.id, workspace.id, path);
      setFileEntries(result.entries);
    } catch (error) {
      setFileEntries([]);
      setFilesError(errorText(error));
    }
  }, []);

  useEffect(() => {
    setFileEntries([]);
    setFilePath("");
    if (selectedProject !== undefined && selectedWorkspace !== undefined) void loadDirectory("");
  }, [selectedProject?.id, selectedWorkspace?.id, loadDirectory]);

  const loadFile = useCallback(async (path: string) => {
    const current = stateRef.current;
    if (current.selectedProject === undefined || current.selectedWorkspace === undefined) return;
    setFilesError(undefined);
    try {
      const content = await workspacesApi.workspaceFile(current.selectedProject.id, current.selectedWorkspace.id, path);
      setSelectedFile(content);
    } catch (error) {
      setSelectedFile(undefined);
      setFilesError(errorText(error));
    }
  }, []);

  const saveFile = useCallback(async (path: string, content: string) => {
    const current = stateRef.current;
    if (current.selectedProject === undefined || current.selectedWorkspace === undefined) return;
    setFilesError(undefined);
    try {
      await workspacesApi.writeWorkspaceFile(current.selectedProject.id, current.selectedWorkspace.id, path, content);
      const saved = await workspacesApi.workspaceFile(current.selectedProject.id, current.selectedWorkspace.id, path);
      setSelectedFile(saved);
    } catch (error) {
      setFilesError(errorText(error));
      throw error;
    }
  }, []);

  const uploadFile = useCallback(async (file: File) => {
    const current = stateRef.current;
    if (current.selectedProject === undefined || current.selectedWorkspace === undefined) return;
    const relativePath = [filePath, file.name].filter(Boolean).join("/");
    setFilesError(undefined);
    try {
      await workspacesApi.writeWorkspaceFile(
        current.selectedProject.id,
        current.selectedWorkspace.id,
        relativePath,
        new Uint8Array(await file.arrayBuffer()),
        { createDirs: true, overwrite: false },
      );
      await loadDirectory(filePath);
    } catch (error) {
      setFilesError(errorText(error));
      throw error;
    }
  }, [filePath, loadDirectory]);

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
    fileEntries,
    filePath,
    loading: state.machinesLoad !== "loaded" || state.projectsLoad === "unloaded" || state.projectsLoad === "loading",
    projectsError,
    sessionError,
    filesError,
    draft,
    setDraft,
    selectProject,
    selectSession,
    refresh,
    loadDirectory,
    loadFile,
    saveFile,
    uploadFile,
    sendPrompt,
    stopSession,
    startSession,
    runCommand,
  };
}
