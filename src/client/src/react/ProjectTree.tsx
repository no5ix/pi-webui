import { Icon } from "./icons";
type Project = { id: string; name: string; sessions: string[] };
type Props = { projects: Project[]; query: string; expanded: string[]; onExpanded: (ids: string[]) => void; selectedProject: string; selectedSession: string; onSelect: (id: string, session?: string) => void; showMore: boolean; onShowMore: () => void };
export function ProjectTree({ projects, query, expanded, onExpanded, selectedProject, selectedSession, onSelect, showMore, onShowMore }: Props) {
  const toggle = (id: string) => onExpanded(expanded.includes(id) ? expanded.filter(v => v !== id) : [...expanded, id]);
  const visible = projects.filter(p => p.name.toLowerCase().includes(query.toLowerCase()) || p.sessions.some(s => s.toLowerCase().includes(query.toLowerCase())));
  return <div className="rw-project-tree">
    {visible.map(project => {
      const open = expanded.includes(project.id) || query.length > 0;
      const matching = project.sessions.filter(s => s.toLowerCase().includes(query.toLowerCase()));
      const rows = open ? matching.slice(0, showMore ? matching.length : 5) : [];
      return <section className="rw-project-group" key={project.id}>
        <button className="rw-project-row" onClick={() => { onSelect(project.id); toggle(project.id); }}><Icon name={open ? "chevron-down" : "chevron-right"}/><Icon name="folder"/><span>{project.name}</span><small>{project.sessions.length}</small></button>
        <div className="rw-session-rows">{rows.map(session => <button className={"rw-session-row " + (selectedProject === project.id && selectedSession === session ? "selected" : "")} key={session} onClick={() => onSelect(project.id, session)}><span className="rw-session-mark">#</span><span>{session}</span><small>1d</small></button>)}
          {open && matching.length > 5 && <button className="rw-show-more" onClick={onShowMore}>{showMore ? "Show less" : "Show 5 more"}</button>}
        </div>
      </section>;
    })}
  </div>;
}
