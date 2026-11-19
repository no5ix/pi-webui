import { projectsApi, trustApi, workspacesApi } from "../../api/clients";
import { addProjectFailureMessage } from "../../controllers/projectController";
import type { Project, Workspace } from "../../../../shared/apiTypes";
import type { PluginProjectTrustChoice } from "../../../../plugin-api";
import { createStore, useStoreSelect, type ReadState } from "./store";

/**
 * The project list, and the workspaces under a project.
 *
 * A board answers with workspaces and sessions; the names, the order and the
 * missing-folder state come from the project store (`projects.json` through
 * `projectsApi`). Both are kept here, because the navigation rail needs them
 * side by side and every project mutation (add, close, rename, reorder) changes
 * both views.
 */
export interface ProjectsState {
  readonly read: ReadState<readonly Project[]>;
  readonly projects: readonly Project[];
  readonly workspacesByProject: ReadonlyMap<string, readonly Workspace[]>;
  readonly loadingWorkspaces: ReadonlySet<string>;
}

export const projectsStore = createStore<ProjectsState>({
  read: { value: undefined, phase: "idle", error: undefined },
  projects: [],
  workspacesByProject: new Map(),
  loadingWorkspaces: new Set(),
});

export function useProjects(): ProjectsState {
  return useStoreSelect(projectsStore, (value) => value);
}

export async function readProjects(machineId: string): Promise<void> {
  projectsStore.update((current) => ({ ...current, read: { ...current.read, phase: "loading" } }));
  try {
    const projects = await projectsApi.projects(machineId);
    projectsStore.update((current) => ({
      ...current,
      projects,
      read: { value: projects, phase: "ready", error: undefined },
    }));
  } catch (error) {
    projectsStore.update((current) => ({
      ...current,
      read: { ...current.read, phase: "failed", error: error instanceof Error ? error.message : String(error) },
    }));
  }
}

export async function readWorkspaces(projectId: string, machineId: string): Promise<readonly Workspace[]> {
  projectsStore.update((current) => ({ ...current, loadingWorkspaces: new Set([...current.loadingWorkspaces, projectId]) }));
  try {
    const workspaces = await workspacesApi.workspaces(projectId, machineId);
    projectsStore.update((current) => {
      const next = new Map(current.workspacesByProject);
      next.set(projectId, workspaces);
      const loading = new Set(current.loadingWorkspaces);
      loading.delete(projectId);
      return { ...current, workspacesByProject: next, loadingWorkspaces: loading };
    });
    return workspaces;
  } catch (error) {
    projectsStore.update((current) => {
      const loading = new Set(current.loadingWorkspaces);
      loading.delete(projectId);
      return { ...current, loadingWorkspaces: loading };
    });
    throw error;
  }
}

export async function closeProject(projectId: string, machineId: string): Promise<void> {
  await projectsApi.closeProject(projectId, machineId);
  projectsStore.update((current) => {
    const workspaces = new Map(current.workspacesByProject);
    workspaces.delete(projectId);
    return { ...current, workspacesByProject: workspaces };
  });
  await readProjects(machineId);
}

/**
 * Add a project, then save the add-project dialog's trust choice for its main
 * workspace through the id-based route, never a client-chosen path. The project
 * is added either way, so a trust write that fails says the trust was not saved
 * instead of reading as a failed add.
 *
 * Resolves to the reason the submit did not go through, in the machine's words,
 * or undefined when it did. The dialog and a plugin's `createProject` share this.
 */
export async function addProject(input: { path: string; create?: boolean | undefined; trust?: PluginProjectTrustChoice | undefined }, machineId: string): Promise<string | undefined> {
  const path = input.path.trim();
  if (path === "") return undefined;
  let project: Project;
  try {
    project = await projectsApi.addProject(path, undefined, input.create, machineId);
  } catch (error) {
    return addProjectFailureMessage(error);
  }
  await readProjects(machineId);
  const trust = input.trust;
  if (trust === undefined) return undefined;
  if (!trust.changed) return undefined;
  const mainWorkspace = (await readWorkspaces(project.id, machineId).catch((): readonly Workspace[] => [])).find((workspace) => workspace.isMain);
  if (mainWorkspace === undefined) return `Added ${project.name}, but its trust was not saved: its main workspace is not listed.`;
  try {
    await trustApi.setWorkspaceTrust(project.id, mainWorkspace.id, trust.trusted, machineId);
    return undefined;
  } catch (error) {
    return `Added ${project.name}, but its trust was not saved: ${addProjectFailureMessage(error)}`;
  }
}

