import { useEffect, useMemo, useRef, useState } from "react";
import { capturePromptAttachments, type CapturedAttachment } from "../promptAttachmentCapture";
import { readBlobAsBase64 } from "../sentImages";
import { filesApi, requestPluginBackend, sessionsApi } from "../api";
import { readPluginManifest } from "../plugins/external";
import { detectPromptCompletionTrigger, fileCompletionInsertText, modelCompletionChoices, asksExtensionCompletion } from "../promptCompletions";
import { historyIndexStep, loadPromptHistory, recallPromptHistoryAttachments, rememberPromptHistory, type HistoryDirection } from "../promptHistory";
import { machineSessionKey } from "../machineKeys";
import { MOBILE_NAVIGATION_MEDIA_QUERY } from "../breakpoints";
import type { CompletionItem } from "../components/shared";
import { GIT_DIFF_OPERATION, GIT_STATUS_OPERATION, parseGitDiffResponse, parseGitStatusResponse, type GitDiffResponse, type GitStatusResponse } from "../../../../pi-web-plugins/git/browser/git-contract";
import { Icon } from "./icons";
import { ConversationMessage, editedFilesFromMessages } from "./ConversationMessage";
import { ProjectTree } from "./ProjectTree";
import { useReactWorkspaceData } from "./useReactWorkspaceData";
import { ReactTerminalPanel } from "./ReactTerminalPanel";

type WorkbenchTab = "Git" | "Files" | "Terminal" | "Goals" | "Settings";
const tabs: WorkbenchTab[] = ["Git", "Files", "Terminal", "Goals", "Settings"];
export function ReactWorkspaceApp() {
  const data = useReactWorkspaceData();
  const narrowScreen = window.matchMedia(MOBILE_NAVIGATION_MEDIA_QUERY).matches;
  const [activeTab, setActiveTab] = useState<WorkbenchTab>("Files");
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
  const promptHistoryRef = useRef<{ key: string | undefined; index: number | undefined; draft: string }>({ key: undefined, index: undefined, draft: "" });
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string>();
  const [fileFilter, setFileFilter] = useState("");
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<CapturedAttachment[]>([]);
  const historyRecallRef = useRef(0);
  const [attachmentError, setAttachmentError] = useState<string>();
  const [attaching, setAttaching] = useState(false);
  const [fileDraft, setFileDraft] = useState("");
  const [fileDirty, setFileDirty] = useState(false);
  const [fileSaving, setFileSaving] = useState(false);
  const [packageSource, setPackageSource] = useState("");
  const [settingsNotice, setSettingsNotice] = useState<string>();
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [gitRefresh, setGitRefresh] = useState(0);
  const [gitStatus, setGitStatus] = useState<GitStatusResponse>();
  const [gitSelectedPath, setGitSelectedPath] = useState<string>();
  const [gitDiffs, setGitDiffs] = useState<{ path: string; unstaged?: GitDiffResponse; staged?: GitDiffResponse }>();
  const [gitError, setGitError] = useState<string>();
  const [gitLoading, setGitLoading] = useState(false);
  const projectRows = data.projects.map(row => ({
    id: row.project.id,
    name: row.project.name,
    sessions: row.sessions.map(session => ({ id: session.id, name: session.name?.trim() || session.firstMessage || "New session", session })),
    unknown: row.unknown,
  }));
  const selectProject = (id: string) => {
    void data.selectProject(id);
    setExpanded(current => current.includes(id) ? current : [...current, id]);
  };
  const selectSession = (_projectId: string, sessionId: string) => {
    const session = data.projects.flatMap(row => row.sessions).find(item => item.id === sessionId);
    if (session !== undefined) void data.selectSession(session);
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
  const subagentExecutions = useMemo(() => data.messages.flatMap(message => message.parts).filter((part): part is Extract<typeof part, { type: "toolExecution" | "toolCall" }> => (part.type === "toolExecution" || part.type === "toolCall") && part.toolName.toLowerCase().includes("subagent")), [data.messages]);
  useEffect(() => {
    if (data.selectedFile !== undefined) {
      setFileDraft(data.selectedFile.content);
      setFileDirty(false);
    } else {
      setFileDraft("");
      setFileDirty(false);
    }
  }, [data.selectedFile?.path, data.selectedFile?.modifiedAt]);

  useEffect(() => {
    const workspace = data.selectedWorkspace;
    const machineId = data.state.selectedMachine?.id ?? "local";
    if (activeTab !== "Git") return;
    if (workspace === undefined) {
      setGitStatus(undefined);
      setGitDiffs(undefined);
      setGitSelectedPath(undefined);
      setGitError(undefined);
      setGitLoading(false);
      return;
    }
    let active = true;
    setGitLoading(true);
    setGitError(undefined);
    setGitStatus(undefined);
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
      setGitSelectedPath(response.files[0]?.path);
    }).catch(error => {
      if (active) setGitError(error instanceof Error ? error.message : String(error));
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
      if (active) setGitDiffs({ path, unstaged, staged });
    }).catch(error => {
      if (active) setGitError(error instanceof Error ? error.message : String(error));
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
    setFileSaving(true);
    try {
      await data.saveFile(data.selectedFile.path, fileDraft);
      setFileDirty(false);
    } catch {
      // The data adapter keeps the server error visible above the file list.
    } finally {
      setFileSaving(false);
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
          <div className="rw-section-heading"><strong>Running Sessions <span>({activeActivities.length})</span></strong><button title="Refresh sessions" onClick={data.refresh}><Icon name="refresh-cw"/></button></div>
          {activeActivities.length === 0 ? <div className="rw-data-state">No active sessions reported.</div> : activeActivities.map(activity => { const session = data.projects.flatMap(row => row.sessions).find(item => item.id === activity.sessionId); return <button className="rw-running-item" key={activity.sessionId} onClick={() => session && void data.selectSession(session)}><i className="rw-dot green"/><span>{session?.name || activity.label}</span><time>{activity.detail || activity.phase}</time></button>; })}
        </section>
        <div className="rw-projects-heading"><strong>Projects <span>({data.projects.length})</span></strong><button title="New session in the selected workspace" onClick={data.startSession} disabled={!data.selectedWorkspace}><Icon name="plus"/></button></div>
        <div className="rw-search"><Icon name="search"/><input aria-label="Search sessions" placeholder="Search sessions" value={projectQuery} onChange={e => setProjectQuery(e.target.value)}/>{projectQuery && <button onClick={() => setProjectQuery("")}><Icon name="x"/></button>}</div>
        <button className="rw-all-projects" onClick={data.refresh}>Refresh project list</button>
        {data.loading && <div className="rw-data-state">Loading projects and sessions…</div>}
        {data.projectsError && <div className="rw-data-error">{data.projectsError}<button onClick={data.refresh}>Retry</button></div>}
        {!data.loading && !data.projectsError && <ProjectTree projects={projectRows} query={projectQuery} expanded={expanded} onExpanded={setExpanded} selectedProject={data.selectedProject?.id ?? ""} selectedSession={data.selectedSession?.id ?? ""} onSelectProject={selectProject} onSelectSession={selectSession} showMoreByProject={showMoreByProject} onShowMore={id => setShowMoreByProject(current => ({ ...current, [id]: !current[id] }))}/>}
        <div className="rw-sidebar-footer"><span>Local machine</span><span className="rw-connection"><i className={data.state.machinesLoad === "loaded" ? "" : "offline"}/> {data.state.selectedMachine?.name ?? (data.state.machinesLoad === "loaded" ? "Local machine" : "Connecting…")}</span></div>
      </aside>
      {leftOpen && <button className="rw-resize rw-resize-left" aria-label="Resize sidebar" onPointerDown={e => startResize("left", e)}/>}
      <main className="rw-conversation">
        <header className="rw-conversation-header">
          <button className="rw-icon-button" aria-label={leftOpen ? "Collapse sidebar" : "Expand sidebar"} onClick={() => setLeftOpen(v => !v)}><Icon name="panel-left"/></button>
          <div className="rw-session-heading"><strong>{data.selectedSession?.name?.trim() || data.selectedSession?.firstMessage || "No session selected"}</strong><span>{data.selectedProject?.name ?? "Select a project"}</span></div>
          <div className="rw-header-actions"><button title="Session actions"><Icon name="zap"/></button><button title="Session settings"><Icon name="settings"/></button><button title={rightOpen ? "Collapse workbench" : "Open workbench"} aria-label={rightOpen ? "Collapse workbench" : "Open workbench"} onClick={() => setRightOpen(value => !value)}><Icon name="panel-right"/></button><button title="More actions"><Icon name="more-horizontal"/></button></div>
        </header>
        {data.state.activity && <div className="rw-subagents"><div className="rw-activity-line"><i className={data.state.activity.phase === "active" ? "rw-dot green" : "rw-dot"}/><strong>{data.state.activity.label}</strong><span>{data.state.activity.detail}</span></div></div>}
        <div className="rw-transcript">
          {data.sessionError && <div className="rw-data-error">{data.sessionError}</div>}
          {!data.selectedSession && <div className="rw-empty-state">Select a session to view its conversation.</div>}
          {data.selectedSession && !data.sessionError && data.messages.length === 0 && <div className="rw-empty-state">No messages in this session yet.</div>}
          {data.messages.map((message, index) => <ConversationMessage key={message.meta?.entryId ?? message.meta?.clientMessageId ?? index} message={message} streaming={data.sessionStatus?.isStreaming === true} session={data.selectedSession} machineId={data.state.selectedMachine?.id ?? "local"}/>)}
        </div>
        <div className="rw-chat-dock">
          {(queuedCount > 0 || backgroundCount > 0) && <div className="rw-live-summary">
            {queuedCount > 0 && <span><Icon name="list-ordered"/> {queuedCount} queued</span>}
            {backgroundCount > 0 && <span><Icon name="layers"/> {backgroundCount} background runs</span>}
          </div>}
          <details className="rw-disclosure"><summary><Icon name="bot"/><strong>Subagents</strong><span>({subagentExecutions.length})</span><small>Show details</small></summary><div className="rw-disclosure-content">{subagentExecutions.length === 0 ? "No subagent-named tool activity is recorded in this session." : subagentExecutions.map((part, index) => <div key={index}>{part.toolName}: {part.summary}{part.type === "toolExecution" ? ` · ${part.status}` : " · running"}</div>)}</div></details>
          <details className="rw-disclosure"><summary><Icon name="activity"/><strong>Background Runs</strong><span>({backgroundCount})</span><small>Show details</small></summary><div className="rw-disclosure-content">{backgroundCount === 0 ? "No background runs are reported." : "The session status reports the active count; this API response does not include individual process details."}</div></details>
          <details className="rw-disclosure"><summary><Icon name="file-text"/><strong>Edited Files</strong><span>({editedFiles.length})</span><small>Show details</small></summary><div className="rw-disclosure-content">{editedFiles.length === 0 ? "No file edits are recorded in the visible transcript." : editedFiles.map(file => <button className="rw-edited-file" key={file.path} onClick={() => { if (!file.path.startsWith("/")) { void data.loadFile(file.path); setActiveTab("Files"); } }}><span>{file.path}</span><small>{file.status}</small></button>)}</div></details>
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
        <div className="rw-workbench-toolbar">{activeTab === "Files" ? <><label><Icon name="search"/><input placeholder="Filter files..." value={fileFilter} onChange={e => setFileFilter(e.target.value)}/></label><input ref={uploadInputRef} type="file" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void data.uploadFile(file).catch(() => undefined); event.target.value = ""; }}/><button title="Upload file to the current folder" onClick={() => uploadInputRef.current?.click()} disabled={!data.selectedWorkspace}><Icon name="upload"/></button></> : <><strong>{activeTab === "Goals" ? "Session overview" : activeTab}</strong>{activeTab === "Git" && <button title="Refresh Git status" onClick={() => setGitRefresh(value => value + 1)}><Icon name="refresh-cw"/></button>}</>}</div>
        {activeTab === "Settings" ? <div className="rw-settings-panel">
          <header><div><strong>Settings & integrations</strong><small>Machine: {data.state.selectedMachine?.name ?? "Local"} · Project: {data.selectedProject?.name ?? "Global scope"}</small></div><button onClick={() => void data.loadSettings()} disabled={data.settings.loading}>Reload</button></header>
          {data.settings.loading && <p>Loading settings…</p>}
          {(data.settings.error || settingsNotice || data.settings.notice) && <p className="rw-settings-notice">{settingsNotice ?? data.settings.notice ?? data.settings.error}</p>}
          <section><h3>General configuration</h3>
            <label>Host<input defaultValue={data.settings.config?.config.host ?? ""} key={data.settings.config?.path+"-host"} onBlur={event => { if (data.settings.config) void data.saveSettings({...data.settings.config.config,host:event.target.value}).catch(error => setSettingsNotice(String(error))); }}/></label>
            <label>Port<input type="number" defaultValue={data.settings.config?.config.port ?? 8505} key={data.settings.config?.path+"-port"} onBlur={event => { if (data.settings.config) void data.saveSettings({...data.settings.config.config,port:Number(event.target.value)}).catch(error => setSettingsNotice(String(error))); }}/></label>
            <label className="rw-setting-check"><input type="checkbox" defaultChecked={data.settings.config?.config.environmentFacts !== false} key={String(data.settings.config?.config.environmentFacts)} onChange={event => { if (data.settings.config) void data.saveSettings({...data.settings.config.config,environmentFacts:event.target.checked}).catch(error => setSettingsNotice(String(error))); }}/> Include environment facts in session prompts</label>
            <label className="rw-setting-check"><input type="checkbox" defaultChecked={data.settings.config?.config.piBuiltInExtensions !== false} key={String(data.settings.config?.config.piBuiltInExtensions)} onChange={event => { if (data.settings.config) void data.saveSettings({...data.settings.config.config,piBuiltInExtensions:event.target.checked}).catch(error => setSettingsNotice(String(error))); }}/> Load Pi built-in extensions</label>
          </section>
          <section><h3>PI WEB Plugins</h3>{data.settings.plugins?.plugins.map(plugin => <label className="rw-setting-check" key={plugin.id}><input type="checkbox" checked={plugin.enabled} disabled={!plugin.discovered || settingsBusy} onChange={async event => { setSettingsBusy(true); setSettingsNotice(undefined); try { await data.setPluginEnabled(plugin.id,event.target.checked); } catch(error) { setSettingsNotice(String(error)); } finally { setSettingsBusy(false); } }}/><span><b>{plugin.id}</b><small>{plugin.source} · {plugin.scope} · {plugin.server?.state ?? "unknown"}{plugin.server?.restartRequired ? " · restart required" : ""}</small></span></label>)}</section>
          <section><h3>Pi packages</h3><form onSubmit={event => {event.preventDefault();setSettingsBusy(true);void data.installPackage(packageSource).then(()=>setPackageSource("")).catch(error=>setSettingsNotice(String(error))).finally(()=>setSettingsBusy(false));}}><input placeholder="Package source (URL or registry)" value={packageSource} onChange={event=>setPackageSource(event.target.value)}/><button disabled={!packageSource.trim()||settingsBusy}>Install</button><button type="button" onClick={()=>void data.updatePackage().catch(error=>setSettingsNotice(String(error)))} disabled={settingsBusy}>Update all</button></form>{data.settings.packages?.packages.map(pkg=><div className="rw-setting-row" key={pkg.source}><span><b>{pkg.source}</b><small>{pkg.scope} · {pkg.enabled?"enabled":"disabled"}</small></span><button onClick={()=>void data.removePackage(pkg.source,pkg.scope).catch(error=>setSettingsNotice(String(error)))} disabled={settingsBusy}>Remove</button></div>)}</section>
          <section><h3>Skills</h3>{data.settings.skills?.skills.map(skill=><label className="rw-setting-check" key={skill.id}><input type="checkbox" checked={skill.enabled} disabled={settingsBusy||skill.ownerPackageDisabled===true} onChange={event=>{setSettingsBusy(true);void data.setSkillEnabled(skill,event.target.checked).catch(error=>setSettingsNotice(String(error))).finally(()=>setSettingsBusy(false));}}/><span><b>{skill.name}</b><small>{skill.scope} · {skill.origin} · {skill.validation}{skill.validationMessage ? " · "+skill.validationMessage : ""}</small></span></label>)}</section>
          <section><h3>MCP servers</h3>{data.settings.mcp?.errors.map((error,index)=><p key={index} className="rw-settings-notice">{error}</p>)}{data.settings.mcp?.servers.map(server=><div className="rw-setting-row" key={server.name}><span><b>{server.name}</b><small>{server.transport} · {server.scope} · {server.probe?.state ?? server.configured}{server.usesSecrets ? " · uses secrets (values hidden)" : ""}</small></span><button onClick={()=>void data.testMcp(server).catch(error=>setSettingsNotice(String(error)))} disabled={settingsBusy}>Test</button><button onClick={()=>void data.removeMcp(server).catch(error=>setSettingsNotice(String(error)))} disabled={settingsBusy||server.targets.length===0}>Remove</button><label className="rw-setting-check"><input type="checkbox" checked={server.enabled} disabled={settingsBusy||server.targets.length===0} onChange={event=>{setSettingsBusy(true);void data.setMcpEnabled(server,event.target.checked).catch(error=>setSettingsNotice(String(error))).finally(()=>setSettingsBusy(false));}}/>Enabled</label></div>)}</section>
        </div> : null}
        {activeTab === "Files" ? <div className="rw-file-tree">
          {data.filesError && <div className="rw-data-error">{data.filesError}</div>}
          {data.selectedWorkspace && <div className="rw-file-tree-path">
            <button disabled={!data.filePath} onClick={() => void data.loadDirectory(data.filePath.split("/").slice(0, -1).join("/"))} title="Go to parent folder"><Icon name="chevron-right"/></button>
            <button onClick={() => void data.loadDirectory("")} title="Project root">{data.selectedWorkspace.label}</button>
            {data.filePath && <span> / {data.filePath}</span>}
          </div>}
          {!data.selectedWorkspace && <div className="rw-empty-state">Select a project to browse its files.</div>}
          {data.fileEntries.filter(file => file.name.toLowerCase().includes(fileFilter.toLowerCase())).map(file => <button className={data.selectedFile?.path === file.path ? "selected" : ""} key={file.path} onClick={() => { if (file.type === "directory") void data.loadDirectory(file.path); else void data.loadFile(file.path); }}><Icon name={file.type === "directory" ? "chevron-right" : "file-text"}/>{file.name}</button>)}
          {data.selectedFile && <section className="rw-file-editor">
            <div className="rw-file-editor-toolbar">
              <strong title={data.selectedFile.path}>{data.selectedFile.path.split("/").pop()}</strong>
              {data.selectedFile.truncated && <small>Preview truncated — editing disabled</small>}
              {data.selectedFile.binary && <small>Binary file — preview unavailable</small>}
              <button onClick={() => void saveOpenFile()} disabled={!fileDirty || fileSaving || data.selectedFile.binary || data.selectedFile.truncated}>{fileSaving ? "Saving…" : "Save"}</button>
              <button title="Close file" onClick={() => void data.loadDirectory(data.filePath)}><Icon name="x"/></button>
            </div>
            <textarea spellCheck={false} value={fileDraft} readOnly={data.selectedFile.binary || data.selectedFile.truncated} onChange={event => { setFileDraft(event.target.value); setFileDirty(true); }} />
          </section>}
        </div> : activeTab === "Terminal" ? (
          data.selectedWorkspace
            ? <ReactTerminalPanel key={data.selectedWorkspace.id} workspace={data.selectedWorkspace} machineId={data.state.selectedMachine?.id ?? "local"}/>
            : <div className="rw-empty-panel">Select a workspace before opening a terminal.</div>
        ) : activeTab === "Git" ? (
          <div className="rw-git-panel">
            <div className="rw-git-toolbar"><strong>Working tree</strong><button onClick={() => setGitRefresh(value => value + 1)} disabled={gitLoading || !data.selectedWorkspace}>Refresh</button></div>
            {gitLoading && <div className="rw-data-state">Loading Git status…</div>}
            {gitError && <div className="rw-data-error">{gitError}<button onClick={() => setGitRefresh(value => value + 1)}>Retry</button></div>}
            {!gitLoading && !gitError && gitStatus && <>
              <div className="rw-git-card"><span className="rw-git-label">BRANCH</span><strong>{gitStatus.branch ?? "Detached HEAD"}</strong><small>{gitStatus.upstream ? `${gitStatus.upstream} · ${gitStatus.ahead ?? 0} ahead · ${gitStatus.behind ?? 0} behind` : "No upstream branch reported"}</small></div>
              {!gitStatus.isGitRepo ? <p>This workspace is not a Git repository.</p> : gitStatus.files.length === 0 ? <p>Working tree clean.</p> : <section className="rw-git-changes"><strong>Changes ({gitStatus.files.length})</strong>{gitStatus.files.map(file => <button key={file.path} className={gitSelectedPath === file.path ? "selected" : ""} onClick={() => { setGitSelectedPath(file.path); setGitDiffs(undefined); }}><span>{file.path}</span><small>{[file.index !== "unmodified" ? `staged ${file.index}` : "", file.workingTree !== "unmodified" ? file.workingTree : ""].filter(Boolean).join(" · ")}</small></button>)}</section>}
              {gitSelectedPath && <section className="rw-git-diff"><strong>{gitSelectedPath}</strong>{gitDiffs?.path === gitSelectedPath ? [gitDiffs.staged, gitDiffs.unstaged].map((diff, index) => diff?.diff ? <pre key={index} aria-label={index === 0 ? "Staged diff" : "Unstaged diff"}>{diff.diff.split("\n").map((line, lineIndex) => <span className={line.startsWith("+") && !line.startsWith("+++") ? "added" : line.startsWith("-") && !line.startsWith("---") ? "removed" : ""} key={lineIndex}>{line}{"\n"}</span>)}</pre> : null) : <p>Loading selected diff…</p>}</section>}
            </>}
            {!data.selectedWorkspace && <div className="rw-empty-state">Select a workspace to inspect Git status.</div>}
            {gitStatus?.isGitRepo && <p className="rw-git-limit">The current Git backend provides status and diff reads. Stage, commit, branch, and remote operations are not exposed by it yet.</p>}
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
  </div>;
}
