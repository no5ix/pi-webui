import { terminalsApi } from "../../api/clients";
import { createStore, idleRead, readFailed, useStoreSelect, type ReadState } from "./store";

/**
 * The workspace's terminals.
 *
 * The list is the machine's; which one is shown is the browser's. The socket
 * itself belongs to the panel that shows one terminal, and there is exactly one
 * per visible terminal — the store only says which that is.
 */
export interface TerminalScope {
  readonly machineId: string;
  readonly projectId: string;
  readonly workspaceId: string;
}

export type TerminalInfo = Awaited<ReturnType<typeof terminalsApi.terminals>>[number];

export interface TerminalsState {
  readonly scope: TerminalScope | undefined;
  readonly read: ReadState<readonly TerminalInfo[]>;
  readonly activeId: string | undefined;
  readonly starting: boolean;
}

export const terminalsStore = createStore<TerminalsState>({ scope: undefined, read: idleRead, activeId: undefined, starting: false });

export function useTerminals(): TerminalsState {
  return useStoreSelect(terminalsStore, (value) => value);
}

export function setActiveTerminal(terminalId: string | undefined): void {
  terminalsStore.update((current) => ({ ...current, activeId: terminalId }));
}

export async function readTerminals(scope: TerminalScope): Promise<void> {
  terminalsStore.update((current) => ({ ...current, scope, read: { ...current.read, phase: current.read.value === undefined ? "loading" : current.read.phase } }));
  try {
    const terminals = await terminalsApi.terminals(scope.projectId, scope.workspaceId, scope.machineId);
    terminalsStore.update((current) => ({
      ...current,
      read: { value: terminals, phase: "ready", error: undefined },
      activeId: terminals.some((terminal) => terminal.id === current.activeId) ? current.activeId : (terminals[0]?.id ?? undefined),
    }));
  } catch (error) {
    terminalsStore.update((current) => ({ ...current, read: readFailed(error) }));
  }
}

export async function startTerminal(scope: TerminalScope, size: { cols: number; rows: number }): Promise<TerminalInfo | undefined> {
  terminalsStore.update((current) => ({ ...current, scope, starting: true }));
  try {
    const terminal = await terminalsApi.startTerminal(scope.projectId, scope.workspaceId, size, scope.machineId);
    await readTerminals(scope);
    terminalsStore.update((current) => ({ ...current, activeId: terminal.id, starting: false }));
    return terminal;
  } catch (error) {
    terminalsStore.update((current) => ({ ...current, starting: false, read: readFailed(error) }));
    return undefined;
  }
}

export async function closeTerminal(scope: TerminalScope, terminalId: string): Promise<void> {
  await terminalsApi.closeTerminal(scope.projectId, scope.workspaceId, terminalId, scope.machineId);
  terminalsStore.update((current) => ({ ...current, activeId: current.activeId === terminalId ? undefined : current.activeId }));
  await readTerminals(scope);
}

export async function closeAllTerminals(scope: TerminalScope): Promise<void> {
  await terminalsApi.closeWorkspaceTerminals(scope.projectId, scope.workspaceId, scope.machineId);
  terminalsStore.update((current) => ({ ...current, activeId: undefined }));
  await readTerminals(scope);
}

export async function renameTerminal(scope: TerminalScope, terminalId: string, name: string): Promise<void> {
  await terminalsApi.renameTerminal(scope.projectId, scope.workspaceId, terminalId, name, scope.machineId);
  await readTerminals(scope);
}

