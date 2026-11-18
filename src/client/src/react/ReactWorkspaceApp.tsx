import { useState } from "react";
import { Icon } from "./icons";
import { ProjectTree } from "./ProjectTree";
import { useReactWorkspaceData } from "./useReactWorkspaceData";
import { ReactTerminalPanel } from "./ReactTerminalPanel";

type WorkbenchTab = "Git" | "Files" | "Terminal" | "Goals";
const tabs: WorkbenchTab[] = ["Git", "Files", "Terminal", "Goals"];
function displayMessage(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value !== "object" || value === null) return JSON.stringify(value);
  const parts = Reflect.get(value, "parts");
  if (Array.isArray(parts)) {
    return parts.map(part => {
      if (typeof part !== "object" || part === null) return "";
      const type = Reflect.get(part, "type");
      if (type === "text" || type === "thinking") return String(Reflect.get(part, "text") ?? "");
      if (type === "toolCall") return "\n[" + String(Reflect.get(part, "toolName") ?? "Tool") + "] " + String(Reflect.get(part, "summary") ?? "");
      if (type === "toolResult") return String(Reflect.get(part, "text") ?? "");
      if (type === "image") return "[Image attachment]";
      if (type === "skillInvocation") return String(Reflect.get(part, "content") ?? "");
      if (type === "extensionNotice") return String(Reflect.get(part, "text") ?? "");
      return "";
    }).filter(Boolean).join("\n");
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
  const sendMessage = async () => {
    const text = data.draft.trim();
    if (text === "" || sending) return;
    setSending(true);
    setSendError(undefined);
    try {
      const sent = await data.sendPrompt(text);
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
  const model = data.sessionStatus?.model;
  const modelLabel = model === undefined ? "Model unavailable" : [model.provider, model.name ?? model.id].filter(Boolean).join(" / ");
  const contextUsage = data.sessionStatus?.contextUsage;
  const isWorking = data.sessionStatus?.isStreaming === true || data.sessionStatus?.isCompacting === true || data.sessionStatus?.isBashRunning === true || data.sessionStatus?.isStopping === true;
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
      <div className="rw-window-actions"><button title="Quick actions"><Icon name="zap"/></button><button title="Settings"><Icon name="settings"/></button></div>
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
          <div className={"rw-composer " + (composerFocused ? "focused" : "")}>
            <button className="rw-add" title="Attachments are not yet enabled in this React migration slice" disabled><Icon name="plus"/></button>
            <textarea value={data.draft} rows={1} placeholder={data.selectedSession ? "Message Pi..." : "Select a session first"} disabled={!data.selectedSession || data.selectedSession.archived === true} onChange={e => data.setDraft(e.target.value)} onFocus={() => setComposerFocused(true)} onBlur={() => setComposerFocused(false)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendMessage(); } }} />
            <div className="rw-composer-tools">
              {isWorking && <button title="Stop current work" onClick={() => void data.stopSession()}><Icon name="square"/></button>}
              <button className="rw-send" title="Send message" onClick={() => void sendMessage()} disabled={!data.selectedSession || data.selectedSession.archived === true || data.draft.trim() === "" || sending}><Icon name={sending ? "loader-circle" : "send"}/></button>
            </div>
          </div>
          {sendError && <div className="rw-composer-error">{sendError}</div>}
          <div className="rw-model-row">
            <span><Icon name="folder"/> {data.selectedWorkspace?.label ?? data.selectedProject?.name ?? "No workspace"}</span>
            <span><Icon name="cpu"/> {modelLabel}</span>
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
        <div className="rw-workbench-toolbar">{activeTab === "Files" ? <><label><Icon name="search"/><input placeholder="Filter files..." value={fileFilter} onChange={e => setFileFilter(e.target.value)}/></label><button title="Upload" disabled><Icon name="upload"/></button></> : <><strong>{activeTab === "Goals" ? "Session overview" : activeTab}</strong>{activeTab === "Git" && <button title="Refresh session branch information" onClick={data.refresh}><Icon name="refresh-cw"/></button>}</>}</div>
        {activeTab === "Files" ? <div className="rw-file-tree">
          {data.filesError && <div className="rw-data-error">{data.filesError}</div>}
          {data.selectedWorkspace && <div className="rw-file-tree-path">
            <button disabled={!data.filePath} onClick={() => void data.loadDirectory(data.filePath.split("/").slice(0, -1).join("/"))} title="Go to parent folder"><Icon name="chevron-right"/></button>
            <button onClick={() => void data.loadDirectory("")} title="Project root">{data.selectedWorkspace.label}</button>
            {data.filePath && <span> / {data.filePath}</span>}
          </div>}
          {!data.selectedWorkspace && <div className="rw-empty-state">Select a project to browse its files.</div>}
          {data.fileEntries.filter(file => file.name.toLowerCase().includes(fileFilter.toLowerCase())).map(file => <button key={file.path} onClick={() => { if (file.type === "directory") void data.loadDirectory(file.path); }}><Icon name={file.type === "directory" ? "chevron-right" : "file-text"}/>{file.name}</button>)}
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
