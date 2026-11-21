import { terminalSocket, terminalsApi, type TerminalInfo } from "../api";
import type { WorkspaceTerminalSessions } from "./types";

/**
 * The scope a terminal lives in: this project, this workspace. A caller holding
 * a whole `Workspace` satisfies it, and a React host that memoizes the
 * terminal surface names exactly the fields it is keyed on.
 */
export interface TerminalWorkspaceScope {
  readonly id: string;
  readonly projectId: string;
}

/**
 * The host's side of the terminal capability handed to workspace panels.
 *
 * A panel that draws terminals should not know how a terminal is reached: the
 * routes and the socket are the host's business, and the scope every call
 * belongs to - this machine, this project, this workspace - is bound here
 * once rather than passed around and eventually passed wrong.
 */
export function workspaceTerminalSessions(workspace: TerminalWorkspaceScope, machineId: string): WorkspaceTerminalSessions {
  const { projectId, id } = workspace;
  return {
    list: (): Promise<TerminalInfo[]> => terminalsApi.terminals(projectId, id, machineId),
    start: (options) => terminalsApi.startTerminal(projectId, id, options, machineId),
    close: async (terminalId) => { await terminalsApi.closeTerminal(projectId, id, terminalId, machineId); },
    closeAll: async () => { await terminalsApi.closeWorkspaceTerminals(projectId, id, machineId); },
    continue: (terminalId) => terminalsApi.continueTerminal(projectId, id, terminalId, machineId),
    rename: (terminalId, name) => terminalsApi.renameTerminal(projectId, id, terminalId, name, machineId),
    connect: (terminalId, initialSize) => terminalSocket(projectId, id, terminalId, initialSize, machineId),
    listCommandRuns: () => terminalsApi.listCommandRuns({ projectId, workspaceId: id }, machineId),
    cancelCommandRun: (runId) => terminalsApi.cancelCommandRun(runId, machineId),
  };
}
