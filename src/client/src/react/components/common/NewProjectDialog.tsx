import { useEffect, useState, type ReactNode } from "react";
import { projectsApi } from "../../../api/clients";
import { Dialog } from "./Dialog";
import { Icon } from "./icons";
import { closeLayer, useLayerKey } from "../../state/panels";
import { readProjects, useProjects } from "../../state/projectsStore";
import { selectSession, useSelection } from "../../state/selection";

/**
 * Adding a project.
 *
 * The machine searches its own folders, so the search box is the machine's
 * answer, not a guess: type, and the machine's directories come back. A project
 * is added by path, the list is re-read, and the new project is opened — the
 * project's own main workspace, no session chosen.
 */
export function NewProjectDialog(): ReactNode {
  const layer = useLayerKey();
  const projects = useProjects();
  const selected = useSelection();
  const [search, setSearch] = useState("");
  const [found, setFound] = useState<readonly string[]>([]);
  const [searching, setSearching] = useState(false);
  const [path, setPath] = useState("");
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (search.trim() === "") {
        setFound([]);
        return;
      }
      setSearching(true);
      void projectsApi.projectDirectories(search, selected.machineId).then(
        (answer) => { setFound(answer.map((entry) => entry.path)); },
        () => { setFound([]); },
      ).finally(() => { setSearching(false); });
    }, 250);
    return () => { clearTimeout(timer); };
  }, [search, selected.machineId]);

  const add = (target: string): void => {
    if (target.trim() === "") return;
    setAdding(true);
    setProblem(undefined);
    void projectsApi.addProject(target.trim(), undefined, undefined, selected.machineId).then(
      (project) => {
        void readProjects(selected.machineId);
        selectSession({ machineId: selected.machineId, projectId: project.id });
        closeLayer();
      },
      (error: unknown) => { setProblem(error instanceof Error ? error.message : String(error)); },
    ).finally(() => { setAdding(false); });
  };

  const submit = (event: { preventDefault(): void }): void => {
    event.preventDefault();
    add(path);
  };

  if (layer !== "new-project") return null;

  return (
    <Dialog onClose={closeLayer} open={true} title="Add a project">
      <form className="piw-new-project" data-testid="new-project-dialog" onSubmit={submit}>
        <label className="piw-field">
          <span className="piw-label">Search this machine</span>
          <input aria-label="Search for a folder" className="piw-input" onChange={(event) => { setSearch(event.target.value); }} placeholder="Folder name…" value={search} />
        </label>
        {searching ? <p className="piw-empty">Searching…</p> : null}
        <ul className="piw-new-project__results">
          {found.map((directory) => (
            <li key={directory}>
              <button className="piw-row" onClick={() => { setPath(directory); }} type="button">
                <Icon label="" name="folderOpen" size="small" />
                <span className="piw-row__title piw-mono" dir="auto">{directory}</span>
              </button>
            </li>
          ))}
        </ul>
        <label className="piw-field">
          <span className="piw-label">Project path</span>
          <input aria-label="Project path" className="piw-input piw-mono" onChange={(event) => { setPath(event.target.value); }} placeholder="/absolute/path/to/project" value={path} />
        </label>
        {problem === undefined ? null : <p className="piw-empty" role="alert">{problem}</p>}
        <p className="piw-new-project__note">
          {`This machine has ${String(projects.projects.length)} project${projects.projects.length === 1 ? "" : "s"} listed. Adding one does not copy anything: PI WEB starts tracking the folder where it is.`}
        </p>
        <div className="piw-row-actions">
          <button className="piw-button" onClick={closeLayer} type="button">
            Cancel
          </button>
          <button className="piw-button piw-button--primary" disabled={adding || path.trim() === ""} type="submit">
            {adding ? "Adding…" : "Add project"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
