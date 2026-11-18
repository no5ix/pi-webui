import { useState } from "react";
import { Icon } from "./icons";
import { ProjectTree } from "./ProjectTree";
import { useReactWorkspaceData } from "./useReactWorkspaceData";

type WorkbenchTab = "Git" | "Files" | "Terminal" | "Goals";
const tabs: WorkbenchTab[] = ["Git", "Files", "Terminal", "Goals"];
function displayMessage(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value !== "object" || value === null) return JSON.stringify(value);
  const content = Reflect.get(value, "content");
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(part => typeof part === "object" && part !== null && typeof Reflect.get(part, "text") === "string" ? String(Reflect.get(part, "text")) : "").filter(Boolean).join("\n");
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
    const timestamp = Reflect.get(value, "timestamp");
    if (typeof timestamp === "string") return timestamp;
  }
  return "";
}
export function ReactWorkspaceApp() {
  const data = useReactWorkspaceData();
  const [activeTab, setActiveTab] = useState<WorkbenchTab>("Files");
  const [projectQuery, setProjectQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [leftWidth, setLeftWidth] = useState(280);
  const [rightWidth, setRightWidth] = useState(390);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [showMoreByProject, setShowMoreByProject] = useState<Record<string, boolean>>({});
  const [showBackground, setShowBackground] = useState(false);
  const [showEdited, setShowEdited] = useState(false);
  const [composerFocused, setComposerFocused] = useState(false);
  const [fileFilter, setFileFilter] = useState("");
  const projectRows = data.projects.map(row => ({
    id: row.project.id,
    name: row.project.name,
    sessions: row.sessions.map(session => ({ id: session.id, name: session.name?.trim() || session.firstMessage || "New session", session })),
    unknown: row.unknown,
  }));
  const selectProject = (id: string) => {
    data.selectProject(id);
    setExpanded(current => current.includes(id) ? current : [...current, id]);
  };
  const selectSession = (projectId: string, sessionId: string) => {
    const row = data.projects.find(item => item.project.id === projectId);
    const session = row?.sessions.find(item => item.id === sessionId);
    const workspace = row?.workspaces.find(item => item.path === session?.cwd);
    if (session && workspace) data.selectSession(session, projectId, workspace.id);
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
      <div className="rw-window-actions"><button title="Quick actions"><Icon name="zap"/></button><button title="Settings"><Icon name="settings"/></button></div>
    </header>
    <div className="rw-workspace">
      <aside className="rw-sidebar" aria-label="Projects and sessions">
        <div className="rw-side-toolbar"><span className="rw-sidebar-brand"><Icon name="panel-left"/> Workspace</span><div><button title="Settings"><Icon name="settings"/></button><button title="Actions"><Icon name="command"/></button></div></div>
        <section className="rw-running">
          <div className="rw-section-heading"><strong>Running Sessions <span>(2)</span></strong><button><Icon name="chevrons-up-down"/></button></div>
          <div className="rw-data-state">Running-session activity will appear when the realtime adapter is connected.</div>
        </section>
        <div className="rw-projects-heading"><strong>Projects <span>({data.projects.length})</span></strong><button title="Refresh projects" onClick={data.refresh}><Icon name="refresh-cw"/></button></div>
        <div className="rw-search"><Icon name="search"/><input aria-label="Search sessions" placeholder="Search sessions" value={projectQuery} onChange={e => setProjectQuery(e.target.value)}/>{projectQuery && <button onClick={() => setProjectQuery("")}><Icon name="x"/></button>}</div>
        <button className="rw-all-projects">All projects</button>
        {data.loading && <div className="rw-data-state">Loading projects and sessions…</div>}
        {data.projectsError && <div className="rw-data-error">{data.projectsError}<button onClick={data.refresh}>Retry</button></div>}
        {!data.loading && !data.projectsError && <ProjectTree projects={projectRows} query={projectQuery} expanded={expanded} onExpanded={setExpanded} selectedProject={data.selectedProject?.id ?? ""} selectedSession={data.selectedSession?.id ?? ""} onSelectProject={selectProject} onSelectSession={selectSession} showMoreByProject={showMoreByProject} onShowMore={id => setShowMoreByProject(current => ({ ...current, [id]: !current[id] }))}/>}
        <div className="rw-sidebar-footer"><span>Local machine</span><span className="rw-connection"><i/> Connected</span></div>
      </aside>
      {leftOpen && <button className="rw-resize rw-resize-left" aria-label="Resize sidebar" onPointerDown={e => startResize("left", e)}/>}
      <main className="rw-conversation">
        <header className="rw-conversation-header">
          <button className="rw-icon-button" aria-label={leftOpen ? "Collapse sidebar" : "Expand sidebar"} onClick={() => setLeftOpen(v => !v)}><Icon name="panel-left"/></button>
          <div className="rw-session-heading"><strong>{data.selectedSession?.name?.trim() || data.selectedSession?.firstMessage || "No session selected"}</strong><span>{data.selectedProject?.name ?? "Select a project"}</span></div>
          <div className="rw-header-actions"><button title="Session actions"><Icon name="zap"/></button><button title="Session settings"><Icon name="settings"/></button><button title="More actions"><Icon name="more-horizontal"/></button></div>
        </header>
        <div className="rw-subagents"><button><Icon name="bot"/><strong>Subagents</strong><span>(0)</span><small>none tracked</small><Icon name="chevron-down"/></button></div>
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
          <button className="rw-disclosure" onClick={() => setShowBackground(v => !v)}><Icon name="activity"/><strong>Background</strong><span>(0)</span><small>nothing running</small><Icon name={showBackground ? "chevron-down" : "chevron-right"}/></button>
          {showBackground && <div className="rw-disclosure-content">No background tasks are running.</div>}
          <button className="rw-disclosure" onClick={() => setShowEdited(v => !v)}><Icon name="file-text"/><strong>Edited Files</strong><span>(10)</span><small>10 in this transcript</small><Icon name={showEdited ? "chevron-down" : "chevron-right"}/></button>
          {showEdited && <div className="rw-disclosure-content">src/client/src/components/ReactWorkspaceApp.tsx<br/>src/client/src/react/workspace.css</div>}
          <div className={"rw-composer " + (composerFocused ? "focused" : "")}>
            <button className="rw-add"><Icon name="plus"/></button>
            <textarea value={draft} rows={1} placeholder={data.selectedSession ? "Message Pi..." : "Select a session first"} disabled={!data.selectedSession} onChange={e => setDraft(e.target.value)} onFocus={() => setComposerFocused(true)} onBlur={() => setComposerFocused(false)}/>
            <div className="rw-composer-tools"><button title="Mention" disabled><Icon name="at-sign"/></button><button title="Attachments will be enabled with the outbox adapter" disabled><Icon name="paperclip"/></button><button className="rw-send" title="Prompt sending is not enabled in this integration slice" disabled><Icon name="send"/></button></div>
          </div>
          <div className="rw-model-row"><span><Icon name="folder"/> {data.selectedWorkspace?.label ?? data.selectedProject?.name ?? "No workspace"}</span><span><Icon name="cpu"/> Model controls will be connected separately</span></div>
        </div>
        <footer className="rw-status"><span>↑ 592k tok</span><span>↓ 166k tok</span><span>ctx 59.4% of 262k</span><span><Icon name="git-branch"/> feat/react-workspace-ui-from-main</span><small>$0</small></footer>
      </main>
      {rightOpen && <button className="rw-resize rw-resize-right" aria-label="Resize workbench" onPointerDown={e => startResize("right", e)}/>}
      <aside className="rw-workbench">
        <div className="rw-workbench-tabs">{tabs.map(tab => <button key={tab} className={activeTab === tab ? "active" : ""} onClick={() => setActiveTab(tab)}>{tab === "Git" && <Icon name="git-branch"/>}{tab === "Files" && <Icon name="folder"/>}{tab === "Terminal" && <Icon name="terminal"/>}{tab === "Goals" && <Icon name="target"/>}{tab}</button>)}<button className="rw-workbench-collapse" aria-label={rightOpen ? "Collapse workbench" : "Expand workbench"} onClick={() => setRightOpen(v => !v)}><Icon name="panel-right"/></button></div>
        <div className="rw-workbench-toolbar">{activeTab === "Files" ? <><label><Icon name="search"/><input placeholder="Filter files..." value={fileFilter} onChange={e => setFileFilter(e.target.value)}/></label><button title="Upload"><Icon name="upload"/></button></> : <><strong>{activeTab}</strong><button><Icon name="refresh-cw"/></button></>}</div>
        {activeTab === "Files" ? <div className="rw-file-tree">
          {data.filesError && <div className="rw-data-error">{data.filesError}</div>}
          {data.selectedWorkspace && <div className="rw-file-tree-path">
            <button disabled={!data.filePath} onClick={() => void data.loadDirectory(data.filePath.split("/").slice(0, -1).join("/"))} title="Go to parent folder"><Icon name="chevron-right"/></button>
            <button onClick={() => void data.loadDirectory("")} title="Project root">{data.selectedWorkspace.label}</button>
            {data.filePath && <span> / {data.filePath}</span>}
          </div>}
          {!data.selectedWorkspace && <div className="rw-empty-state">Select a project to browse its files.</div>}
          {data.fileEntries.filter(file => file.name.toLowerCase().includes(fileFilter.toLowerCase())).map(file => <button key={file.path} onClick={() => { if (file.type === "directory") void data.loadDirectory(file.path); }}><Icon name={file.type === "directory" ? "chevron-right" : "file-text"}/>{file.name}</button>)}
        </div> : <div className="rw-empty-panel">{activeTab} is not connected in this integration slice.</div>}
      </aside>
    </div>
  </div>;
}
