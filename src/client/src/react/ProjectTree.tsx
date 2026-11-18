import { Icon } from "./icons";
import type { SessionInfo } from "../api";
type ProjectSession = { id: string; name: string; session: SessionInfo };
type Project = { id: string; name: string; sessions: ProjectSession[]; unknown: boolean };
type Props = { projects: Project[]; query: string; expanded: string[]; onExpanded: (ids: string[]) => void; selectedProject: string; selectedSession: string; onSelectProject: (id: string) => void; onSelectSession: (projectId: string, sessionId: string) => void; showMoreByProject: Record<string, boolean>; onShowMore: (id: string) => void };
export function ProjectTree({ projects, query, expanded, onExpanded, selectedProject, selectedSession, onSelectProject, onSelectSession, showMoreByProject, onShowMore }: Props) {
  const toggle = (id: string) => onExpanded(expanded.includes(id) ? expanded.filter(v => v !== id) : [...expanded, id]);
  const visible = projects.filter(p => p.name.toLowerCase().includes(query.toLowerCase()) || p.sessions.some(s => s.name.toLowerCase().includes(query.toLowerCase())));
  return <div className="rw-project-tree">
    {visible.map(project => {
      const open = expanded.includes(project.id) || query.length > 0;
      const matching = project.sessions.filter(s => s.name.toLowerCase().includes(query.toLowerCase()));
      const showMore = showMoreByProject[project.id] === true;
      const rows = open ? matching.slice(0, showMore ? matching.length : 5) : [];
      return <section className="rw-project-group" key={project.id}>
        <div className={"rw-project-row " + (selectedProject === project.id ? "selected" : "")}>
          <button className="rw-project-toggle" title={open ? "Collapse project" : "Expand project"} onClick={() => toggle(project.id)}><Icon name={open ? "chevron-down" : "chevron-right"}/></button>
          <button className="rw-project-name" onClick={() => { onSelectProject(project.id); if (!open) toggle(project.id); }}><Icon name="folder"/><span>{project.name}</span></button>
          <small>{project.unknown ? "…" : project.sessions.length}</small>
        </div>
        {project.unknown && open && <div className="rw-data-state">{selectedProject === project.id ? "Loading this workspace's sessions…" : "Select this project to load its sessions."}</div>}
        <div className="rw-session-rows">
          {rows.map(row => <button className={"rw-session-row " + (selectedProject === project.id && selectedSession === row.id ? "selected" : "")} key={row.id} onClick={() => onSelectSession(project.id, row.id)}><span className="rw-session-mark">#</span><span>{row.name}</span><small>{new Date(row.session.modified).toLocaleDateString()}</small></button>)}
          {open && matching.length > 5 && <button className="rw-show-more" onClick={() => onShowMore(project.id)}>{showMore ? "Show less" : "Show 5 more"}</button>}
          {open && !project.unknown && matching.length === 0 && <div className="rw-data-state">No sessions in this project.</div>}
        </div>
      </section>;
    })}
    {projects.length === 0 && <div className="rw-data-state">No projects are available.</div>}
  </div>;
}
