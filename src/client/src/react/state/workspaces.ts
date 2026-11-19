import type { Workspace } from "../../../../shared/apiTypes";

/**
 * One workspace list from the two sources that name workspaces.
 *
 * The board answers with the workspaces of the open projects; the project store
 * answers per project (its names, order, and the workspaces a provider listed
 * after the board was read). The board wins for an id it has, because it is the
 * live answer, and the project store fills the ids the board does not have.
 */
export function mergeWorkspaces(boardWorkspaces: readonly Workspace[], byProject: ReadonlyMap<string, readonly Workspace[]>): Workspace[] {
  const merged = new Map<string, Workspace>();
  for (const workspace of boardWorkspaces) merged.set(workspace.id, workspace);
  for (const workspaces of byProject.values()) {
    for (const workspace of workspaces) {
      if (!merged.has(workspace.id)) merged.set(workspace.id, workspace);
    }
  }
  return [...merged.values()];
}
