import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { capturePromptAttachments, type CapturedAttachment } from "../promptAttachmentCapture";
import { readBlobAsBase64 } from "../sentImages";
import { filesApi, requestPluginBackend, sessionsApi } from "../api";
import { readPluginManifest } from "../plugins/external";
import { detectPromptCompletionTrigger, fileCompletionInsertText, modelCompletionChoices, asksExtensionCompletion } from "../promptCompletions";
import { historyIndexStep, loadPromptHistory, recallPromptHistoryAttachments, rememberPromptHistory, type HistoryDirection } from "../promptHistory";
import { machineSessionKey } from "../machineKeys";
import { MOBILE_NAVIGATION_MEDIA_QUERY } from "../breakpoints";
import type { CompletionItem } from "../components/shared";
import { GIT_BRANCHES_OPERATION, GIT_DIFF_OPERATION, GIT_MUTATE_OPERATION, GIT_STATUS_OPERATION, parseGitBranchesResponse, parseGitDiffResponse, parseGitStatusResponse, type GitBranchesResponse, type GitDiffResponse, type GitStatusResponse, type GitMutation } from "../../../../pi-web-plugins/git/browser/git-contract";
import { Icon } from "./icons";
import { ConversationMessage, editedFilesFromMessages } from "./ConversationMessage";
import { groupChatMessages } from "../chatGroups";
import { ActivityRecordsPanel, collectEditedFileDiffs, collectToolRecords, summarizeActivityGroup } from "./ActivityWorkbenchPanels";
import { ProjectTree } from "./ProjectTree";
import { useReactWorkspaceData } from "./useReactWorkspaceData";
import { ReactTerminalPanel } from "./ReactTerminalPanel";
import { useWorkspaceFiles } from "./useWorkspaceFiles";
import { WorkspaceFilesPanel } from "./WorkspaceFilesPanel";
import { WorkspaceUnsavedDialog } from "./WorkspaceFileDialogs";
import { ReactSettingsDialog } from "./ReactSettingsDialog";
import { ReactPluginDialogLayer } from "./ReactPluginDialogLayer";
import { usePluginRegistry } from "./usePluginRegistry";
import { SessionActionsMenu } from "./SessionActionsMenu";
import { AddProjectDialog } from "./AddProjectDialog";
import { projectActionIsPending, sessionActionIsPending } from "./reactInstantActions";
import { gitCanCommit, gitChangeGroups, gitChangeLabel } from "./gitPresentation";
import { ConfirmDialog } from "./ConfirmDialog";

type WorkbenchTab = "Git" | "Files" | "Terminal" | "Goals" | "Subagents" | "Background Runs" | "Edited Files";
interface ReactWorkspaceScope {
  readonly projectId: string | undefined;
  readonly workspaceId: string | undefined;
  readonly machineId: string;
}

const tabs: WorkbenchTab[] = ["Git", "Files", "Terminal", "Goals", "Subagents", "Background Runs", "Edited Files"];
const GIT_REMOTE_REQUEST_TIMEOUT_MS = 130_000;
export function ReactWorkspaceApp() {
  const data = useReactWorkspaceData();
  useEffect(() => {
    if (!data.undoAvailable) return;
    const undo = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "z" || !(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey || event.isComposing) return;
      const origin = event.composedPath()[0];
      if (origin instanceof HTMLElement && (origin.isContentEditable || origin instanceof HTMLInputElement || origin instanceof HTMLTextAreaElement || origin instanceof HTMLSelectElement)) return;
      event.preventDefault();
      data.undoSessionAction();
    };
    window.addEventListener("keydown", undo);
    return () => window.removeEventListener("keydown", undo);
  }, [data.undoAvailable, data.undoSessionAction]);
  const selectedMachineId = data.state.selectedMachine?.id ?? "local";
  const pluginRuntime = usePluginRegistry({ machineId: selectedMachineId });
  const selectedSessionActionPending = data.selectedSession !== undefined && sessionActionIsPending(data.instantActions, selectedMachineId, data.selectedSession.id);
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
  const narrowScreen = window.matchMedia(MOBILE_NAVIGATION_MEDIA_QUERY).matches;
  const [activeTab, setActiveTab] = useState<WorkbenchTab>("Files");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [addProjectTarget, setAddProjectTarget] = useState<{ machineId: string; machineName: string }>();
  const [projectQuery, setProjectQuery] = useState("");
  const [leftWidth, setLeftWidth] = useState(327);
  const [rightWidth, setRightWidth] = useState(402);
  const [leftOpen, setLeftOpen] = useState(!narrowScreen);
  const [rightOpen, setRightOpen] = useState(!narrowScreen);
  const [selectedEditedFile, setSelectedEditedFile] = useState<string>();
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
  const workspaceFiles = useWorkspaceFiles({ projectId: data.selectedWorkspace?.projectId, workspaceId: data.selectedWorkspace?.id, machineId: selectedMachineId });
  const [pendingScopeChange, setPendingScopeChange] = useState<{ readonly description: string; readonly run: () => void }>();
  const [scopeChangeBusy, setScopeChangeBusy] = useState(false);
  const [scopeChangeError, setScopeChangeError] = useState<string>();
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<CapturedAttachment[]>([]);
  const historyRecallRef = useRef(0);
  const [attachmentError, setAttachmentError] = useState<string>();
  const [attaching, setAttaching] = useState(false);
  const [gitRefresh, setGitRefresh] = useState(0);
  const [gitStatus, setGitStatus] = useState<GitStatusResponse>();
  const [gitStatusScopeKey, setGitStatusScopeKey] = useState("");
  const [gitSelectedPath, setGitSelectedPath] = useState<string>();
  const [gitDiffs, setGitDiffs] = useState<{ path: string; scopeKey: string; unstaged?: GitDiffResponse; staged?: GitDiffResponse }>();
  const [gitDiffError, setGitDiffError] = useState<{ message: string; path: string; scopeKey: string }>();
  const [gitError, setGitError] = useState<string>();
  const [gitErrorScopeKey, setGitErrorScopeKey] = useState("");
  const [gitLoading, setGitLoading] = useState(false);
  const [gitOperation, setGitOperation] = useState<string>();
  const [gitOperationScopeKey, setGitOperationScopeKey] = useState("");
  const [gitOperationError, setGitOperationError] = useState<string>();
  const [gitOperationErrorScopeKey, setGitOperationErrorScopeKey] = useState("");
  const [gitOperationSuccess, setGitOperationSuccess] = useState<string>();
  const [gitOperationSuccessScopeKey, setGitOperationSuccessScopeKey] = useState("");
  const [gitBranches, setGitBranches] = useState<GitBranchesResponse>();
  const [gitBranchesScopeKey, setGitBranchesScopeKey] = useState("");
  const [gitCommitMessage, setGitCommitMessage] = useState("");
  const [gitDiscardTarget, setGitDiscardTarget] = useState<{ path: string; scopeKey: string }>();
  const gitOperationSequence = useRef(0);
  const gitOperationInFlight = useRef(false);
  const visibleGitOperation = gitOperationScopeKey === selectedScopeKey ? gitOperation : undefined;
  const gitMutationBusy = gitOperation !== undefined;
  const visibleGitOperationError = gitOperationErrorScopeKey === selectedScopeKey ? gitOperationError : undefined;
  const visibleGitOperationSuccess = gitOperationSuccessScopeKey === selectedScopeKey ? gitOperationSuccess : undefined;
  const visibleGitStatus = gitStatusScopeKey === selectedScopeKey ? gitStatus : undefined;
  const visibleGitError = gitErrorScopeKey === selectedScopeKey ? gitError : undefined;
  const visibleGitDiffError = gitDiffError !== undefined && gitDiffError.path === gitSelectedPath && gitDiffError.scopeKey === selectedScopeKey ? gitDiffError : undefined;
  const visibleGitBranches = gitBranchesScopeKey === selectedScopeKey ? gitBranches : undefined;
  const projectRows = data.projects.map(row => ({
    id: row.project.id,
    name: row.project.name,
    pending: projectActionIsPending(data.instantActions, selectedMachineId, row.project.id),
    sessions: row.sessions.map(session => ({ id: session.id, name: session.name?.trim() || session.firstMessage || "New session", session })),
    unknown: row.unknown,
  }));
  const runScopeChange = (description: string, run: () => void) => {
    if (!workspaceFiles.hasUnsavedChanges) {
      run();
      return;
    }
    setScopeChangeError(undefined);
    setPendingScopeChange({ description, run });
  };
  const saveThenScopeChange = async () => {
    const pending = pendingScopeChange;
    if (pending === undefined || scopeChangeBusy) return;
    setScopeChangeBusy(true);
    setScopeChangeError(undefined);
    try {
      const summary = await workspaceFiles.saveAll();
      if (summary.failed > 0 || summary.conflicts > 0) {
        setScopeChangeError(summary.conflicts > 0
          ? "Some files changed on disk since they were opened. Resolve those files before leaving."
          : "Some files could not be saved. Your drafts are still here; cancel to keep editing.");
        return;
      }
      setPendingScopeChange(undefined);
      pending.run();
    } finally {
      setScopeChangeBusy(false);
    }
  };
  const discardThenScopeChange = () => {
    const pending = pendingScopeChange;
    if (pending === undefined) return;
    workspaceFiles.discardAll();
    setPendingScopeChange(undefined);
    setScopeChangeError(undefined);
    pending.run();
  };
  const selectProject = (id: string) => {
    runScopeChange("Switching projects will discard unsaved file edits.", () => {
      void data.selectProject(id);
      setExpanded(current => current.includes(id) ? current : [...current, id]);
    });
  };
  const selectSession = (projectId: string, sessionId: string) => {
    const session = data.projects.flatMap(row => row.sessions).find(item => item.id === sessionId);
    if (session === undefined) return;
    const changesFileScope = data.selectedProject?.id !== projectId || session.cwd !== data.selectedWorkspace?.path;
    if (!changesFileScope) {
      void data.selectSession(session);
      return;
    }
    runScopeChange("Switching workspaces will discard unsaved file edits.", () => { void data.selectSession(session); });
  };
  useEffect(() => {
    if (!workspaceFiles.hasUnsavedChanges) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [workspaceFiles.hasUnsavedChanges]);
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
  const activityGroups = useMemo(() => groupChatMessages(data.messages), [data.messages]);
  const subagentRecords = useMemo(() => collectToolRecords(data.messages, /subagent/i), [data.messages]);
  const backgroundRecords = useMemo(() => collectToolRecords(data.messages, /background/i), [data.messages]);
  const backgroundBadgeCount = backgroundRecords.length || backgroundCount;
  const editedFileDiffs = useMemo(() => collectEditedFileDiffs(data.messages), [data.messages]);
  const transcriptScopeKey = JSON.stringify([data.state.selectedMachine?.id ?? "local", data.selectedSession?.id]);
  useLayoutEffect(() => {
    followTranscriptRef.current = true;
    setShowTranscriptJump(false);
    olderPageAnchorRef.current = undefined;
    setSelectedEditedFile(undefined);
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
    const workspace = data.selectedWorkspace;
    const machineId = data.state.selectedMachine?.id ?? "local";
    if (activeTab !== "Git") return;
    if (workspace === undefined) {
      setGitStatus(undefined);
      setGitStatusScopeKey(selectedScopeKey);
      setGitDiffs(undefined);
      setGitDiffError(undefined);
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
    setGitDiffError(undefined);
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
  }, [activeTab, data.selectedWorkspace?.id, data.selectedWorkspace?.provider?.pluginId, data.selectedWorkspace?.provider?.capabilities.request, data.state.selectedMachine?.id, gitRefresh, selectedScopeKey]);

  useEffect(() => {
    const workspace = data.selectedWorkspace;
    const path = gitSelectedPath;
    const machineId = data.state.selectedMachine?.id ?? "local";
    if (activeTab !== "Git" || workspace === undefined || path === undefined) return;
    let active = true;
    setGitDiffError(undefined);
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
        setGitDiffError({ message: error instanceof Error ? error.message : String(error), path, scopeKey: selectedScopeKey });
      }
    });
    return () => { active = false; };
  }, [activeTab, data.selectedWorkspace?.id, data.selectedWorkspace?.provider?.pluginId, data.selectedWorkspace?.provider?.capabilities.request, data.state.selectedMachine?.id, gitSelectedPath, selectedScopeKey]);

  useEffect(() => {
    if (gitDiscardTarget !== undefined && gitDiscardTarget.scopeKey !== selectedScopeKey) setGitDiscardTarget(undefined);
  }, [gitDiscardTarget, selectedScopeKey]);

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

  const performGitOperation = async (mutation: GitMutation) => {
    const workspace = data.selectedWorkspace;
    if (workspace === undefined || gitOperationInFlight.current) return;
    gitOperationInFlight.current = true;
    const machineId = data.state.selectedMachine?.id ?? "local";
    const scope = { projectId: workspace.projectId, workspaceId: workspace.id, machineId };
    const scopeKey = JSON.stringify([machineId, workspace.projectId, workspace.id]);
    const operationId = ++gitOperationSequence.current;
    const manifestPath = machineId === "local" ? "pi-web-plugins/manifest.json" : `api/machines/${encodeURIComponent(machineId)}/pi-web-plugins/manifest.json`;
    setGitOperation(mutation.action);
    setGitOperationScopeKey(scopeKey);
    setGitOperationError(undefined);
    setGitOperationErrorScopeKey(scopeKey);
    setGitOperationSuccess(undefined);
    setGitOperationSuccessScopeKey(scopeKey);
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
        setGitOperationSuccess(gitMutationSuccess(mutation));
        setGitOperationSuccessScopeKey(scopeKey);
        setGitRefresh(value => value + 1);
        if (mutation.action === "switch") void loadGitBranches();
      }
    } catch (error) {
      if (scopeIsCurrent(scope) && gitOperationSequence.current === operationId) {
        setGitOperationError(error instanceof Error ? error.message : String(error));
        setGitOperationErrorScopeKey(scopeKey);
      }
    } finally {
      if (gitOperationSequence.current === operationId) {
        gitOperationInFlight.current = false;
        setGitOperation(undefined);
      }
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
  const moveGitSelection = (files: readonly GitStatusResponse["files"][number][], path: string, direction: -1 | 1) => {
    if (files.length < 2) return;
    const currentIndex = files.findIndex(file => file.path === path);
    const nextIndex = (Math.max(currentIndex, 0) + direction + files.length) % files.length;
    setGitSelectedPath(files[nextIndex]?.path);
    setGitDiffs(undefined);
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
        <div className="rw-projects-heading"><strong>Projects <span>({data.state.projectsLoad === "loaded" ? data.projects.length : "—"})</span></strong><div><button title="Add project" aria-label="Add project" onClick={() => setAddProjectTarget({ machineId: selectedMachineId, machineName: data.state.selectedMachine?.name ?? "Local machine" })}><Icon name="folder-plus"/></button><button title="New session in the selected workspace" onClick={data.startSession} disabled={!data.selectedWorkspace}><Icon name="plus"/></button><button title="Settings" aria-label="Open settings" onClick={() => setSettingsOpen(true)}><Icon name="settings"/></button></div></div>
        <div className="rw-search"><Icon name="search"/><input aria-label="Search sessions" placeholder="Search sessions" value={projectQuery} onChange={e => setProjectQuery(e.target.value)}/>{projectQuery && <button onClick={() => setProjectQuery("")}><Icon name="x"/></button>}</div>
        <button className="rw-all-projects" onClick={data.refresh}>Refresh project list</button>
        {machineConnectionMessage && <div className="rw-data-error" role="alert">{machineConnectionMessage}<button onClick={data.state.error && data.state.machinesLoad !== "loaded" ? () => window.location.reload() : data.refresh}>{data.state.error && data.state.machinesLoad !== "loaded" ? "Reload after access changes" : "Retry"}</button></div>}
        {data.loading && !machineConnectionMessage && <div className="rw-data-state">Loading projects and sessions…</div>}
        {data.projectsError && <div className="rw-data-error">{data.projectsError}<button onClick={data.refresh}>Retry</button></div>}
        {!data.loading && !data.projectsError && <ProjectTree projects={projectRows} query={projectQuery} expanded={expanded} onExpanded={setExpanded} selectedProject={data.selectedProject?.id ?? ""} selectedSession={data.selectedSession?.id ?? ""} onSelectProject={selectProject} onSelectSession={selectSession} onCloseProject={id => { const project = data.projects.find(row => row.project.id === id)?.project; if (project !== undefined) data.closeProject(project); }} showMoreByProject={showMoreByProject} onShowMore={id => setShowMoreByProject(current => ({ ...current, [id]: !current[id] }))}/>}
        <div className="rw-sidebar-footer"><span>{data.state.selectedMachine?.name ?? "Local machine"}</span><span className="rw-connection" title={data.machineReadIssue ?? selectedMachineHealth?.error ?? data.state.error}><i className={machineConnectionLabel === "Connected" ? "" : "offline"}/> {machineConnectionLabel}</span></div>
      </aside>
      {leftOpen && <button className="rw-resize rw-resize-left" aria-label="Resize sidebar" onPointerDown={e => startResize("left", e)}/>}
      <main className="rw-conversation">
        <header className="rw-conversation-header">
          <button className="rw-icon-button" aria-label={leftOpen ? "Collapse sidebar" : "Expand sidebar"} onClick={() => setLeftOpen(v => !v)}><Icon name="panel-left"/></button>
          <div className="rw-session-heading"><strong>{data.selectedSession === undefined ? "No session selected" : data.selectedSession.name?.trim() || data.selectedSession.firstMessage || "Untitled session"}</strong><span>{data.selectedProject?.name ?? "Select a project"}</span></div>
          <div className="rw-header-actions"><button className="rw-activity-shortcut" title="Subagents" aria-label={`Subagents (${subagentRecords.length})`} disabled={!data.selectedSession} onClick={() => { setActiveTab("Subagents"); setRightOpen(true); }}><Icon name="bot"/><span>{subagentRecords.length}</span></button><button className="rw-activity-shortcut" title="Background Runs" aria-label={`Background Runs (${backgroundBadgeCount})`} disabled={!data.selectedSession} onClick={() => { setActiveTab("Background Runs"); setRightOpen(true); }}><Icon name="activity"/><span>{backgroundBadgeCount}</span></button><button className="rw-activity-shortcut" title="Edited Files" aria-label={`Edited Files (${editedFiles.length})`} disabled={!data.selectedSession} onClick={() => { setActiveTab("Edited Files"); setRightOpen(true); }}><Icon name="file-text"/><span>{editedFiles.length}</span></button><SessionActionsMenu session={data.selectedSession} machineId={selectedMachineId} pending={selectedSessionActionPending} rename={name => data.selectedSession ? data.renameSession(data.selectedSession, name) : Promise.resolve()} archive={(session, machineId) => data.archiveSession(session, machineId)} restore={(session, machineId) => data.restoreSession(session, machineId)} deleteArchived={(session, machineId) => data.deleteArchivedSession(session, machineId)}/><button title={rightOpen ? "Collapse workbench" : "Open workbench"} aria-label={rightOpen ? "Collapse workbench" : "Open workbench"} onClick={() => setRightOpen(value => !value)}><Icon name="panel-right"/></button></div>
        </header>
        {data.state.activity && <div className="rw-subagents"><div className="rw-activity-line"><i className={data.state.activity.phase === "active" ? "rw-dot green" : "rw-dot"}/><strong>{data.state.activity.label}</strong><span>{data.state.activity.detail}</span></div></div>}
        <div className="rw-transcript" ref={transcriptRef} onScroll={event => {
          const transcript = event.currentTarget;
          const following = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 80;
          followTranscriptRef.current = following;
          setShowTranscriptJump(!following);
        }}>
          {data.undoAvailable && <div className="rw-session-undo" role="status" onPointerEnter={() => data.pauseSessionUndo("pointer")} onPointerLeave={() => data.resumeSessionUndo("pointer")} onFocus={() => data.pauseSessionUndo("focus")} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) data.resumeSessionUndo("focus"); }}><span>{data.instantActions.at(-1)?.kind === "delete-archived" ? "Archived session deletion is waiting" : data.instantActions.at(-1)?.kind === "close-project" ? "Project close is waiting" : "Session change is pending"}</span><button type="button" onClick={data.undoSessionAction}>Undo</button></div>}
          {data.sessionActionNotice && <div className="rw-session-action-notice" role="status">{data.sessionActionNotice}</div>}
          {data.sessionError && <div className="rw-data-error">{data.sessionError}</div>}
          {!data.selectedSession && <div className="rw-empty-state">Select a session to view its conversation.</div>}
          {data.selectedSession && !data.sessionError && data.messages.length === 0 && <div className="rw-empty-state">No messages in this session yet.</div>}
          {data.selectedSession && data.state.messagePageStart > 0 && <button className="rw-load-older" type="button" disabled={data.state.pageReadEnd !== undefined} onClick={() => {
            const transcript = transcriptRef.current;
            if (transcript !== null) olderPageAnchorRef.current = { scopeKey: transcriptScopeKey, scrollTop: transcript.scrollTop, scrollHeight: transcript.scrollHeight };
            void data.loadEarlierMessages();
          }}>{data.state.pageReadEnd === "earlier" ? "Loading earlier messages…" : "Load earlier messages"}</button>}
          {activityGroups.map((group, index) => group.kind === "group" ? <details className="rw-activity-group" key={"activity-" + group.startIndex}><summary><Icon name="layers"/><strong>{summarizeActivityGroup(group.messages)}</strong><small>{group.messages.length} messages · Click to expand</small></summary><div className="rw-activity-group-content">{group.messages.map((message, messageIndex) => <ConversationMessage key={message.meta?.entryId ?? message.meta?.clientMessageId ?? (group.startIndex + "-" + messageIndex)} message={message} streaming={data.sessionStatus?.isStreaming === true} session={data.selectedSession} machineId={data.state.selectedMachine?.id ?? "local"}/>)}</div></details> : <ConversationMessage key={group.message.meta?.entryId ?? group.message.meta?.clientMessageId ?? group.index ?? index} message={group.message} streaming={data.sessionStatus?.isStreaming === true} session={data.selectedSession} machineId={data.state.selectedMachine?.id ?? "local"}/>)}
          {showTranscriptJump && <button className="rw-jump-bottom" type="button" onClick={() => { const transcript = transcriptRef.current; if (transcript !== null) transcript.scrollTo({ top: transcript.scrollHeight, behavior: "smooth" }); followTranscriptRef.current = true; setShowTranscriptJump(false); }}>Jump to latest</button>}
        </div>
        <div className="rw-chat-dock">
          {queuedCount > 0 && <div className="rw-live-summary"><span><Icon name="list-ordered"/> {queuedCount} queued</span></div>}
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
        <div className="rw-workbench-tabs">{tabs.map(tab => <button key={tab} title={tab} aria-label={tab} className={activeTab === tab ? "active" : ""} onClick={() => setActiveTab(tab)}><Icon name={tab === "Git" ? "git-branch" : tab === "Files" ? "folder" : tab === "Terminal" ? "terminal" : tab === "Goals" ? "target" : tab === "Subagents" ? "bot" : tab === "Background Runs" ? "activity" : "file-text"}/></button>)}<button className="rw-workbench-collapse" aria-label={rightOpen ? "Collapse workbench" : "Expand workbench"} onClick={() => setRightOpen(v => !v)}><Icon name="panel-right"/></button></div>
        {activeTab === "Files" ? <WorkspaceFilesPanel
          files={workspaceFiles}
          rootLabel={data.selectedWorkspace?.label ?? data.selectedProject?.name ?? "Workspace"}
          projectId={data.selectedWorkspace?.projectId}
          workspaceId={data.selectedWorkspace?.id}
          machineId={selectedMachineId}
          hasWorkspace={data.selectedWorkspace !== undefined}
        /> : <>
          <div className="rw-workbench-toolbar"><strong>{activeTab === "Goals" ? "Session overview" : activeTab}</strong>{activeTab === "Git" && <button title="Refresh Git status" onClick={() => setGitRefresh(value => value + 1)}><Icon name="refresh-cw"/></button>}</div>
        {activeTab === "Subagents" ? <ActivityRecordsPanel records={subagentRecords} empty="No subagent records are present in this session."/> :
         activeTab === "Background Runs" ? <ActivityRecordsPanel records={backgroundRecords} empty={backgroundCount > 0 ? backgroundCount + " background work item(s) are currently reported by session status. Individual historical records are not exposed by the current API." : "No background-run records are present in this session."}/> :
         activeTab === "Edited Files" ? <div className="rw-edited-files-panel">
           <div className="rw-edited-files-list">{editedFiles.length === 0 ? <div className="rw-empty-panel">No edited files are recorded in this session.</div> : editedFiles.map(file => <button className={selectedEditedFile === file.path ? "selected" : ""} key={file.path} onClick={() => setSelectedEditedFile(file.path)}><Icon name="file-text"/><span>{file.path}</span><small>{file.status}</small></button>)}</div>
           {selectedEditedFile && <section className="rw-session-diff"><div className="rw-git-diff-heading"><strong title={selectedEditedFile}>{selectedEditedFile}</strong><span>Session changes</span></div>{editedFileDiffs.find(item => item.path === selectedEditedFile)?.diff ? <pre>{editedFileDiffs.find(item => item.path === selectedEditedFile)?.diff}</pre> : <div className="rw-empty-panel">A cumulative session-level diff is not available in the recorded tool data for this file.</div>}</section>}
         </div> :
         activeTab === "Terminal" ? (
          data.selectedWorkspace
            ? <ReactTerminalPanel key={data.selectedWorkspace.id} workspace={data.selectedWorkspace} machineId={data.state.selectedMachine?.id ?? "local"}/>
            : <div className="rw-empty-panel">Select a workspace before opening a terminal.</div>
        ) : activeTab === "Git" ? (
          <div className="rw-git-panel">
            <div className="rw-git-toolbar"><strong>Working tree</strong><button onClick={() => setGitRefresh(value => value + 1)} disabled={gitLoading || gitMutationBusy || !data.selectedWorkspace}>Refresh</button></div>
            <div className="rw-git-actions">
              <button onClick={() => void performGitOperation({ action: "stage-all" })} disabled={gitMutationBusy || !visibleGitStatus?.isGitRepo}>Stage all</button>
              <button onClick={() => void performGitOperation({ action: "unstage-all" })} disabled={gitMutationBusy || !visibleGitStatus?.isGitRepo}>Unstage all</button>
              <button onClick={() => void loadGitBranches()} disabled={gitMutationBusy || !visibleGitStatus?.isGitRepo}>{visibleGitBranches ? "Reload branches" : "Load branches"}</button>
              <button onClick={() => void performGitOperation({ action: "fetch" })} disabled={gitMutationBusy || !visibleGitStatus?.isGitRepo}>Fetch</button>
              <button onClick={() => void performGitOperation({ action: "pull" })} disabled={gitMutationBusy || !visibleGitStatus?.isGitRepo}>Pull</button>
              <button onClick={() => void performGitOperation({ action: "push" })} disabled={gitMutationBusy || !visibleGitStatus?.isGitRepo}>Push</button>
            </div>
            {visibleGitOperation && <div className="rw-data-state" role="status">Running Git {visibleGitOperation}…</div>}
            {gitMutationBusy && !visibleGitOperation && <div className="rw-data-state" role="status">A Git operation is still running in another workspace.</div>}
            {visibleGitOperationError && <div className="rw-data-error" role="alert">{visibleGitOperationError}</div>}
            {visibleGitOperationSuccess && <div className="rw-git-success" role="status">{visibleGitOperationSuccess}</div>}
            {visibleGitBranches && <label className="rw-branch-picker">Local branch<select value={visibleGitBranches.current ?? ""} disabled={gitMutationBusy} onChange={event => { const branch = event.target.value; if (branch && branch !== visibleGitBranches.current && window.confirm(`Switch to ${branch}? Git will refuse if local changes would be overwritten.`)) void performGitOperation({ action: "switch", branch }); }}><option value="" disabled>Select branch</option>{visibleGitBranches.branches.map(branch => <option key={branch} value={branch}>{branch}</option>)}</select></label>}
            <form className="rw-git-commit" onSubmit={event => { event.preventDefault(); if (gitCommitMessage.trim() !== "") void performGitOperation({ action: "commit", message: gitCommitMessage }); }}><input aria-label="Commit message" placeholder="Commit message" value={gitCommitMessage} onChange={event => setGitCommitMessage(event.target.value)} maxLength={500} /><button type="submit" disabled={gitMutationBusy || !gitCanCommit(visibleGitStatus) || gitCommitMessage.trim() === ""}>Commit staged</button></form>
            {gitLoading && <div className="rw-data-state">Loading Git status…</div>}
            {visibleGitError && <div className="rw-data-error" role="alert">{visibleGitError}<button onClick={() => setGitRefresh(value => value + 1)}>Retry</button></div>}
            {!gitLoading && !visibleGitError && visibleGitStatus && <>
              <div className="rw-git-card"><span className="rw-git-label">BRANCH</span><strong>{visibleGitStatus.branch ?? "Detached HEAD"}</strong><small>{visibleGitStatus.upstream ? `${visibleGitStatus.upstream} · ${visibleGitStatus.ahead ?? 0} ahead · ${visibleGitStatus.behind ?? 0} behind` : "No upstream branch reported"}</small></div>
              {!visibleGitStatus.isGitRepo ? <p>This workspace is not a Git repository.</p> : visibleGitStatus.files.length === 0 ? <p>Working tree clean.</p> : <>
                {renderGitChangeSection("Staged changes", gitChangeGroups(visibleGitStatus.files).staged, "staged", gitSelectedPath, gitMutationBusy, path => { setGitSelectedPath(path); setGitDiffs(undefined); }, file => void performGitOperation({ action: "unstage", paths: [file.path] }), undefined)}
                {renderGitChangeSection("Unstaged changes", gitChangeGroups(visibleGitStatus.files).unstaged, "unstaged", gitSelectedPath, gitMutationBusy, path => { setGitSelectedPath(path); setGitDiffs(undefined); }, file => void performGitOperation({ action: "stage", paths: [file.path] }), file => setGitDiscardTarget({ path: file.path, scopeKey: selectedScopeKey }))}
              </>}
              {gitSelectedPath && <section className="rw-git-diff"><div className="rw-git-diff-heading"><strong title={gitSelectedPath}>{gitSelectedPath}</strong><div><button aria-label="Previous changed file" disabled={!visibleGitStatus.isGitRepo || visibleGitStatus.files.length < 2} onClick={() => moveGitSelection(visibleGitStatus.files, gitSelectedPath, -1)}>Previous</button><button aria-label="Next changed file" disabled={!visibleGitStatus.isGitRepo || visibleGitStatus.files.length < 2} onClick={() => moveGitSelection(visibleGitStatus.files, gitSelectedPath, 1)}>Next</button></div></div>{visibleGitDiffError ? <div className="rw-data-error" role="alert">Diff unavailable: {visibleGitDiffError.message}</div> : gitDiffs?.path === gitSelectedPath && gitDiffs.scopeKey === selectedScopeKey ? <>{[gitDiffs.staged, gitDiffs.unstaged].map((diff, index) => diff?.diff ? <pre key={index} aria-label={index === 0 ? "Staged diff" : "Unstaged diff"}>{diff.diff.split("\n").map((line, lineIndex) => <span className={line.startsWith("+") && !line.startsWith("+++") ? "added" : line.startsWith("-") && !line.startsWith("---") ? "removed" : ""} key={lineIndex}>{line}{"\n"}</span>)}</pre> : null)}{!gitDiffs.staged?.diff && !gitDiffs.unstaged?.diff && <p>No staged or unstaged diff for this file.</p>}</> : <p>Loading selected diff…</p>}</section>}
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
        </>}
      </aside>
    </div>
    <WorkspaceUnsavedDialog
      open={pendingScopeChange !== undefined}
      title="Unsaved file edits"
      description={pendingScopeChange?.description ?? ""}
      saveLabel="Save all and continue"
      busy={scopeChangeBusy}
      error={scopeChangeError}
      onSave={() => void saveThenScopeChange()}
      onDiscard={discardThenScopeChange}
      onCancel={() => { if (!scopeChangeBusy) { setPendingScopeChange(undefined); setScopeChangeError(undefined); } }}
    />
    <ReactSettingsDialog data={data} open={settingsOpen} onClose={() => setSettingsOpen(false)} pluginFailures={pluginRuntime.failures}/>
    <AddProjectDialog open={addProjectTarget !== undefined} machineId={addProjectTarget?.machineId ?? selectedMachineId} machineName={addProjectTarget?.machineName ?? "Local machine"} onClose={() => setAddProjectTarget(undefined)} onSubmit={data.addProject}/>
    <ConfirmDialog open={gitDiscardTarget !== undefined && gitDiscardTarget.scopeKey === selectedScopeKey} title="Discard working-tree changes?" description={`Discard tracked working-tree changes to ${gitDiscardTarget?.path ?? "this file"}? This cannot be undone.`} confirmLabel="Discard changes" danger onCancel={() => setGitDiscardTarget(undefined)} onConfirm={() => { const target = gitDiscardTarget; setGitDiscardTarget(undefined); if (target !== undefined && target.scopeKey === selectedScopeKey) void performGitOperation({ action: "discard", paths: [target.path] }); }}/>
  </div>;
}

function gitMutationSuccess(mutation: GitMutation): string {
  if (mutation.action === "stage" || mutation.action === "unstage" || mutation.action === "discard") return `Git ${mutation.action} completed for ${mutation.paths.length} file${mutation.paths.length === 1 ? "" : "s"}.`;
  if (mutation.action === "commit") return "Commit created.";
  if (mutation.action === "switch") return `Switched to ${mutation.branch}.`;
  return `Git ${mutation.action} completed.`;
}

function renderGitChangeSection(
  title: string,
  files: readonly GitStatusResponse["files"][number][],
  section: "staged" | "unstaged",
  selectedPath: string | undefined,
  disabled: boolean,
  onSelect: (path: string) => void,
  onChange: (file: GitStatusResponse["files"][number]) => void,
  onDiscard: ((file: GitStatusResponse["files"][number]) => void) | undefined,
) {
  return <section className="rw-git-changes" aria-label={title}>
    <strong>{title} ({files.length})</strong>
    {files.length === 0 ? <p>No {section} changes.</p> : files.map(file => {
      const label = gitChangeLabel(file, section);
      return <div className="rw-git-change-row" key={file.path}>
        <button className={selectedPath === file.path ? "selected" : ""} title={label} onClick={() => onSelect(file.path)}><span>{file.path}</span><small>{label}</small></button>
        <button aria-label={`${section === "staged" ? "Unstage" : "Stage"} ${file.path}`} disabled={disabled} onClick={() => onChange(file)}>{section === "staged" ? "Unstage" : "Stage"}</button>
        {section === "unstaged" && onDiscard !== undefined && file.workingTree !== "untracked" && file.workingTree !== "ignored" && <button aria-label={`Discard changes to ${file.path}`} disabled={disabled} onClick={() => onDiscard(file)}>Discard</button>}
      </div>;
    })}
  </section>;
}
