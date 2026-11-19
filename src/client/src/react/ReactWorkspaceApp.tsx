import { useEffect, useRef, useState } from "react";
import { capturePromptAttachments, type CapturedAttachment } from "../promptAttachmentCapture";
import { readBlobAsBase64 } from "../sentImages";
import { Icon } from "./icons";
import { ProjectTree } from "./ProjectTree";
import { useReactWorkspaceData } from "./useReactWorkspaceData";
import { ReactTerminalPanel } from "./ReactTerminalPanel";

type WorkbenchTab = "Git" | "Files" | "Terminal" | "Goals" | "Settings";
const tabs: WorkbenchTab[] = ["Git", "Files", "Terminal", "Goals", "Settings"];
function displayMessage(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value !== "object" || value === null) return JSON.stringify(value);
  const parts = Reflect.get(value, "parts");
  if (Array.isArray(parts)) {
    return parts.map(part => {
      if (typeof part !== "object" || part === null) return "";
      const type = Reflect.get(part, "type");
      if (type === "text" || type === "thinking") return String(Reflect.get(part, "text") ?? "");
      if (type === "toolCall") return "
[" + String(Reflect.get(part, "toolName") ?? "Tool") + "] " + String(Reflect.get(part, "summary") ?? "");
      if (type === "toolResult") return String(Reflect.get(part, "text") ?? "");
      if (type === "image") return "[Image attachment]";
      if (type === "skillInvocation") return String(Reflect.get(part, "content") ?? "");
      if (type === "extensionNotice") return String(Reflect.get(part, "text") ?? "");
      return "";
    }).filter(Boolean).join("
");
  }
  const content = Reflect.get(value, "content");
  if (typeof content === "string") return content;
  const text = Reflect.get(value, "text");
  return typeof text === "string" ? text : JSON.stringify(value);
}
function displayRole(value: unknown): "user" | "assistant" | "system" {
  if (typeof value === "object" && value !== null) {
    const role = Reflect.get(value, "role");
    if (role === "user" || role === "assistant" || role === "system") return role;
  }
  return "assistant";
}
function displayTime(value: unknown): string {
  if (typeof value === "object" && value !== null) {
    const meta = Reflect.get(value, "meta");
    if (typeof meta === "object" && meta !== null) {
      const timestamp = Reflect.get(meta, "timestamp");
      if (typeof timestamp === "string") return timestamp;
    }
    const timestamp = Reflect.get(value, "timestamp");
    if (typeof timestamp === "string") return timestamp;
  }
  return "";
}
export function ReactWorkspaceApp() {
  const data = useReactWorkspaceData();
  const [activeTab, setActiveTab] = useState<WorkbenchTab>("Files");
  const [projectQuery, setProjectQuery] = useState("");
  const [leftWidth, setLeftWidth] = useState(280);
  const [rightWidth, setRightWidth] = useState(390);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [showMoreByProject, setShowMoreByProject] = useState<Record<string, boolean>>({});
  const [composerFocused, setComposerFocused] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string>();
  const [fileFilter, setFileFilter] = useState("");
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<CapturedAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string>();
  const [attaching, setAttaching] = useState(false);
  const [fileDraft, setFileDraft] = useState("");
  const [fileDirty, setFileDirty] = useState(false);
  const [fileSaving, setFileSaving] = useState(false);
  const [packageSource, setPackageSource] = useState("");
  const [settingsNotice, setSettingsNotice] = useState<string>();
  const [settingsBusy, setSettingsBusy] = useState(false);
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
    } catch (error) {
      setSendError(error instanceof Error ? error.message : String(error));
    } finally {
      setSending(false);
    }
  };
  const activeActivities = Object.values(data.state.sessionActivities).filter(activity => activity.phase === "active" && activity.startup !== true);
  const backgroundCount = data.sessionStatus?.backgroundRunCount ?? 0;
  const queuedCount = data.sessionStatus?.queuedMessages.length ?? 0;
  const [modelProvider, setModelProvider] = useState("");
  const [modelId, setModelId] = useState("");
  const model = data.sessionStatus?.model;
  const modelLabel = model === undefined ? "Model unavailable" : [model.provider, model.name ?? model.id].filter(Boolean).join(" / ");
  const contextUsage = data.sessionStatus?.contextUsage;
  const isWorking = data.sessionStatus?.isStreaming === true || data.sessionStatus?.isCompacting === true || data.sessionStatus?.isBashRunning === true || data.sessionStatus?.isStopping === true;
  useEffect(() => {
    if (data.selectedFile !== undefined) {
      setFileDraft(data.selectedFile.content);
      setFileDirty(false);
    } else {
      setFileDraft("");
      setFileDirty(false);
    }
  }, [data.selectedFile?.path, data.selectedFile?.modifiedAt]);

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
    <header className="rw-windowbar">
      <div className="rw-traffic"><i/><i/><i/></div><strong>pi-webui</strong>
      <div className="rw-window-actions"><button title="Quick actions" onClick={() => setActiveTab("Goals")}><Icon name="zap"/></button><button title="Settings" onClick={() => setActiveTab("Settings")}><Icon name="settings"/></button></div>
    </header>
    <div className="rw-workspace">
      <aside className="rw-sidebar" aria-label="Projects and sessions">
        <div className="rw-side-toolbar"><span className="rw-sidebar-brand"><Icon name="panel-left"/> Workspace</span><div><button title="Settings"><Icon name="settings"/></button><button title="Actions"><Icon name="command"/></button></div></div>
        <section className="rw-running">
          <div className="rw-section-heading"><strong>Running Sessions <span>({activeActivities.length})</span></strong><button title="Refresh sessions" onClick={data.refresh}><Icon name="refresh-cw"/></button></div>
          {activeActivities.length === 0 ? <div className="rw-data-state">No active sessions reported.</div> : activeActivities.map(activity => { const session = data.projects.flatMap(row => row.sessions).find(item => item.id === activity.sessionId); return <button className="rw-running-item" key={activity.sessionId} onClick={() => session && void data.selectSession(session)}><i className="rw-dot green"/><span>{session?.name || activity.label}</span><time>{activity.detail || activity.phase}</time></button>; })
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
          <div className="rw-header-actions"><button title="Session actions"><Icon name="zap"/></button><button title="Session settings"><Icon name="settings"/></button><button title="More actions"><Icon name="more-horizontal"/></button></div>
        </header>
        {data.state.activity && <div className="rw-subagents"><div className="rw-activity-line"><i className={data.state.activity.phase === "active" ? "rw-dot green" : "rw-dot"}/><strong>{data.state.activity.label}</strong><span>{data.state.activity.detail}</span></div></div>}
        <div className="rw-transcript">
          {data.sessionError && <div className="rw-data-error">{data.sessionError}</div>}
          {!data.selectedSession && <div className="rw-empty-state">Select a session to view its conversation.</div>}
          {data.selectedSession && !data.sessionError && data.messages.length === 0 && <div className="rw-empty-state">No messages in this session yet.</div>}
          {data.messages.map((message, index) => <article className={"rw-message " + displayRole(message)} key={index}>
            <div className="rw-message-meta"><span>{displayRole(message).toUpperCase()}</span><time>{displayTime(message)}</time></div>
            <p>{displayMessage(message)}</p>
          </article>)}
        </div>
        <div className="rw-chat-dock">
          {(queuedCount > 0 || backgroundCount > 0) && <div className="rw-live-summary">
            {queuedCount > 0 && <span><Icon name="list-ordered"/> {queuedCount} queued</span>}
            {backgroundCount > 0 && <span><Icon name="layers"/> {backgroundCount} background runs</span>}
          </div>}
          <div className={"rw-composer " + (composerFocused ? "focused" : "")} onDragOver={event => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }} onDrop={event => { if (event.dataTransfer.files.length) { event.preventDefault(); void addAttachments(Array.from(event.dataTransfer.files)); } }} onPaste={event => { const files = Array.from(event.clipboardData.files); if (files.length) { event.preventDefault(); void addAttachments(files); } }}>
            <input ref={attachmentInputRef} type="file" multiple hidden onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ""; void addAttachments(files); }}/><button className="rw-add" title="Attach files" aria-label="Attach files" onClick={() => attachmentInputRef.current?.click()} disabled={!data.selectedSession || attaching}><Icon name="plus"/></button>
            <textarea value={data.draft} rows={1} placeholder={data.selectedSession ? "Message Pi..." : "Select a session first"} disabled={!data.selectedSession || data.selectedSession.archived === true} onChange={e => data.setDraft(e.target.value)} onFocus={() => setComposerFocused(true)} onBlur={() => setComposerFocused(false)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendMessage(); } }} />
            <div className="rw-composer-tools">
              {isWorking && <button title="Stop current work" onClick={() => void data.stopSession()}><Icon name="square"/></button>}
              <button className="rw-send" title="Send message" onClick={() => void sendMessage()} disabled={!data.selectedSession || data.selectedSession.archived === true || (data.draft.trim() === "" && attachments.length === 0) || sending || attaching}><Icon name={sending || attaching ? "loader-circle" : "send"}/></button>
            </div>
          </div>
          {attachments.length > 0 && <div className="rw-attachment-list">{attachments.map((item,index) => <span key={index} title={item.name}>{item.kind === "image" ? <Icon name="image"/> : <Icon name="file-text"/>}{item.name}<button aria-label={"Remove " + item.name} onClick={() => setAttachments(current => current.filter((_,i) => i !== index))}>×</button></span>)}</div>}
          {(sendError || attachmentError) && <div className="rw-composer-error">{sendError ?? attachmentError}</div>}
          <div className="rw-model-row">
            <span><Icon name="folder"/> {data.selectedWorkspace?.label ?? data.selectedProject?.name ?? "No workspace"}</span>
            <span className="rw-model-picker"><Icon name="cpu"/><select aria-label="Model provider" value={model?.provider ?? ""} disabled={!data.selectedSession || !data.modelOptions?.models.length} onChange={async event => { const candidate = data.modelOptions?.models.find(item => item.provider === event.target.value); if (!candidate || !data.selectedSession) return; try { await sessionsApi.setModel({id:data.selectedSession.id,cwd:data.selectedSession.cwd},candidate.provider,candidate.id,data.state.selectedMachine?.id ?? "local"); } catch (error) { setSendError(error instanceof Error ? error.message : String(error)); } }}>{[...new Set(data.modelOptions?.models.map(item => item.provider) ?? [])].map(provider => <option key={provider} value={provider}>{provider}</option>)}</select><select aria-label="Model" value={model?.id ?? ""} disabled={!data.selectedSession || !data.modelOptions?.models.length} onChange={async event => { if (!data.selectedSession || !model?.provider) return; try { await sessionsApi.setModel({id:data.selectedSession.id,cwd:data.selectedSession.cwd},model.provider,event.target.value,data.state.selectedMachine?.id ?? "local"); } catch (error) { setSendError(error instanceof Error ? error.message : String(error)); } }}>{(data.modelOptions?.models ?? []).filter(item => !model?.provider || item.provider === model.provider).map(item => <option key={item.id} value={item.id}>{item.name ?? item.id}</option>)}</select></span>
            {data.sessionStatus?.thinkingLevel && <span>{data.sessionStatus.thinkingLevel}</span>}
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
        <div className="rw-workbench-toolbar">{activeTab === "Files" ? <><label><Icon name="search"/><input placeholder="Filter files..." value={fileFilter} onChange={e => setFileFilter(e.target.value)}/></label><input ref={uploadInputRef} type="file" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void data.uploadFile(file).catch(() => undefined); event.target.value = ""; }}/><button title="Upload file to the current folder" onClick={() => uploadInputRef.current?.click()} disabled={!data.selectedWorkspace}><Icon name="upload"/></button></> : <><strong>{activeTab === "Goals" ? "Session overview" : activeTab}</strong>{activeTab === "Git" && <button title="Refresh session branch information" onClick={data.refresh}><Icon name="refresh-cw"/></button>}</>}</div>
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
            <div className="rw-git-card">
              <span className="rw-git-label">WORKING DIRECTORY</span>
              <strong>{data.selectedWorkspace?.path ?? "No workspace selected"}</strong>
            </div>
            <div className="rw-git-card">
              <span className="rw-git-label">CURRENT BRANCH</span>
              <strong>{data.sessionStatus?.gitBranch ?? "Branch information is available after a session status read."}</strong>
            </div>
            <p>Read-only branch information comes from the selected session's live status. Use the Terminal tab for Git commands and worktree operations.</p>
            <button disabled={!data.selectedWorkspace} onClick={() => setActiveTab("Terminal")}><Icon name="terminal"/> Open terminal</button>
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
