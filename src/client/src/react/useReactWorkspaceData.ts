import { useCallback, useEffect, useMemo, useState } from "react";
import { projectsApi, sessionsApi, workspacesApi, type Project, type SessionInfo, type Workspace, type SessionStatus, type FileTreeEntry } from "../api";
import type { SessionBoardAnswer } from "../api/parsers";
import type { MessagePage } from "../../../shared/apiTypes";

export interface ReactWorkspaceProject {
  readonly project: Project;
  readonly workspaces: readonly Workspace[];
  readonly sessions: readonly SessionInfo[];
  readonly unknown: boolean;
}
export interface ReactWorkspaceData {
  readonly projects: readonly ReactWorkspaceProject[];
  readonly selectedProject: Project | undefined;
  readonly selectedWorkspace: Workspace | undefined;
  readonly selectedSession: SessionInfo | undefined;
  readonly messages: readonly unknown[];
  readonly sessionStatus: SessionStatus | undefined;
  readonly fileEntries: readonly FileTreeEntry[];
  readonly loading: boolean;
  readonly projectsError: string | undefined;
  readonly sessionError: string | undefined;
  readonly filesError: string | undefined;
  readonly selectProject: (projectId: string) => void;
  readonly selectSession: (session: SessionInfo, projectId: string, workspaceId: string) => void;
  readonly refresh: () => void;
  readonly loadDirectory: (path?: string) => Promise<void>;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useReactWorkspaceData(): ReactWorkspaceData {
  const [projects, setProjects] = useState<Project[]>([]);
  const [board, setBoard] = useState<SessionBoardAnswer | undefined>();
  const [selectedProjectId, setSelectedProjectId] = useState<string>();
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>();
  const [selectedSessionId, setSelectedSessionId] = useState<string>();
  const [messages, setMessages] = useState<readonly unknown[]>([]);
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>();
  const [fileEntries, setFileEntries] = useState<readonly FileTreeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [projectsError, setProjectsError] = useState<string>();
  const [sessionError, setSessionError] = useState<string>();
  const [filesError, setFilesError] = useState<string>();
  const [refreshVersion, setRefreshVersion] = useState(0);

  const refresh = useCallback(() => setRefreshVersion(value => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    setLoading(true);
    setProjectsError(undefined);
    void (async () => {
      try {
        const [projectRows, rawBoard] = await Promise.all([
          projectsApi.projects("local"),
          sessionsApi.sessionBoard("local"),
        ]);
        if (!current) return;
        setProjects(projectRows);
        setBoard(rawBoard);
        setSelectedProjectId(old => projectRows.some(project => project.id === old) ? old : projectRows[0]?.id);
        setProjectsError(undefined);
      } catch (error) {
        if (!current || controller.signal.aborted) return;
        setProjectsError(errorText(error));
      } finally {
        if (current) setLoading(false);
      }
    })();
    return () => { current = false; controller.abort(); };
  }, [refreshVersion]);

  const boardProjects = useMemo(() => {
    const boardProjectMap = new Map((board?.projects ?? []).map(item => [item.projectId, item]));
    const sessionsByCwd = new Map((board?.listings ?? []).filter(item => "sessions" in item).map(item => [item.cwd, item.sessions]));
    return projects.map(project => {
      const source = boardProjectMap.get(project.id);
      const workspaces = source !== undefined && "workspaces" in source ? source.workspaces : [];
      const unknown = source === undefined || "unknown" in source;
      const sessions = workspaces.flatMap(workspace => sessionsByCwd.get(workspace.path) ?? []);
      return { project, workspaces, sessions: sessions.sort((a,b) => Date.parse(b.modified)-Date.parse(a.modified)), unknown } satisfies ReactWorkspaceProject;
    });
  }, [projects, board]);

  const selectedProjectRow = boardProjects.find(item => item.project.id === selectedProjectId);
  const selectedProject = selectedProjectRow?.project;
  const selectedWorkspace = selectedProjectRow?.workspaces.find(item => item.id === selectedWorkspaceId) ?? selectedProjectRow?.workspaces.find(item => item.isMain) ?? selectedProjectRow?.workspaces[0];
  const selectedSession = selectedProjectRow?.sessions.find(item => item.id === selectedSessionId);

  const selectProject = useCallback((projectId: string) => {
    setSelectedProjectId(projectId);
    setSelectedWorkspaceId(undefined);
    setSelectedSessionId(undefined);
  }, []);

  const selectSession = useCallback((session: SessionInfo, projectId: string, workspaceId: string) => {
    setSelectedProjectId(projectId);
    setSelectedWorkspaceId(workspaceId);
    setSelectedSessionId(session.id);
  }, []);

  useEffect(() => {
    if (!selectedSession) {
      setMessages([]);
      setSessionStatus(undefined);
      setSessionError(undefined);
      return;
    }
    let current = true;
    setSessionError(undefined);
    setMessages([]);
    setSessionStatus(undefined);
    const ref = { id: selectedSession.id, cwd: selectedSession.cwd };
    void Promise.all([
      sessionsApi.messages(ref, { limit: 60 }).then(page => page as MessagePage),
      sessionsApi.status(ref),
    ]).then(([page, status]) => {
      if (!current) return;
      setMessages(page.messages);
      setSessionStatus(status);
    }).catch(error => {
      if (current) setSessionError(errorText(error));
    });
    return () => { current = false; };
  }, [selectedSession?.id, selectedSession?.cwd]);

  const loadDirectory = useCallback(async (path = "") => {
    if (!selectedProject || !selectedWorkspace) return;
    setFilesError(undefined);
    try {
      const result = await workspacesApi.workspaceTree(selectedProject.id, selectedWorkspace.id, path);
      setFileEntries(result.entries);
    } catch (error) {
      setFileEntries([]);
      setFilesError(errorText(error));
    }
  }, [selectedProject?.id, selectedWorkspace?.id]);

  useEffect(() => {
    setFileEntries([]);
    setFilePath("");
    if (selectedProject && selectedWorkspace) void loadDirectory("");
  }, [selectedProject?.id, selectedWorkspace?.id, loadDirectory]);

  return {
    projects: boardProjects,
    selectedProject,
    selectedWorkspace,
    selectedSession,
    messages,
    sessionStatus,
    fileEntries,
    loading,
    projectsError,
    sessionError,
    filesError,
    selectProject,
    selectSession,
    refresh,
    loadDirectory,
  };
}
