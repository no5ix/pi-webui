import { useMemo, useState } from "react";
import { Icon } from "./icons";
import { ProjectTree } from "./ProjectTree";

type WorkbenchTab = "Git" | "Files" | "Terminal" | "Goals";
type Message = { role: "user" | "assistant"; content: string; time: string };
const tabs: WorkbenchTab[] = ["Git", "Files", "Terminal", "Goals"];
const seedProjects = [
  { id: "pi-webui", name: "pi-webui", sessions: ["Task: Redesign Skill Identity and Preference Resolution", "Task: Fix All Remaining Baseline Checks", "Task: Implement Skills Management", "Pi WebUI — Comprehensive Audit", "Task: Continue the Visual Refinement", "Task: Create Two Premium Built-in Tools", "Task: Fix Project Navigation"] },
  { id: "auto-toc", name: "auto-toc", sessions: ["Perform a browser automation verification", "Initialize my two browser MCP servers", "Verify the complete Playwright MCP setup", "Use pi-browser-harness to open my app", "Review browser session handling"] },
  { id: "saytypetypetype", name: "saytypetypetype", sessions: ["Integrate Parakeet v3 ASR", "Improve model download flow"] },
  { id: "sadoyo", name: "sadoyo", sessions: ["Build a dynamic island dashboard", "Fix compact toolbar transitions"] },
  { id: "sux-mac", name: "sux-mac", sessions: ["Fix clipboard history preview"] },
  { id: "stock-pet-go", name: "stock-pet-go", sessions: ["Implement virtual pet dashboard"] },
  { id: "branchshift", name: "branchshift", sessions: ["Polish context menu scrollbar"] },
];
const initialMessages: Message[] = [
  { role: "user", content: "Execution requirement: Complete both Task A and Task B. Do not stop at investigation or partial implementation. Implement, test, document, review, commit, push, and report.", time: "Nov 13, 2026 at 5:34:56 PM" },
  { role: "assistant", content: "I'll start by inspecting the repository state and git workflow prerequisites.", time: "Nov 13, 2026 at 5:34:56 PM" },
];
export function ReactWorkspaceApp() {
  const [activeTab, setActiveTab] = useState<WorkbenchTab>("Files");
  const [projectQuery, setProjectQuery] = useState("");
  const [selectedProject, setSelectedProject] = useState("pi-webui");
  const [selectedSession, setSelectedSession] = useState(seedProjects[0]!.sessions[0]!);
  const [messages, setMessages] = useState(initialMessages);
  const [draft, setDraft] = useState("");
  const [leftWidth, setLeftWidth] = useState(280);
  const [rightWidth, setRightWidth] = useState(390);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [expanded, setExpanded] = useState<string[]>(["pi-webui", "auto-toc"]);
  const [moreProjects, setMoreProjects] = useState(false);
  const [showBackground, setShowBackground] = useState(false);
  const [showEdited, setShowEdited] = useState(false);
  const [composerFocused, setComposerFocused] = useState(false);
  const project = useMemo(() => seedProjects.find(item => item.id === selectedProject), [selectedProject]);
  const changeProject = (id: string, session?: string) => {
    setSelectedProject(id);
    if (session) setSelectedSession(session);
  };
  const sendMessage = () => {
    const content = draft.trim();
    if (!content) return;
    setMessages(current => [...current, { role: "user", content, time: new Date().toLocaleString() }]);
    setDraft("");
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
  const files = [".agents", ".changeset", ".github", "docs", "extensions", "packages", "src", "test-fixtures", ".dockerignore", ".gitignore", "AGENTS.md", "package.json", "pnpm-lock.yaml", "README.md"];
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
          <button className="rw-running-item"><i className="rw-dot green"/>Task: Redesign UI <time>3m</time></button>
          <button className="rw-running-item"><i className="rw-dot green"/>Task: Fix baseline checks <time>12m</time></button>
        </section>
        <div className="rw-projects-heading"><strong>Projects <span>({seedProjects.length + 2})</span></strong><button title="New session"><Icon name="plus"/></button></div>
        <div className="rw-search"><Icon name="search"/><input aria-label="Search sessions" placeholder="Search sessions" value={projectQuery} onChange={e => setProjectQuery(e.target.value)}/>{projectQuery && <button onClick={() => setProjectQuery("")}><Icon name="x"/></button>}</div>
        <button className="rw-all-projects">All projects</button>
        <ProjectTree projects={seedProjects} query={projectQuery} expanded={expanded} onExpanded={setExpanded} selectedProject={selectedProject} selectedSession={selectedSession} onSelect={changeProject} showMore={moreProjects} onShowMore={() => setMoreProjects(v => !v)}/>
        <div className="rw-sidebar-footer"><span>Local machine</span><span className="rw-connection"><i/> Connected</span></div>
      </aside>
      {leftOpen && <button className="rw-resize rw-resize-left" aria-label="Resize sidebar" onPointerDown={e => startResize("left", e)}/>}
      <main className="rw-conversation">
        <header className="rw-conversation-header">
          <button className="rw-icon-button" aria-label={leftOpen ? "Collapse sidebar" : "Expand sidebar"} onClick={() => setLeftOpen(v => !v)}><Icon name="panel-left"/></button>
          <div className="rw-session-heading"><strong>{selectedSession}</strong><span>{project?.name ?? "pi-webui"}</span></div>
          <div className="rw-header-actions"><button title="Session actions"><Icon name="zap"/></button><button title="Session settings"><Icon name="settings"/></button><button title="More actions"><Icon name="more-horizontal"/></button></div>
        </header>
        <div className="rw-subagents"><button><Icon name="bot"/><strong>Subagents</strong><span>(0)</span><small>none tracked</small><Icon name="chevron-down"/></button></div>
        <div className="rw-transcript">
          {messages.map((message, index) => <article className={"rw-message " + message.role} key={index}>
            <div className="rw-message-meta"><span>{message.role.toUpperCase()}</span><time>{message.time}</time></div>
            <p>{message.content}</p>
            {message.role === "assistant" && <div className="rw-command"><Icon name="check-circle"/> Executed 3 commands <Icon name="chevron-down"/></div>}
          </article>)}
          <div className="rw-typing"><span/> •••</div>
        </div>
        <div className="rw-chat-dock">
          <button className="rw-disclosure" onClick={() => setShowBackground(v => !v)}><Icon name="activity"/><strong>Background</strong><span>(0)</span><small>nothing running</small><Icon name={showBackground ? "chevron-down" : "chevron-right"}/></button>
          {showBackground && <div className="rw-disclosure-content">No background tasks are running.</div>}
          <button className="rw-disclosure" onClick={() => setShowEdited(v => !v)}><Icon name="file-text"/><strong>Edited Files</strong><span>(10)</span><small>10 in this transcript</small><Icon name={showEdited ? "chevron-down" : "chevron-right"}/></button>
          {showEdited && <div className="rw-disclosure-content">src/client/src/components/ReactWorkspaceApp.tsx<br/>src/client/src/react/workspace.css</div>}
          <div className={"rw-composer " + (composerFocused ? "focused" : "")}>
            <button className="rw-add"><Icon name="plus"/></button>
            <textarea value={draft} rows={1} placeholder="Message Pi..." onChange={e => setDraft(e.target.value)} onFocus={() => setComposerFocused(true)} onBlur={() => setComposerFocused(false)} onKeyDown={e => {if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendMessage();}}}/>
            <div className="rw-composer-tools"><button title="Mention"><Icon name="at-sign"/></button><button title="Attach"><Icon name="paperclip"/></button><button className="rw-send" title="Send" onClick={sendMessage}><Icon name="send"/></button></div>
          </div>
          <div className="rw-model-row"><span><Icon name="folder"/> pi-webui</span><span><Icon name="cpu"/> ukisai/Swift-1.5-Qwen3.8-Flash-Next</span><span>medium</span><span className="rw-pill"><i/> LSP</span></div>
        </div>
        <footer className="rw-status"><span>↑ 592k tok</span><span>↓ 166k tok</span><span>ctx 59.4% of 262k</span><span><Icon name="git-branch"/> feat/react-workspace-ui-from-main</span><small>$0</small></footer>
      </main>
      {rightOpen && <button className="rw-resize rw-resize-right" aria-label="Resize workbench" onPointerDown={e => startResize("right", e)}/>}
      <aside className="rw-workbench">
        <div className="rw-workbench-tabs">{tabs.map(tab => <button key={tab} className={activeTab === tab ? "active" : ""} onClick={() => setActiveTab(tab)}>{tab === "Git" && <Icon name="git-branch"/>}{tab === "Files" && <Icon name="folder"/>}{tab === "Terminal" && <Icon name="terminal"/>}{tab === "Goals" && <Icon name="target"/>}{tab}</button>)}<button className="rw-workbench-collapse" aria-label={rightOpen ? "Collapse workbench" : "Expand workbench"} onClick={() => setRightOpen(v => !v)}><Icon name="panel-right"/></button></div>
        <div className="rw-workbench-toolbar">{activeTab === "Files" ? <><label><Icon name="search"/><input placeholder="Filter files..."/></label><button title="Upload"><Icon name="upload"/></button></> : <><strong>{activeTab}</strong><button><Icon name="refresh-cw"/></button></>}</div>
        {activeTab === "Files" ? <div className="rw-file-tree"><strong><Icon name="chevron-down"/> pi-webui</strong>{files.map(file => <button key={file}><Icon name="chevron-right"/>{file}</button>)}</div> : <div className="rw-empty-panel">{activeTab} panel</div>}
      </aside>
    </div>
  </div>;
}
