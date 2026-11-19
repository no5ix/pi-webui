import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { capturePromptAttachments, type CapturedAttachment } from "../promptAttachmentCapture";
import { readBlobAsBase64 } from "../sentImages";
import { filesApi, requestPluginBackend, sessionsApi, workspacesApi, type FileTreeEntry } from "../api";
import { readPluginManifest } from "../plugins/external";
import { detectPromptCompletionTrigger, fileCompletionInsertText, modelCompletionChoices, asksExtensionCompletion } from "../promptCompletions";
import { historyIndexStep, loadPromptHistory, recallPromptHistoryAttachments, rememberPromptHistory, type HistoryDirection } from "../promptHistory";
import { machineSessionKey } from "../machineKeys";
import { MOBILE_NAVIGATION_MEDIA_QUERY } from "../breakpoints";
import type { CompletionItem } from "../components/shared";
import { GIT_BRANCHES_OPERATION, GIT_DIFF_OPERATION, GIT_MUTATE_OPERATION, GIT_STATUS_OPERATION, parseGitBranchesResponse, parseGitDiffResponse, parseGitStatusResponse, type GitBranchesResponse, type GitDiffResponse, type GitStatusResponse, type GitMutation } from "../../../../pi-web-plugins/git/browser/git-contract";
import { Icon } from "./icons";
import { ConversationMessage, editedFilesFromMessages } from "./ConversationMessage";
import { ProjectTree } from "./ProjectTree";
import { useReactWorkspaceData } from "./useReactWorkspaceData";
import { ReactTerminalPanel } from "./ReactTerminalPanel";
import { WorkspaceFileTree } from "./WorkspaceFileTree";
import { WorkspaceCodeEditor } from "./WorkspaceCodeEditor";
import { ReactSettingsDialog } from "./ReactSettingsDialog";

type WorkbenchTab = "Git" | "Files" | "Terminal" | "Goals";
interface ReactWorkspaceScope {
  readonly projectId: string | undefined;
  readonly workspaceId: string | undefined;
  readonly machineId: string;
}

const tabs: WorkbenchTab[] = ["Git", "Files", "Terminal", "Goals"];
const GIT_REMOTE_REQUEST_TIMEOUT_MS = 130_000;
export function ReactWorkspaceApp() {
  const data = useReactWorkspaceData();
  const selectedMachineId = data.state.selectedMachine?.id ?? "local";
  const selectedMachineHealth = data.state.machineStatuses[selectedMachineId];
  const machineConnectionMessage = data.machineReadIssue ?? (data.state.machinesLoad !== "loaded" ? data.state.error : "");
  const machineConnectionLabel = data.state.error.includes("sign in")
    ? "Authentication required"
    : data.state.error.includes("refused to list")
      ? "Access denied"
      : data.machineReadIssue
        ? "Reconnecting"
        : data.state.machinesLoad !== "loaded"
          ? "Connecting…"
          : selectedMachineHealth === undefined
            ? "Checking health…"
            : selectedMachineHealth.status === undefined || selectedMachineHealth.status === "unknown"
              ? "Health unknown"
          : selectedMachineHealth?.status === "offline"
            ? "Machine unavailable"
            : selectedMachineHealth.status === "error" || !selectedMachineHealth.ok
              ? "Server error"
              : "Connected";
  const runningSessionsKnown = data.state.projectsLoad === "loaded" && data.board !== undefined && data.board.unknownSources.length === 0;
  const selectedScope = { projectId: data.selectedProject?.id, workspaceId: data.selectedWorkspace?.id, machineId: data.state.selectedMachine?.id ?? "local" };
  const selectedScopeRef = useRef(selectedScope);
  selectedScopeRef.current = selectedScope;
  const selectedScopeKey = JSON.stringify([selectedScope.machineId, selectedScope.projectId, selectedScope.workspaceId]);
  const scopeIsCurrent = (scope: ReactWorkspaceScope) => {
    const current = selectedScopeRef.current;
    return current.projectId === scope.projectId && current.workspaceId === scope.workspaceId && current.machineId === scope.machineId;
  };
  const scopeHasWorkspace = (scope: ReactWorkspaceScope): scope is ReactWorkspaceScope & { projectId: string; workspaceId: string } => scope.projectId !== undefined && scope.workspaceId !== undefined;
  const narrowScreen = window.matchMedia(MOBILE_NAVIGATION_MEDIA_QUERY).matches;
  const [activeTab, setActiveTab] = useState<WorkbenchTab>("Files");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [projectQuery, setProjectQuery] = useState("");
  const [leftWidth, setLeftWidth] = useState(327);
  const [rightWidth, setRightWidth] = useState(402);
  const [leftOpen, setLeftOpen] = useState(!narrowScreen);
  const [rightOpen, setRightOpen] = useState(!narrowScreen);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [showMoreByProject, setShowMoreByProject] = useState<Record<string, boolean>>({});
  const [composerFocused, setComposerFocused] = useState(false);
  const [composerCursor, setComposerCursor] = useState(0);
  const [completionItems, setCompletionItems] = useState<CompletionItem[]>([]);
  const [completionIndex, setCompletionIndex] = useState(0);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const followTranscriptRef = useRef(true);
  const previousPageStartRef = useRef(data.state.messagePageStart);
  const olderPageAnchorRef = useRef<{ scopeKey: string; scrollTop: number; scrollHeight: number } | undefined>(undefined);
  const [showTranscriptJump, setShowTranscriptJump] = useState(false);
  const promptHistoryRef = useRef<{ key: string | undefined; index: number | undefined; draft: string }>({ key: undefined, index: undefined, draft: "" });
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string>();
  const [fileFilter, setFileFilter] = useState("");
  const [fileSearchResults, setFileSearchResults] = useState<Awaited<ReturnType<typeof filesApi.files>>>([]);
  const [fileSearchScopeKey, setFileSearchScopeKey] = useState("");
  const [fileSearchLoading, setFileSearchLoading] = useState(false);
  const [fileSearchLoadingScopeKey, setFileSearchLoadingScopeKey] = useState("");
  const [fileUploadDirectory, setFileUploadDirectory] = useState("");
  const [fileTreeEntries, setFileTreeEntries] = useState<Record<string, readonly FileTreeEntry[]>>({});
  const [fileTreeEntriesScopeKey, setFileTreeEntriesScopeKey] = useState("");
  const [fileTreeExpanded, setFileTreeExpanded] = useState<ReadonlySet<string>>(new Set());
  const [fileTreeLoading, setFileTreeLoading] = useState<ReadonlySet<string>>(new Set());
  const [fileTreeError, setFileTreeError] = useState<string>();
  const [fileTreeErrorScopeKey, setFileTreeErrorScopeKey] = useState("");
  const visibleFileTreeEntries = fileTreeEntriesScopeKey === selectedScopeKey ? fileTreeEntries : {};
  const visibleFileTreeExpanded = fileTreeEntriesScopeKey === selectedScopeKey ? fileTreeExpanded : new Set<string>();
  const visibleFileTreeLoadingPaths = fileTreeEntriesScopeKey === selectedScopeKey ? fileTreeLoading : data.selectedWorkspace === undefined ? new Set<string>() : new Set([""]);
  const visibleFileSearchResults = fileSearchScopeKey === selectedScopeKey ? fileSearchResults : [];
  const visibleFileSearchLoading = fileSearchLoadingScopeKey === selectedScopeKey && fileSearchLoading;
  const visibleFileTreeError = fileTreeErrorScopeKey === selectedScopeKey ? fileTreeError : undefined;
  const fileUploadDirectoryForScope = fileTreeEntriesScopeKey === selectedScopeKey ? fileUploadDirectory : "";
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<CapturedAttachment[]>([]);
  const historyRecallRef = useRef(0);
  const fileReadRequestRef = useRef(0);
  const [attachmentError, setAttachmentError] = useState<string>();
  const [attaching, setAttaching] = useState(false);
  const [fileDraft, setFileDraft] = useState("");
  const [fileDirty, setFileDirty] = useState(false);
  const [openFilePaths, setOpenFilePaths] = useState<string[]>([]);
  const fileDrafts = useRef(new Map<string, { content: string; dirty: boolean }>());
  const fileDraftRef = useRef("");
  const hasUnsavedFiles = fileDirty || [...fileDrafts.current.values()].some(draft => draft.dirty);
  const [fileSaving, setFileSaving] = useState(false);
  const [fileDeleting, setFileDeleting] = useState(false);
  const [gitRefresh, setGitRefresh] = useState(0);
  const [gitStatus, setGitStatus] = useState<GitStatusResponse>();
  const [gitStatusScopeKey, setGitStatusScopeKey] = useState("");
  const [gitSelectedPath, setGitSelectedPath] = useState<string>();
  const [gitDiffs, setGitDiffs] = useState<{ path: string; scopeKey: string; unstaged?: GitDiffResponse; staged?: GitDiffResponse }>();
  const [gitError, setGitError] = useState<string>();
  const [gitErrorScopeKey, setGitErrorScopeKey] = useState("");
  const [gitLoading, setGitLoading] = useState(false);
  const [gitOperation, setGitOperation] = useState<string>();
  const [gitOperationScopeKey, setGitOperationScopeKey] = useState("");
  const [gitOperationError, setGitOperationError] = useState<string>();
  const [gitOperationErrorScopeKey, setGitOperationErrorScopeKey] = useState("");
  const [gitBranches, setGitBranches] = useState<GitBranchesResponse>();
  const [gitBranchesScopeKey, setGitBranchesScopeKey] = useState("");
  const [gitCommitMessage, setGitCommitMessage] = useState("");
  const gitOperationSequence = useRef(0);
  const visibleGitOperation = gitOperationScopeKey === selectedScopeKey ? gitOperation : undefined;
  const visibleGitOperationError = gitOperationErrorScopeKey === selectedScopeKey ? gitOperationError : undefined;
  const visibleGitStatus = gitStatusScopeKey === selectedScopeKey ? gitStatus : undefined;
  const visibleGitError = gitErrorScopeKey === selectedScopeKey ? gitError : undefined;
  const visibleGitBranches = gitBranchesScopeKey === selectedScopeKey ? gitBranches : undefined;
  const projectRows = data.projects.map(row => ({
    id: row.project.id,
    name: row.project.name,
    sessions: row.sessions.map(session => ({ id: session.id, name: session.name?.trim() || session.firstMessage || "New session", session })),
    unknown: row.unknown,
  }));
  const selectProject = (id: string) => {
    const changesProject = data.selectedProject?.id !== id;
    if (changesProject && hasUnsavedFiles && !window.confirm("Discard unsaved file edits and switch projects?")) return;
    if (changesProject) {
      setFileDirty(false);
      fileDrafts.current.clear();
      setOpenFilePaths([]);
    }
    void data.selectProject(id);
    setExpanded(current => current.includes(id) ? current : [...current, id]);
  };
  const selectSession = (projectId: string, sessionId: string) => {
    const session = data.projects.flatMap(row => row.sessions).find(item => item.id === sessionId);
    const changesFileScope = data.selectedProject?.id !== projectId || session?.cwd !== data.selectedWorkspace?.path;
    if (changesFileScope && hasUnsavedFiles && !window.confirm("Discard unsaved file edits and switch workspace?")) return;
    if (session !== undefined) {
      if (changesFileScope) {
        setFileDirty(false);
        fileDrafts.current.clear();
        setOpenFilePaths([]);
      }
      void data.selectSession(session);
    }
  };
  const addAttachments = async (files: File[]) => {
    if (files.length === 0) return;
    setAttaching(true);
    setAttachmentError(undefined);
    try {
      const result = await capturePromptAttachments(files, readBlobAsBase64);
      setAttachments(current => [...current, ...result.attachments]);
      if (result.error) setAttachmentError(result.error);
    } finally { setAttaching(false); }
  };
  const sendMessage = async () => {
    const text = data.draft.trim();
    if ((text === "" && attachments.length === 0) || sending || attaching) return;
    setSending(true);
    setSendError(undefined);
    try {
      const sent = await data.sendPrompt(text, attachments);
      if (!sent) setSendError("The message could not be saved. Your draft has been kept.");
      else if (promptHistoryKey !== undefined) {
        rememberPromptHistory(promptHistoryKey, text, attachments);
        promptHistoryRef.current = { key: promptHistoryKey, index: undefined, draft: "" };
        setCompletionItems([]);
      }
    } catch (error) {
      setSendError(error instanceof Error ? error.message : String(error));
    } finally {
      setSending(false);
    }
  };
  const browsePromptHistory = (direction: HistoryDirection): boolean => {
    const key = promptHistoryKey;
    const input = composerRef.current;
    if (key === undefined || input === null) return false;
    const history = loadPromptHistory(key);
    if (history.length === 0) return false;
    const current = promptHistoryRef.current;
    if (current.key !== key) promptHistoryRef.current = { key, index: undefined, draft: data.draft };
    const state = promptHistoryRef.current;
    if (state.index === undefined) {
      if (direction !== "older" || input.selectionStart !== data.draft.length || data.draft.trim() !== "") return false;
      state.draft = data.draft;
      state.index = 0;
    } else {
      const nextIndex = state.index + historyIndexStep(direction);
      if (nextIndex < 0) {
        historyRecallRef.current += 1;
        state.index = undefined;
        data.setDraft(state.draft);
        setAttachments([]);
        setAttachmentError(undefined);
        setComposerCursor(state.draft.length);
        return true;
      }
      if (nextIndex >= history.length) {
        historyRecallRef.current += 1;
        state.index = undefined;
        data.setDraft(state.draft);
        setAttachments([]);
        setAttachmentError(undefined);
        setComposerCursor(state.draft.length);
        return true;
      }
      state.index = nextIndex;
    }
    const next = history[state.index]?.text ?? state.draft;
    const entry = history[state.index];
    data.setDraft(next);
    if (entry !== undefined && key !== undefined) {
      const request = ++historyRecallRef.current;
      void recallPromptHistoryAttachments(key, entry).then(result => {
        if (request !== historyRecallRef.current || promptHistoryRef.current.key !== key || promptHistoryRef.current.index !== state.index) return;
        setAttachments(result.attachments);
        setAttachmentError(result.shortfall === undefined ? undefined : `${result.shortfall.missing} attachment${result.shortfall.missing === 1 ? " is" : "s are"} no longer available.`);
      });
    }
    setComposerCursor(next.length);
    return true;
  };
  const pickCompletion = async (item: CompletionItem) => {
    setCompletionItems([]);
    const session = data.selectedSession;
    const machineId = data.state.selectedMachine?.id ?? "local";
    if (item.extension !== undefined) {
      if (session === undefined || data.draft !== item.extension.text) return;
      try {
        const applied = await sessionsApi.applyExtensionCompletion({ id: session.id, cwd: session.cwd }, item.extension, machineId);
        if (data.selectedSession?.id !== session.id || data.draft !== item.extension.text) return;
        data.setDraft(applied.text);
        setComposerCursor(applied.cursor);
        requestAnimationFrame(() => { composerRef.current?.focus(); composerRef.current?.setSelectionRange(applied.cursor, applied.cursor); });
      } catch (error) {
        setSendError(error instanceof Error ? error.message : String(error));
      }
      return;
    }
    const suffix = item.kind === "file" && item.insertText.endsWith("/") ? "" : " ";
    const replaceTo = item.insertText.endsWith('"') && data.draft.slice(item.replaceTo).startsWith('"') ? item.replaceTo + 1 : item.replaceTo;
    const next = `${data.draft.slice(0, item.replaceFrom)}${item.insertText}${suffix}${data.draft.slice(replaceTo)}`;
    const cursor = item.replaceFrom + item.insertText.length + suffix.length;
    data.setDraft(next);
    setComposerCursor(cursor);
    requestAnimationFrame(() => { composerRef.current?.focus(); composerRef.current?.setSelectionRange(cursor, cursor); });
  };
  const activeActivities = Object.values(data.state.sessionActivities).filter(activity => activity.phase === "active" && activity.startup !== true);
  const backgroundCount = data.sessionStatus?.backgroundRunCount ?? 0;
  const queuedCount = data.sessionStatus?.queuedMessages.length ?? 0;
  const model = data.sessionStatus?.model;
  const contextUsage = data.sessionStatus?.contextUsage;
  const isWorking = data.sessionStatus?.isStreaming === true || data.sessionStatus?.isCompacting === true || data.sessionStatus?.isBashRunning === true || data.sessionStatus?.isStopping === true;
  const promptHistoryKey = data.selectedSession === undefined ? undefined : machineSessionKey(data.state.selectedMachine?.id ?? "local", data.selectedSession.id);
  const editedFiles = useMemo(() => editedFilesFromMessages(data.messages), [data.messages]);
  const transcriptScopeKey = JSON.stringify([data.state.selectedMachine?.id ?? "local", data.selectedSession?.id]);
  useLayoutEffect(() => {
    followTranscriptRef.current = true;
    setShowTranscriptJump(false);
    olderPageAnchorRef.current = undefined;
    const transcript = transcriptRef.current;
    if (transcript !== null) transcript.scrollTop = transcript.scrollHeight;
  }, [transcriptScopeKey]);
  useLayoutEffect(() => {
    const transcript = transcriptRef.current;
    if (transcript === null) return;
    const previousStart = previousPageStartRef.current;
    const pageStart = data.state.messagePageStart;
    if (pageStart < previousStart && olderPageAnchorRef.current?.scopeKey === transcriptScopeKey) {
      const anchor = olderPageAnchorRef.current;
      transcript.scrollTop = anchor.scrollTop + transcript.scrollHeight - anchor.scrollHeight;
      olderPageAnchorRef.current = undefined;
    } else {
      olderPageAnchorRef.current = undefined;
      if (followTranscriptRef.current) transcript.scrollTop = transcript.scrollHeight;
    }
    previousPageStartRef.current = pageStart;
  }, [data.messages, data.state.messagePageStart, transcriptScopeKey]);
  const subagentExecutions = useMemo(() => data.messages.flatMap(message => message.parts).filter((part): part is Extract<typeof part, { type: "toolExecution" | "toolCall" }> => (part.type === "toolExecution" || part.type === "toolCall") && part.toolName.toLowerCase().includes("subagent")), [data.messages]);
  useEffect(() => {
    if (data.selectedFile !== undefined) {
      const cached = fileDrafts.current.get(data.selectedFile.path);
      const content = cached?.content ?? data.selectedFile.content;
      fileDraftRef.current = content;
      setFileDraft(content);
      setFileDirty(cached?.dirty ?? false);
      setOpenFilePaths(current => current.includes(data.selectedFile!.path) ? current : [...current, data.selectedFile!.path]);
    } else {
      fileDraftRef.current = "";
      setFileDraft("");
      setFileDirty(false);
    }
  }, [data.selectedFile?.path, data.selectedFile?.modifiedAt]);

  useEffect(() => {
    fileDrafts.current.clear();
    setOpenFilePaths([]);
  }, [data.selectedProject?.id, data.selectedWorkspace?.id, data.state.selectedMachine?.id]);

  useEffect(() => {
    gitOperationSequence.current += 1;
    setGitOperation(undefined);
    setGitOperationScopeKey(selectedScopeKey);
    setGitBranches(undefined);
    setGitBranchesScopeKey(selectedScopeKey);
    setGitOperationError(undefined);
    setGitOperationErrorScopeKey(selectedScopeKey);
  }, [data.selectedProject?.id, data.selectedWorkspace?.id, data.state.selectedMachine?.id]);

  useEffect(() => {
    const project = data.selectedProject;
    const workspace = data.selectedWorkspace;
    const machineId = data.state.selectedMachine?.id ?? "local";
    const scopeKey = JSON.stringify([machineId, project?.id, workspace?.id]);
    setFileTreeEntries({});
    setFileTreeEntriesScopeKey(scopeKey);
    setFileTreeExpanded(new Set());
    setFileUploadDirectory("");
    setFileTreeError(undefined);
    setFileTreeErrorScopeKey(scopeKey);
    setFileTreeLoading(project !== undefined && workspace !== undefined ? new Set([""]) : new Set());
    if (project === undefined || workspace === undefined) return;
    let active = true;
    void workspacesApi.workspaceTree(project.id, workspace.id, "", machineId).then(tree => {
      if (active) {
        setFileTreeEntries({ "": tree.entries });
        setFileTreeEntriesScopeKey(scopeKey);
      }
    }).catch(error => {
      if (active) {
        setFileTreeError(error instanceof Error ? error.message : String(error));
        setFileTreeErrorScopeKey(scopeKey);
      }
    }).finally(() => {
      if (active) setFileTreeLoading(new Set());
    });
    return () => { active = false; };
  }, [data.selectedProject?.id, data.selectedWorkspace?.id, data.state.selectedMachine?.id]);

  useEffect(() => {
    const query = fileFilter.trim();
    const project = data.selectedProject;
    const workspace = data.selectedWorkspace;
    const machineId = data.state.selectedMachine?.id ?? "local";
    const scopeKey = JSON.stringify([machineId, project?.id, workspace?.id]);
    if (query === "" || project === undefined || workspace === undefined) {
      setFileSearchResults([]);
      setFileSearchScopeKey(scopeKey);
      setFileSearchLoading(false);
      setFileSearchLoadingScopeKey(scopeKey);
      return;
    }
    let active = true;
    setFileSearchLoading(true);
    setFileSearchLoadingScopeKey(scopeKey);
    setFileTreeError(undefined);
    setFileTreeErrorScopeKey(scopeKey);
    void filesApi.files(query, { projectId: project.id, workspaceId: workspace.id, machineId, mode: "file", scope: "all" }).then(results => {
      if (active) {
        setFileSearchResults(results);
        setFileSearchScopeKey(scopeKey);
      }
    }).catch(error => {
      if (active) {
        setFileTreeError(error instanceof Error ? error.message : String(error));
        setFileTreeErrorScopeKey(scopeKey);
      }
    }).finally(() => {
      if (active) setFileSearchLoading(false);
    });
    return () => { active = false; };
  }, [fileFilter, data.selectedProject?.id, data.selectedWorkspace?.id, data.state.selectedMachine?.id]);

  const toggleFileDirectory = (entry: FileTreeEntry) => {
    if (fileTreeExpanded.has(entry.path)) {
      setFileTreeExpanded(current => new Set([...current].filter(path => path !== entry.path)));
      if (fileUploadDirectory === entry.path || fileUploadDirectory.startsWith(`${entry.path}/`)) {
        setFileUploadDirectory(entry.path.split("/").slice(0, -1).join("/"));
      }
      return;
    }
    setFileTreeExpanded(current => new Set([...current, entry.path]));
    setFileUploadDirectory(entry.path);
    if (visibleFileTreeEntries[entry.path] !== undefined) return;
    const scope = selectedScopeRef.current;
    if (!scopeHasWorkspace(scope)) return;
    const scopeKey = JSON.stringify([scope.machineId, scope.projectId, scope.workspaceId]);
    setFileTreeLoading(current => new Set([...current, entry.path]));
    void workspacesApi.workspaceTree(scope.projectId, scope.workspaceId, entry.path, scope.machineId).then(tree => {
      if (scopeIsCurrent(scope)) {
        setFileTreeEntries(current => ({ ...(fileTreeEntriesScopeKey === scopeKey ? current : {}), [entry.path]: tree.entries }));
        setFileTreeEntriesScopeKey(scopeKey);
      }
    }).catch(error => {
      if (scopeIsCurrent(scope)) {
        setFileTreeError(error instanceof Error ? error.message : String(error));
        setFileTreeErrorScopeKey(scopeKey);
      }
    }).finally(() => {
      if (scopeIsCurrent(scope)) {
        setFileTreeLoading(current => new Set([...current].filter(path => path !== entry.path)));
      }
    });
  };

  const refreshFileTreeDirectory = (path: string) => {
    const scope = selectedScopeRef.current;
    if (!scopeHasWorkspace(scope)) return;
    const scopeKey = JSON.stringify([scope.machineId, scope.projectId, scope.workspaceId]);
    setFileTreeLoading(current => new Set([...current, path]));
    void workspacesApi.workspaceTree(scope.projectId, scope.workspaceId, path, scope.machineId).then(tree => {
      if (scopeIsCurrent(scope)) {
        setFileTreeEntries(current => ({ ...(fileTreeEntriesScopeKey === scopeKey ? current : {}), [path]: tree.entries }));
        setFileTreeEntriesScopeKey(scopeKey);
      }
    }).catch(error => {
      if (scopeIsCurrent(scope)) {
        setFileTreeError(error instanceof Error ? error.message : String(error));
        setFileTreeErrorScopeKey(scopeKey);
      }
    }).finally(() => {
      if (scopeIsCurrent(scope)) {
        setFileTreeLoading(current => new Set([...current].filter(item => item !== path)));
      }
    });
  };

  const uploadWorkspaceFile = async (file: File) => {
    if (fileSaving || fileDeleting) return;
    const scope = selectedScopeRef.current;
    if (!scopeHasWorkspace(scope)) return;
    const directory = fileUploadDirectoryForScope;
    try {
      await data.uploadFile(file, directory);
      if (scopeIsCurrent(scope)) refreshFileTreeDirectory(directory);
    } catch {
      return;
    }
  };

  const createWorkspaceFile = async () => {
    if (fileSaving || fileDeleting) return;
    const name = window.prompt("New file name")?.trim();
    if (name === undefined || name === "") return;
    if (name === "." || name === ".." || name.includes("/") || name.includes("\\")) {
      setFileTreeError("Enter a file name without path separators.");
      setFileTreeErrorScopeKey(selectedScopeKey);
      return;
    }
    if (fileDirty && !window.confirm("Discard your unsaved edits and open a new file?")) return;
    setFileDirty(false);
    const scope = selectedScopeRef.current;
    if (!scopeHasWorkspace(scope)) return;
    const path = [fileUploadDirectoryForScope, name].filter(Boolean).join("/");
    try {
      await data.createFile(path);
      if (!scopeIsCurrent(scope)) return;
      refreshFileTreeDirectory(fileUploadDirectoryForScope);
      await data.loadFile(path);
    } catch {
      return;
    }
  };

  const deleteSelectedFile = async () => {
    const selectedFile = data.selectedFile;
    if (fileSaving || fileDeleting) return;
    if (selectedFile === undefined || !window.confirm(`Delete ${selectedFile.path}?${fileDirty ? " Unsaved edits will be discarded." : ""} This cannot be undone.`)) return;
    const scope = selectedScopeRef.current;
    const parent = selectedFile.path.split("/").slice(0, -1).join("/");
    setFileDeleting(true);
    try {
      await data.deleteFile(selectedFile.path);
      if (!scopeIsCurrent(scope)) return;
      refreshFileTreeDirectory(parent);
      fileDrafts.current.delete(selectedFile.path);
      const remaining = openFilePaths.filter(path => path !== selectedFile.path);
      setOpenFilePaths(remaining);
      setFileDirty(false);
      const next = remaining.at(-1);
      if (next === undefined) void data.loadDirectory(data.filePath);
      else void data.loadFile(next);
    } catch {
      return;
    } finally {
      setFileDeleting(false);
    }
  };

  const selectWorkspaceFile = (path: string) => {
    if (fileSaving || fileDeleting || data.selectedFile?.path === path) return;
    if (data.selectedFile !== undefined) fileDrafts.current.set(data.selectedFile.path, { content: fileDraft, dirty: fileDirty });
    setOpenFilePaths(current => current.includes(path) ? current : [...current, path]);
    void data.loadFile(path);
  };

  const closeWorkspaceFile = () => {
    if (fileSaving || fileDeleting) return;
    if (fileDirty && !window.confirm("Discard your unsaved edits and close this file?")) return;
    const path = data.selectedFile?.path;
    if (path === undefined) return;
    fileDrafts.current.delete(path);
    const remaining = openFilePaths.filter(item => item !== path);
    setOpenFilePaths(remaining);
    setFileDirty(false);
    const next = remaining.at(-1);
    if (next === undefined) void data.loadDirectory(data.filePath);
    else void data.loadFile(next);
  };

  const changeFileDraft = (content: string) => {
    if (fileSaving || fileDeleting) return;
    fileDraftRef.current = content;
    setFileDraft(content);
    setFileDirty(true);
    if (data.selectedFile !== undefined) fileDrafts.current.set(data.selectedFile.path, { content, dirty: true });
  };

  useEffect(() => {
    const workspace = data.selectedWorkspace;
    const machineId = data.state.selectedMachine?.id ?? "local";
    if (activeTab !== "Git") return;
    if (workspace === undefined) {
      setGitStatus(undefined);
      setGitStatusScopeKey(selectedScopeKey);
      setGitDiffs(undefined);
      setGitSelectedPath(undefined);
      setGitError(undefined);
      setGitErrorScopeKey(selectedScopeKey);
      setGitLoading(false);
      return;
    }
    let active = true;
    setGitLoading(true);
    setGitError(undefined);
    setGitErrorScopeKey(selectedScopeKey);
    setGitStatus(undefined);
    setGitStatusScopeKey(selectedScopeKey);
    setGitDiffs(undefined);
    setGitSelectedPath(undefined);
    const manifestPath = machineId === "local" ? "pi-web-plugins/manifest.json" : `api/machines/${encodeURIComponent(machineId)}/pi-web-plugins/manifest.json`;
    void readPluginManifest(manifestPath).then(async manifest => {
      const pluginId = workspace.provider?.pluginId;
      const backendRevision = manifest?.plugins.find(plugin => plugin.id === pluginId)?.backendRevision;
      if (pluginId === undefined || backendRevision === undefined || workspace.provider?.capabilities.request !== true) throw new Error("This workspace does not provide a Git backend.");
      const target = { pluginId, backendRevision, machineId, projectId: workspace.projectId, workspaceId: workspace.id };
      const response = parseGitStatusResponse(await requestPluginBackend(target, GIT_STATUS_OPERATION, null));
      if (!active) return;
      setGitStatus(response);
      setGitStatusScopeKey(selectedScopeKey);
      setGitSelectedPath(response.files[0]?.path);
    }).catch(error => {
      if (active) {
        setGitError(error instanceof Error ? error.message : String(error));
        setGitErrorScopeKey(selectedScopeKey);
      }
    }).finally(() => {
      if (active) setGitLoading(false);
    });
    return () => { active = false; };
  }, [activeTab, data.selectedWorkspace?.id, data.selectedWorkspace?.provider?.pluginId, data.selectedWorkspace?.provider?.capabilities.request, data.state.selectedMachine?.id, gitRefresh]);

  useEffect(() => {
    const workspace = data.selectedWorkspace;
    const path = gitSelectedPath;
    const machineId = data.state.selectedMachine?.id ?? "local";
    if (activeTab !== "Git" || workspace === undefined || path === undefined) return;
    let active = true;
    const manifestPath = machineId === "local" ? "pi-web-plugins/manifest.json" : `api/machines/${encodeURIComponent(machineId)}/pi-web-plugins/manifest.json`;
    void readPluginManifest(manifestPath).then(async manifest => {
      const pluginId = workspace.provider?.pluginId;
      const backendRevision = manifest?.plugins.find(plugin => plugin.id === pluginId)?.backendRevision;
      if (pluginId === undefined || backendRevision === undefined || workspace.provider?.capabilities.request !== true) return;
      const target = { pluginId, backendRevision, machineId, projectId: workspace.projectId, workspaceId: workspace.id };
      const [unstaged, staged] = await Promise.all([
        requestPluginBackend(target, GIT_DIFF_OPERATION, { path }).then(parseGitDiffResponse),
        requestPluginBackend(target, GIT_DIFF_OPERATION, { path, staged: true }).then(parseGitDiffResponse),
      ]);
      if (active) setGitDiffs({ path, scopeKey: selectedScopeKey, unstaged, staged });
    }).catch(error => {
      if (active) {
        setGitError(error instanceof Error ? error.message : String(error));
        setGitErrorScopeKey(selectedScopeKey);
      }
    });
    return () => { active = false; };
  }, [activeTab, data.selectedWorkspace?.id, data.selectedWorkspace?.provider?.pluginId, data.selectedWorkspace?.provider?.capabilities.request, data.state.selectedMachine?.id, gitSelectedPath]);

  useEffect(() => {
    promptHistoryRef.current = { key: promptHistoryKey, index: undefined, draft: data.draft };
  }, [data.selectedSession?.id, data.state.selectedMachine?.id]);

  useEffect(() => {
    const session = data.selectedSession;
    const text = data.draft;
    const cursor = Math.min(composerCursor, text.length);
    const trigger = detectPromptCompletionTrigger(text, cursor);
    const triggerCharacters = data.sessionStatus?.extensionUi?.completion?.triggerCharacters;
    const extensionEligible = session !== undefined && triggerCharacters !== undefined && asksExtensionCompletion(text, cursor, triggerCharacters);
    if (trigger === undefined && !extensionEligible) {
      setCompletionItems([]);
      setCompletionIndex(0);
      return;
    }
    if (session === undefined) return;
    let active = true;
    const machineId = data.state.selectedMachine?.id ?? "local";
    const ownCompletions = async (): Promise<CompletionItem[]> => {
      if (trigger === undefined) return [];
      if (trigger.kind === "command") {
        const commands = await sessionsApi.commands({ id: session.id, cwd: session.cwd }, machineId);
        return commands.filter(command => command.name.toLowerCase().includes(trigger.query.toLowerCase())).slice(0, 12).map(command => ({
          kind: "command", replaceFrom: trigger.from, replaceTo: trigger.to, insertText: `/${command.name}`, detail: command.source,
          ...(command.description === undefined ? {} : { description: command.description }),
          ...(command.argumentHint === undefined ? {} : { argumentHint: command.argumentHint }),
        }));
      }
      if (trigger.kind === "file" && data.selectedProject !== undefined && data.selectedWorkspace !== undefined) {
        const files = await filesApi.files(trigger.query, { scope: trigger.fileScope, machineId, projectId: data.selectedProject.id, workspaceId: data.selectedWorkspace.id });
        return files.slice(0, 12).map(file => ({
          kind: "file", replaceFrom: trigger.from, replaceTo: trigger.to,
          insertText: fileCompletionInsertText(file.path, trigger.quoted === true, file.path.endsWith("/") ? trigger.allPrefix : undefined), detail: file.kind,
        }));
      }
      const models = await sessionsApi.models({ id: session.id, cwd: session.cwd }, machineId);
      return modelCompletionChoices(models.models, trigger.query).map(choice => ({ kind: "model", replaceFrom: trigger.from, replaceTo: cursor, ...choice }));
    };
    void (async () => {
      if (extensionEligible) {
        const extension = await sessionsApi.extensionCompletions({ id: session.id, cwd: session.cwd }, { text, cursor }, machineId).catch(() => undefined);
        if (!active) return;
        if (extension !== undefined && extension.items.length > 0) {
          setCompletionItems(extension.items.map(item => ({ kind: "extension", replaceFrom: cursor, replaceTo: cursor, insertText: item.label, detail: "", ...(item.description === undefined ? {} : { description: item.description }), extension: { item, prefix: extension.prefix, text, cursor } })));
          setCompletionIndex(0);
          return;
        }
      }
      try {
        const items = await ownCompletions();
        if (active) {
          setCompletionItems(items);
          setCompletionIndex(0);
        }
      } catch {
        if (active) setCompletionItems([]);
      }
    })();
    return () => { active = false; };
  }, [composerCursor, data.draft, data.selectedProject?.id, data.selectedSession?.id, data.selectedSession?.cwd, data.selectedWorkspace?.id, data.sessionStatus?.extensionUi?.completion?.triggerCharacters, data.state.selectedMachine?.id]);

  const saveOpenFile = async () => {
    if (data.selectedFile === undefined || !fileDirty || data.selectedFile.binary || data.selectedFile.truncated) return;
    const path = data.selectedFile.path;
    const content = fileDraft;
    const scope = selectedScopeRef.current;
    setFileSaving(true);
    try {
      await data.saveFile(path, content);
      if (!scopeIsCurrent(scope)) return;
      const latest = fileDraftRef.current;
      const dirty = latest !== content;
      setFileDirty(dirty);
      fileDrafts.current.set(path, { content: latest, dirty });
    } catch {
      // The data adapter keeps the server error visible above the file list.
    } finally {
      setFileSaving(false);
    }
  };

  const performGitOperation = async (mutation: GitMutation) => {
    const workspace = data.selectedWorkspace;
    if (workspace === undefined) return;
    const machineId = data.state.selectedMachine?.id ?? "local";
    const scope = { projectId: workspace.projectId, workspaceId: workspace.id, machineId };
    const scopeKey = JSON.stringify([machineId, workspace.projectId, workspace.id]);
    const operationId = ++gitOperationSequence.current;
    const manifestPath = machineId === "local" ? "pi-web-plugins/manifest.json" : `api/machines/${encodeURIComponent(machineId)}/pi-web-plugins/manifest.json`;
    setGitOperation(mutation.action);
    setGitOperationScopeKey(scopeKey);
    setGitOperationError(undefined);
    setGitOperationErrorScopeKey(scopeKey);
    try {
      const manifest = await readPluginManifest(manifestPath);
      const pluginId = workspace.provider?.pluginId;
      const backendRevision = manifest?.plugins.find(plugin => plugin.id === pluginId)?.backendRevision;
      if (pluginId === undefined || backendRevision === undefined || workspace.provider?.capabilities.request !== true) throw new Error("This workspace does not provide a Git backend.");
      if (!scopeIsCurrent(scope)) return;
      const projectId = workspace.projectId;
      const workspaceId = workspace.id;
      const target = { pluginId, backendRevision, machineId, projectId, workspaceId };
      const timeout = mutation.action === "fetch" || mutation.action === "pull" || mutation.action === "push" ? GIT_REMOTE_REQUEST_TIMEOUT_MS : undefined;
      await requestPluginBackend(target, GIT_MUTATE_OPERATION, mutation, timeout);
      if (scopeIsCurrent(scope)) {
        if (mutation.action === "commit") setGitCommitMessage("");
        setGitRefresh(value => value + 1);
        if (mutation.action === "switch") void loadGitBranches();
      }
    } catch (error) {
      if (scopeIsCurrent(scope) && gitOperationSequence.current === operationId) {
        setGitOperationError(error instanceof Error ? error.message : String(error));
        setGitOperationErrorScopeKey(scopeKey);
      }
    } finally {
      if (gitOperationSequence.current === operationId) setGitOperation(undefined);
    }
  };

  const loadGitBranches = async () => {
    const workspace = data.selectedWorkspace;
    if (workspace === undefined) return;
    const machineId = data.state.selectedMachine?.id ?? "local";
    const scope = { projectId: workspace.projectId, workspaceId: workspace.id, machineId };
    const scopeKey = JSON.stringify([machineId, workspace.projectId, workspace.id]);
    const path = machineId === "local" ? "pi-web-plugins/manifest.json" : `api/machines/${encodeURIComponent(machineId)}/pi-web-plugins/manifest.json`;
    try {
      const manifest = await readPluginManifest(path);
      if (!scopeIsCurrent(scope)) return;
      const pluginId = workspace.provider?.pluginId;
      const backendRevision = manifest?.plugins.find(plugin => plugin.id === pluginId)?.backendRevision;
      if (pluginId === undefined || backendRevision === undefined) throw new Error("This workspace does not provide a Git backend.");
      const branches = parseGitBranchesResponse(await requestPluginBackend({ pluginId, backendRevision, machineId, projectId: workspace.projectId, workspaceId: workspace.id }, GIT_BRANCHES_OPERATION, null));
      if (scopeIsCurrent(scope)) {
        setGitBranches(branches);
        setGitBranchesScopeKey(scopeKey);
      }
    } catch (error) {
      if (scopeIsCurrent(scope)) {
        setGitOperationError(error instanceof Error ? error.message : String(error));
        setGitOperationErrorScopeKey(scopeKey);
      }
    }
  };
  const startResize = (side: "left" | "right", event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = side === "left" ? leftWidth : rightWidth;
    const move = (e: PointerEvent) => {
      const delta = e.clientX - startX;
      if (side === "left") setLeftWidth(Math.max(220, Math.min(360, startWidth + delta)));
      else setRightWidth(Math.max(300, Math.min(520, startWidth - delta)));
    };
    const done = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", done);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", done, { once: true });
  };
  return <div className="rw-app" style={{ "--left-width": leftOpen ? leftWidth + "px" : "0px", "--right-width": rightOpen ? rightWidth + "px" : "0px" } as React.CSSProperties}>
    <div className="rw-workspace">
      <aside className="rw-sidebar" aria-label="Projects and sessions">
        <section className="rw-running">
          <div className="rw-section-heading"><strong>Running Sessions <span>({runningSessionsKnown ? activeActivities.length : "—"})</span></strong><button title="Refresh sessions" onClick={data.refresh}><Icon name="refresh-cw"/></button></div>
          {activeActivities.length > 0 ? activeActivities.map(activity => { const session = data.projects.flatMap(row => row.sessions).find(item => item.id === activity.sessionId); return <button className="rw-running-item" key={activity.sessionId} onClick={() => session && void data.selectSession(session)}><i className="rw-dot green"/><span>{session?.name || activity.label}</span><time>{activity.detail || activity.phase}</time></button>; }) : runningSessionsKnown ? <div className="rw-data-state">No active sessions reported.</div> : <div className="rw-data-state">{data.board?.unknownSources.length ? "Some session lists are still loading…" : "Loading sessions…"}</div>}
        </section>
        <div className="rw-projects-heading"><strong>Projects <span>({data.state.projectsLoad === "loaded" ? data.projects.length : "—"})</span></strong><div><button title="New session in the selected workspace" onClick={data.startSession} disabled={!data.selectedWorkspace}><Icon name="plus"/></button><button title="Settings" aria-label="Open settings" onClick={() => setSettingsOpen(true)}><Icon name="settings"/></button></div></div>
        <div className="rw-search"><Icon name="search"/><input aria-label="Search sessions" placeholder="Search sessions" value={projectQuery} onChange={e => setProjectQuery(e.target.value)}/>{projectQuery && <button onClick={() => setProjectQuery("")}><Icon name="x"/></button>}</div>
        <button className="rw-all-projects" onClick={data.refresh}>Refresh project list</button>
        {machineConnectionMessage && <div className="rw-data-error" role="alert">{machineConnectionMessage}<button onClick={data.state.error && data.state.machinesLoad !== "loaded" ? () => window.location.reload() : data.refresh}>{data.state.error && data.state.machinesLoad !== "loaded" ? "Reload after access changes" : "Retry"}</button></div>}
        {data.loading && !machineConnectionMessage && <div className="rw-data-state">Loading projects and sessions…</div>}
        {data.projectsError && <div className="rw-data-error">{data.projectsError}<button onClick={data.refresh}>Retry</button></div>}
        {!data.loading && !data.projectsError && <ProjectTree projects={projectRows} query={projectQuery} expanded={expanded} onExpanded={setExpanded} selectedProject={data.selectedProject?.id ?? ""} selectedSession={data.selectedSession?.id ?? ""} onSelectProject={selectProject} onSelectSession={selectSession} showMoreByProject={showMoreByProject} onShowMore={id => setShowMoreByProject(current => ({ ...current, [id]: !current[id] }))}/>}
        <div className="rw-sidebar-footer"><span>{data.state.selectedMachine?.name ?? "Local machine"}</span><span className="rw-connection" title={data.machineReadIssue ?? selectedMachineHealth?.error ?? data.state.error}><i className={machineConnectionLabel === "Connected" ? "" : "offline"}/> {machineConnectionLabel}</span></div>
      </aside>
      {leftOpen && <button className="rw-resize rw-resize-left" aria-label="Resize sidebar" onPointerDown={e => startResize("left", e)}/>}
      <main className="rw-conversation">
        <header className="rw-conversation-header">
          <button className="rw-icon-button" aria-label={leftOpen ? "Collapse sidebar" : "Expand sidebar"} onClick={() => setLeftOpen(v => !v)}><Icon name="panel-left"/></button>
          <div className="rw-session-heading"><strong>{data.selectedSession === undefined ? "No session selected" : data.selectedSession.name?.trim() || data.selectedSession.firstMessage || "Untitled session"}</strong><span>{data.selectedProject?.name ?? "Select a project"}</span></div>
          <div className="rw-header-actions"><button title="Session actions"><Icon name="zap"/></button><button title="Session settings"><Icon name="settings"/></button><button title={rightOpen ? "Collapse workbench" : "Open workbench"} aria-label={rightOpen ? "Collapse workbench" : "Open workbench"} onClick={() => setRightOpen(value => !value)}><Icon name="panel-right"/></button><button title="More actions"><Icon name="more-horizontal"/></button></div>
        </header>
        {data.state.activity && <div className="rw-subagents"><div className="rw-activity-line"><i className={data.state.activity.phase === "active" ? "rw-dot green" : "rw-dot"}/><strong>{data.state.activity.label}</strong><span>{data.state.activity.detail}</span></div></div>}
        <div className="rw-transcript" ref={transcriptRef} onScroll={event => {
          const transcript = event.currentTarget;
          const following = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 80;
          followTranscriptRef.current = following;
          setShowTranscriptJump(!following);
        }}>
          {data.sessionError && <div className="rw-data-error">{data.sessionError}</div>}
          {!data.selectedSession && <div className="rw-empty-state">Select a session to view its conversation.</div>}
          {data.selectedSession && !data.sessionError && data.messages.length === 0 && <div className="rw-empty-state">No messages in this session yet.</div>}
          {data.selectedSession && data.state.messagePageStart > 0 && <button className="rw-load-older" type="button" disabled={data.state.pageReadEnd !== undefined} onClick={() => {
            const transcript = transcriptRef.current;
            if (transcript !== null) olderPageAnchorRef.current = { scopeKey: transcriptScopeKey, scrollTop: transcript.scrollTop, scrollHeight: transcript.scrollHeight };
            void data.loadEarlierMessages();
          }}>{data.state.pageReadEnd === "earlier" ? "Loading earlier messages…" : "Load earlier messages"}</button>}
          {data.messages.map((message, index) => <ConversationMessage key={message.meta?.entryId ?? message.meta?.clientMessageId ?? index} message={message} streaming={data.sessionStatus?.isStreaming === true} session={data.selectedSession} machineId={data.state.selectedMachine?.id ?? "local"}/>)}
          {showTranscriptJump && <button className="rw-jump-bottom" type="button" onClick={() => { const transcript = transcriptRef.current; if (transcript !== null) transcript.scrollTo({ top: transcript.scrollHeight, behavior: "smooth" }); followTranscriptRef.current = true; setShowTranscriptJump(false); }}>Jump to latest</button>}
        </div>
        <div className="rw-chat-dock">
          {(queuedCount > 0 || backgroundCount > 0) && <div className="rw-live-summary">
            {queuedCount > 0 && <span><Icon name="list-ordered"/> {queuedCount} queued</span>}
            {backgroundCount > 0 && <span><Icon name="layers"/> {backgroundCount} background runs</span>}
          </div>}
          <details className="rw-disclosure"><summary><Icon name="bot"/><strong>Subagents</strong><span>({subagentExecutions.length})</span><small>Show details</small></summary><div className="rw-disclosure-content">{subagentExecutions.length === 0 ? "No subagent-named tool activity is recorded in this session." : subagentExecutions.map((part, index) => <div key={index}>{part.toolName}: {part.summary}{part.type === "toolExecution" ? ` · ${part.status}` : " · running"}</div>)}</div></details>
          <details className="rw-disclosure"><summary><Icon name="activity"/><strong>Background Runs</strong><span>({backgroundCount})</span><small>Show details</small></summary><div className="rw-disclosure-content">{backgroundCount === 0 ? "No background runs are reported." : "The session status reports the active count; this API response does not include individual process details."}</div></details>
          <details className="rw-disclosure"><summary><Icon name="file-text"/><strong>Edited Files</strong><span>({editedFiles.length})</span><small>Show details</small></summary><div className="rw-disclosure-content">{editedFiles.length === 0 ? "No file edits are recorded in the visible transcript." : editedFiles.map(file => <button className="rw-edited-file" key={file.path} onClick={() => { if (!file.path.startsWith("/")) { selectWorkspaceFile(file.path); setActiveTab("Files"); } }}><span>{file.path}</span><small>{file.status}</small></button>)}</div></details>
          {completionItems.length > 0 && <div className="rw-autocomplete" role="listbox" aria-label="Composer suggestions">{completionItems.map((item, index) => <button key={`${item.kind}-${item.insertText}-${index}`} role="option" aria-selected={index === completionIndex} onMouseDown={event => event.preventDefault()} onClick={() => void pickCompletion(item)}><strong>{item.insertText}</strong><span>{item.detail}{item.argumentHint ? ` ${item.argumentHint}` : ""}</span>{item.description && <small>{item.description}</small>}</button>)}</div>}
          <div className={"rw-composer " + (composerFocused ? "focused" : "")} onDragOver={event => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }} onDrop={event => { if (event.dataTransfer.files.length) { event.preventDefault(); void addAttachments(Array.from(event.dataTransfer.files)); } }} onPaste={event => { const files = Array.from(event.clipboardData.files); if (files.length) { event.preventDefault(); void addAttachments(files); } }}>
            <input ref={attachmentInputRef} type="file" multiple hidden onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ""; void addAttachments(files); }}/><button className="rw-add" title="Attach files" aria-label="Attach files" onClick={() => attachmentInputRef.current?.click()} disabled={!data.selectedSession || attaching}><Icon name="plus"/></button>
            <textarea ref={composerRef} value={data.draft} rows={1} placeholder={data.selectedSession ? "Message Pi..." : "Select a session first"} disabled={!data.selectedSession || data.selectedSession.archived === true} onChange={e => { data.setDraft(e.target.value); setComposerCursor(e.currentTarget.selectionStart); }} onSelect={e => setComposerCursor(e.currentTarget.selectionStart)} onFocus={() => setComposerFocused(true)} onBlur={() => setComposerFocused(false)} onKeyDown={e => { if ((e.key === "ArrowUp" || e.key === "ArrowDown") && completionItems.length > 0) { e.preventDefault(); setCompletionIndex(current => (current + (e.key === "ArrowDown" ? 1 : completionItems.length - 1)) % completionItems.length); return; } if ((e.key === "ArrowUp" || e.key === "ArrowDown") && browsePromptHistory(e.key === "ArrowUp" ? "older" : "newer")) { e.preventDefault(); return; } if (e.key === "Escape" && completionItems.length > 0) { e.preventDefault(); setCompletionItems([]); return; } if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); const completion = completionItems[completionIndex]; if (completion !== undefined) void pickCompletion(completion); else void sendMessage(); } }} />
            <div className="rw-composer-tools">
              {isWorking && <button title="Stop current work" onClick={() => void data.stopSession()}><Icon name="square"/></button>}
              <button title="Mention a project file" aria-label="Mention a project file" disabled={!data.selectedWorkspace} onClick={() => { const next = `${data.draft}@`; data.setDraft(next); setComposerCursor(next.length); requestAnimationFrame(() => { composerRef.current?.focus(); composerRef.current?.setSelectionRange(next.length, next.length); }); }}><Icon name="at-sign"/></button>
              <button className="rw-send" title="Send message" onClick={() => void sendMessage()} disabled={!data.selectedSession || data.selectedSession.archived === true || (data.draft.trim() === "" && attachments.length === 0) || sending || attaching}><Icon name={sending || attaching ? "loader-circle" : "send"}/></button>
            </div>
          </div>
          {attachments.length > 0 && <div className="rw-attachment-list">{attachments.map((item,index) => <span key={index} title={item.name}>{item.kind === "image" ? <><img src={`data:${item.mimeType};base64,${item.data}`} alt=""/><Icon name="image"/></> : <Icon name="file-text"/>}{item.name}<button aria-label={"Remove " + item.name} onClick={() => setAttachments(current => current.filter((_,i) => i !== index))}>×</button></span>)}</div>}
          {(sendError || attachmentError) && <div className="rw-composer-error">{sendError ?? attachmentError}</div>}
          <div className="rw-model-row">
            <span><Icon name="folder"/> {data.selectedWorkspace?.label ?? data.selectedProject?.name ?? "No workspace"}</span>
            <span className="rw-model-picker"><Icon name="cpu"/><select aria-label="Model provider and model" value={(model?.provider ?? "") + "/" + (model?.id ?? "")} disabled={!data.selectedSession || !data.modelCatalog?.models.length} onChange={async event => { const [provider,...parts] = event.target.value.split("/"); const id = parts.join("/"); if (!provider || !id || !data.selectedSession) return; try { await sessionsApi.setModel({id:data.selectedSession.id,cwd:data.selectedSession.cwd},provider,id,data.state.selectedMachine?.id ?? "local"); data.refresh(); } catch (error) { setSendError(error instanceof Error ? error.message : String(error)); } }}>{(data.modelCatalog?.models ?? []).map(item => <option key={item.provider + "/" + item.id} value={item.provider + "/" + item.id} disabled={!item.enabled && item.id !== model?.id}>{item.provider} / {item.name ?? item.id}{item.enabled ? "" : " (disabled)"}</option>)}</select></span>
            {data.thinkingOptions?.levels.length ? <span className="rw-thinking-picker"><Icon name="sliders"/><select aria-label="Thinking level" value={data.sessionStatus?.thinkingLevel ?? ""} disabled={!data.selectedSession} onChange={async event => { if (!data.selectedSession) return; try { await sessionsApi.setThinkingLevel({id:data.selectedSession.id,cwd:data.selectedSession.cwd},event.target.value,data.state.selectedMachine?.id ?? "local"); data.refresh(); } catch (error) { setSendError(error instanceof Error ? error.message : String(error)); } }}>{data.thinkingOptions.levels.map(level => <option key={level} value={level}>{level}</option>)}</select></span> : null}
          </div>
        </div>
        <footer className="rw-status">
          <span>{data.sessionStatus ? data.sessionStatus.tokens.input.toLocaleString() + " in / " + data.sessionStatus.tokens.output.toLocaleString() + " out" : "No session metrics"}</span>
          {contextUsage?.percent !== null && contextUsage?.percent !== undefined && <span>ctx {Math.round(contextUsage.percent)}%</span>}
          {data.sessionStatus?.gitBranch && <span><Icon name="git-branch"/> {data.sessionStatus.gitBranch}</span>}
          {data.sessionStatus && <small>$ {data.sessionStatus.cost.toFixed(4)}</small>}
        </footer>
      </main>
      {rightOpen && <button className="rw-resize rw-resize-right" aria-label="Resize workbench" onPointerDown={e => startResize("right", e)}/>}
      <aside className="rw-workbench">
        <div className="rw-workbench-tabs">{tabs.map(tab => <button key={tab} className={activeTab === tab ? "active" : ""} onClick={() => setActiveTab(tab)}>{tab === "Git" && <Icon name="git-branch"/>}{tab === "Files" && <Icon name="folder"/>}{tab === "Terminal" && <Icon name="terminal"/>}{tab === "Goals" && <Icon name="target"/>}{tab}</button>)}<button className="rw-workbench-collapse" aria-label={rightOpen ? "Collapse workbench" : "Expand workbench"} onClick={() => setRightOpen(v => !v)}><Icon name="panel-right"/></button></div>
        <div className="rw-workbench-toolbar">{activeTab === "Files" ? <><label><Icon name="search"/><input placeholder="Filter files..." value={fileFilter} onChange={e => setFileFilter(e.target.value)}/></label><input ref={uploadInputRef} type="file" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void uploadWorkspaceFile(file); }}/><button title="New file" onClick={() => void createWorkspaceFile()} disabled={!data.selectedWorkspace || fileSaving || fileDeleting}>New</button><button title="Upload file to the current folder" onClick={() => uploadInputRef.current?.click()} disabled={!data.selectedWorkspace || fileSaving || fileDeleting}><Icon name="upload"/></button></> : <><strong>{activeTab === "Goals" ? "Session overview" : activeTab}</strong>{activeTab === "Git" && <button title="Refresh Git status" onClick={() => setGitRefresh(value => value + 1)}><Icon name="refresh-cw"/></button>}</>}</div>
        {activeTab === "Files" ? <div className="rw-file-tree">
          {data.filesError && <div className="rw-data-error">{data.filesError}</div>}
          {visibleFileTreeError && <div className="rw-data-error">{visibleFileTreeError}</div>}
          {data.selectedWorkspace && <div className="rw-file-tree-path"><strong title={data.selectedWorkspace.path}>{data.selectedWorkspace.label}</strong>{data.filePath && <span>Current folder: {data.filePath}</span>}</div>}
          {!data.selectedWorkspace && <div className="rw-empty-state">Select a project to browse its files.</div>}
          {data.selectedWorkspace && fileFilter.trim() === "" && <WorkspaceFileTree entriesByDirectory={visibleFileTreeEntries} expandedPaths={visibleFileTreeExpanded} loadingPaths={visibleFileTreeLoadingPaths} selectedPath={data.selectedFile?.path} onToggleDirectory={toggleFileDirectory} onSelectFile={entry => selectWorkspaceFile(entry.path)}/>}
          {fileFilter.trim() !== "" && <div className="rw-file-search-results">{visibleFileSearchLoading ? <div className="rw-data-state">Searching files…</div> : visibleFileSearchResults.length === 0 ? <div className="rw-data-state">No files match this search.</div> : visibleFileSearchResults.map(result => <button key={result.path} className={data.selectedFile?.path === result.path ? "selected" : ""} title={`${result.path} · ${result.kind}`} onClick={() => selectWorkspaceFile(result.path)}><Icon name="file-text"/><span>{result.path}</span><small>{result.kind}</small></button>)}</div>}
          {visibleFileTreeLoadingPaths.has("") && <div className="rw-data-state">Loading project files…</div>}
          {visibleFileTreeEntries[""]?.length === 0 && !visibleFileTreeLoadingPaths.has("") && <div className="rw-data-state">No files in this workspace.</div>}
          {data.selectedFile && <section className="rw-file-editor">
            <div className="rw-file-editor-toolbar">
              <strong title={data.selectedFile.path}>{data.selectedFile.path.split("/").pop()}</strong>
              {data.selectedFile.truncated && <small>Preview truncated — editing disabled</small>}
              {data.selectedFile.binary && <small>Binary file — preview unavailable</small>}
              <button onClick={() => void saveOpenFile()} disabled={!fileDirty || fileSaving || data.selectedFile.binary || data.selectedFile.truncated}>{fileSaving ? "Saving…" : "Save"}</button>
              <button onClick={() => void deleteSelectedFile()} disabled={fileSaving || fileDeleting}>Delete</button>
              <button title="Close file" onClick={closeWorkspaceFile} disabled={fileSaving || fileDeleting}><Icon name="x"/></button>
            </div>
            <div className="rw-editor-tabs" role="tablist" aria-label="Open files">{openFilePaths.map(path => <button key={path} title={path} role="tab" aria-label={`${path}${fileDrafts.current.get(path)?.dirty ? ", unsaved changes" : ""}`} aria-selected={path === data.selectedFile?.path} className={path === data.selectedFile?.path ? "active" : ""} disabled={fileSaving || fileDeleting} onClick={() => selectWorkspaceFile(path)}>{path.split("/").pop()}{fileDrafts.current.get(path)?.dirty && <i aria-hidden="true"/>}</button>)}</div>
            {data.selectedFile.binary ? <div className="rw-data-state">Binary file — preview unavailable.</div> : data.selectedFile.truncated ? <div className="rw-data-state">Preview truncated — editing disabled.</div> : <WorkspaceCodeEditor key={`${data.selectedWorkspace?.id ?? ""}:${data.selectedFile.path}`} path={data.selectedFile.path} value={fileDraft} readOnly={fileSaving || fileDeleting} onChange={changeFileDraft} />}
          </section>}
        </div> : activeTab === "Terminal" ? (
          data.selectedWorkspace
            ? <ReactTerminalPanel key={data.selectedWorkspace.id} workspace={data.selectedWorkspace} machineId={data.state.selectedMachine?.id ?? "local"}/>
            : <div className="rw-empty-panel">Select a workspace before opening a terminal.</div>
        ) : activeTab === "Git" ? (
          <div className="rw-git-panel">
            <div className="rw-git-toolbar"><strong>Working tree</strong><button onClick={() => setGitRefresh(value => value + 1)} disabled={gitLoading || !data.selectedWorkspace}>Refresh</button></div>
            <div className="rw-git-actions">
              <button onClick={() => void performGitOperation({ action: "stage-all" })} disabled={visibleGitOperation !== undefined || !visibleGitStatus?.isGitRepo}>Stage all</button>
              <button onClick={() => void performGitOperation({ action: "unstage-all" })} disabled={visibleGitOperation !== undefined || !visibleGitStatus?.isGitRepo}>Unstage all</button>
              <button onClick={() => void loadGitBranches()} disabled={visibleGitOperation !== undefined || !visibleGitStatus?.isGitRepo}>Branches</button>
              <button onClick={() => void performGitOperation({ action: "fetch" })} disabled={visibleGitOperation !== undefined || !visibleGitStatus?.isGitRepo}>Fetch</button>
              <button onClick={() => void performGitOperation({ action: "pull" })} disabled={visibleGitOperation !== undefined || !visibleGitStatus?.isGitRepo}>Pull</button>
              <button onClick={() => void performGitOperation({ action: "push" })} disabled={visibleGitOperation !== undefined || !visibleGitStatus?.isGitRepo}>Push</button>
            </div>
            {visibleGitOperation && <div className="rw-data-state" role="status">Running Git {visibleGitOperation}…</div>}
            {visibleGitOperationError && <div className="rw-data-error" role="alert">{visibleGitOperationError}</div>}
            {visibleGitBranches && <label className="rw-branch-picker">Local branch<select value={visibleGitBranches.current ?? ""} onChange={event => { const branch = event.target.value; if (branch && branch !== visibleGitBranches.current && window.confirm(`Switch to ${branch}? Git will refuse if local changes would be overwritten.`)) void performGitOperation({ action: "switch", branch }); }}><option value="" disabled>Select branch</option>{visibleGitBranches.branches.map(branch => <option key={branch} value={branch}>{branch}</option>)}</select></label>}
            <form className="rw-git-commit" onSubmit={event => { event.preventDefault(); if (gitCommitMessage.trim() !== "") void performGitOperation({ action: "commit", message: gitCommitMessage }); }}><input aria-label="Commit message" placeholder="Commit message" value={gitCommitMessage} onChange={event => setGitCommitMessage(event.target.value)} maxLength={500} /><button type="submit" disabled={visibleGitOperation !== undefined || !visibleGitStatus?.files.some(file => file.index !== "unmodified" && file.index !== "untracked") || gitCommitMessage.trim() === ""}>Commit staged</button></form>
            {gitLoading && <div className="rw-data-state">Loading Git status…</div>}
            {visibleGitError && <div className="rw-data-error">{visibleGitError}<button onClick={() => setGitRefresh(value => value + 1)}>Retry</button></div>}
            {!gitLoading && !visibleGitError && visibleGitStatus && <>
              <div className="rw-git-card"><span className="rw-git-label">BRANCH</span><strong>{visibleGitStatus.branch ?? "Detached HEAD"}</strong><small>{visibleGitStatus.upstream ? `${visibleGitStatus.upstream} · ${visibleGitStatus.ahead ?? 0} ahead · ${visibleGitStatus.behind ?? 0} behind` : "No upstream branch reported"}</small></div>
              {!visibleGitStatus.isGitRepo ? <p>This workspace is not a Git repository.</p> : visibleGitStatus.files.length === 0 ? <p>Working tree clean.</p> : <section className="rw-git-changes"><strong>Changes ({visibleGitStatus.files.length})</strong>{visibleGitStatus.files.map(file => <div className="rw-git-change-row" key={file.path}><button className={gitSelectedPath === file.path ? "selected" : ""} onClick={() => { setGitSelectedPath(file.path); setGitDiffs(undefined); }}><span>{file.path}</span><small>{[file.index !== "unmodified" ? `staged ${file.index}` : "", file.workingTree !== "unmodified" ? file.workingTree : ""].filter(Boolean).join(" · ")}</small></button><button aria-label={`Stage ${file.path}`} disabled={visibleGitOperation !== undefined} onClick={() => void performGitOperation({ action: "stage", paths: [file.path] })}>Stage</button>{file.index !== "unmodified" && file.index !== "untracked" && <button aria-label={`Unstage ${file.path}`} disabled={visibleGitOperation !== undefined} onClick={() => void performGitOperation({ action: "unstage", paths: [file.path] })}>Unstage</button>}{file.workingTree !== "unmodified" && file.workingTree !== "untracked" && <button aria-label={`Discard changes to ${file.path}`} disabled={visibleGitOperation !== undefined} onClick={() => { if (window.confirm(`Discard tracked working-tree changes to ${file.path}?`)) void performGitOperation({ action: "discard", paths: [file.path] }); }}>Discard</button>}</div>)}</section>}
              {gitSelectedPath && <section className="rw-git-diff"><strong>{gitSelectedPath}</strong>{gitDiffs?.path === gitSelectedPath && gitDiffs.scopeKey === selectedScopeKey ? [gitDiffs.staged, gitDiffs.unstaged].map((diff, index) => diff?.diff ? <pre key={index} aria-label={index === 0 ? "Staged diff" : "Unstaged diff"}>{diff.diff.split("\n").map((line, lineIndex) => <span className={line.startsWith("+") && !line.startsWith("+++") ? "added" : line.startsWith("-") && !line.startsWith("---") ? "removed" : ""} key={lineIndex}>{line}{"\n"}</span>)}</pre> : null) : <p>Loading selected diff…</p>}</section>}
            </>}
            {!data.selectedWorkspace && <div className="rw-empty-state">Select a workspace to inspect Git status.</div>}
          </div>
        ) : (
          <div className="rw-goals-panel">
            <section><span className="rw-git-label">SESSION OBJECTIVE</span><p>{data.selectedSession?.firstMessage || "No initial objective is recorded for this session."}</p></section>
            <section><span className="rw-git-label">CURRENT ACTIVITY</span><p>{data.sessionStatus?.activity?.label ?? "No active step reported."}</p>{data.sessionStatus?.activity?.detail && <small>{data.sessionStatus.activity.detail}</small>}</section>
            <section className="rw-goal-metrics">
              <span>{data.sessionStatus?.pendingMessageCount ?? 0} pending messages</span>
              <span>{data.sessionStatus?.backgroundRunCount ?? 0} background runs</span>
            </section>
          </div>
        )}
      </aside>
    </div>
    <ReactSettingsDialog data={data} open={settingsOpen} onClose={() => setSettingsOpen(false)}/>
  </div>;
}
