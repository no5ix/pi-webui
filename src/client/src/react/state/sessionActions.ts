import { sessionPinsApi, sessionsApi, workspacesApi } from "../../api/clients";
import { writeClipboardText } from "../../clipboard";
import type { Project, SessionRef, Workspace } from "../../../../shared/apiTypes";
import { readPins } from "./navStore";
import { boardRuntime, boardStore } from "./board";
import { projectsStore, closeProject as closeProjectRecord, readProjects } from "./projectsStore";
import { selection } from "./selection";

/**
 * The session and project operations, in one module.
 *
 * The rail's rows, the conversation header, the command palette and a plugin's
 * runtime context all act on the same session, and each of them used to reach
 * for an API client itself. One module owns the calls, the scope they carry, and
 * the refresh that must follow, so a command in the palette cannot drift from the
 * menu row beside it.
 *
 * Every operation states what it did in words the surface can show, and never
 * claims success on a request that was refused.
 */
export async function startSessionInWorkspace(workspace: Workspace, machineId: string): Promise<void> {
  await sessionsApi.startSession(workspace.path, machineId);
  await refresh();
}

/** Start in the workspace of the current selection, the way the rail's project row does. */
export async function startSessionForSelection(): Promise<string | undefined> {
  const current = selection.get();
  const board = boardStore.get().board;
  const workspaces = board?.workspaces ?? [];
  const workspace = workspaces.find((entry) => entry.projectId === current.projectId) ?? workspaces[0];
  if (workspace === undefined) return "No workspace is open on this machine.";
  await startSessionInWorkspace(workspace, current.machineId);
  return undefined;
}

/**
 * The session the address names, as the ref the API clients take. A session that
 * the board has not answered with has no known working directory, and every
 * session route is keyed by it, so this says "no session" rather than handing out
 * an empty cwd the machine would refuse.
 */
export function selectedSessionRef(): SessionRef | undefined {
  const current = selection.get();
  if (current.sessionId === undefined) return undefined;
  const known = (boardStore.get().board?.sessions ?? []).find((session) => session.id === current.sessionId);
  if (known === undefined) return undefined;
  return { id: known.id, cwd: known.cwd };
}

/** The workspace of the current selection, when both the project and the workspace are known. */
export function selectedWorkspace(): Workspace | undefined {
  const current = selection.get();
  if (current.workspaceId === undefined) return undefined;
  const listed = projectsStore.get().workspacesByProject.get(current.projectId ?? "") ?? [];
  return listed.find((workspace) => workspace.id === current.workspaceId);
}

export async function archiveSession(session: SessionRef, machineId: string): Promise<void> {
  await sessionsApi.archive(session, machineId);
  await refresh();
}

export async function archiveSessionWithDescendants(session: SessionRef, machineId: string): Promise<void> {
  await sessionsApi.archiveWithDescendants(session, machineId);
  await refresh();
}

export async function continueSessionInNewSession(session: SessionRef, machineId: string): Promise<void> {
  await sessionsApi.continueInNewSession(session, machineId);
  await refresh();
}

export async function detachSessionParent(session: SessionRef, machineId: string): Promise<void> {
  await sessionsApi.detachParent(session, machineId);
  await refresh();
}

/**
 * Naming a session is a `/name` command on that session: there is no second
 * rename endpoint, and the daemon's own reply is the answer.
 */
export async function renameSession(session: SessionRef, name: string, machineId: string): Promise<void> {
  await sessionsApi.runCommand(session, `/name ${name}`, machineId);
  await refresh();
}

export async function reloadSession(session: SessionRef, machineId: string): Promise<void> {
  await sessionsApi.reloadSession(session, machineId);
  await refresh();
}

export async function stopSessionWork(session: SessionRef, machineId: string): Promise<void> {
  await sessionsApi.abort(session, machineId);
  await refresh();
}

export async function toggleSessionPin(sessionId: string, pinned: boolean, machineId: string): Promise<void> {
  await sessionPinsApi.setPinned(sessionId, pinned, machineId);
  await readPins(machineId);
  await refresh();
}

export async function copySessionPath(session: SessionRef): Promise<void> {
  await writeClipboardText(session.cwd);
}

export async function closeProject(project: Project, machineId: string): Promise<void> {
  await closeProjectRecord(project.id, machineId);
  await refresh();
}

export async function deleteWorkspace(projectId: string, workspaceId: string, precondition: string, machineId: string): Promise<void> {
  await workspacesApi.deleteWorkspace(projectId, workspaceId, precondition, machineId);
  await readProjects(machineId);
  await refresh();
}

async function refresh(): Promise<void> {
  await boardRuntime.read({ force: true }).catch(() => undefined);
}
