import { terminalsApi } from "../../api/clients";
import { isRecord } from "../../../../shared/unknownValues";
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
  /**
   * A request to open a terminal, from a command, a plugin, or the panel's own
   * button. The panel is the only thing that knows the terminal's size, so the
   * request travels through the store and the panel answers it.
   */
  readonly openRequested: { terminalId: string | undefined } | undefined;
}

export const terminalsStore = createStore<TerminalsState>({ scope: undefined, read: idleRead, activeId: undefined, starting: false, openRequested: undefined });

export function useTerminals(): TerminalsState {
  return useStoreSelect(terminalsStore, (value) => value);
}

export function requestTerminalOpen(terminalId?: string): void {
  terminalsStore.update((current) => ({ ...current, openRequested: { terminalId } }));
}

export function clearTerminalOpenRequest(): void {
  terminalsStore.update((current) => (current.openRequested === undefined ? current : { ...current, openRequested: undefined }));
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


/**
 * The terminal socket's frames, in both directions.
 *
 * The daemon's terminal socket is not a raw pty pipe: a client sends
 * `{ type: "input", data }` and `{ type: "resize", cols, rows }`, and the
 * machine answers `{ type: "output", data, replay }`, `{ type: "exit", exitCode }`
 * and `{ type: "error", message }` (daemon/terminals/terminalRoutes.ts). Writing
 * bytes straight into the socket types JSON into the shell, and printing the
 * machine's frames straight into the terminal prints its control words as
 * output, so both directions are coded here and tested.
 */
export type TerminalServerFrame =
  | { readonly type: "output"; readonly data: string; readonly replay: boolean }
  | { readonly type: "exit"; readonly exitCode: number | undefined }
  | { readonly type: "error"; readonly message: string };

const frameDecoder = new TextDecoder();

function isView(value: unknown): value is ArrayBufferView {
  return ArrayBuffer.isView(value);
}

export function terminalInputFrame(data: string): string {
  return JSON.stringify({ type: "input", data });
}

export function terminalResizeFrame(cols: number, rows: number): string {
  return JSON.stringify({ type: "resize", cols, rows });
}

/**
 * Reads one machine frame.
 *
 * A frame that is not one the daemon sends is no frame: the panel keeps its
 * connection words rather than writing a hole into the shell.
 */
export function parseTerminalServerFrame(raw: unknown): TerminalServerFrame | undefined {
  const text = typeof raw === "string"
    ? raw
    : raw instanceof ArrayBuffer
      ? frameDecoder.decode(new Uint8Array(raw))
      : isView(raw)
        ? frameDecoder.decode(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength))
        : undefined;
  if (text === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  if (parsed["type"] === "output" && typeof parsed["data"] === "string") {
    return { type: "output", data: parsed["data"], replay: parsed["replay"] === true };
  }
  if (parsed["type"] === "exit") {
    return { type: "exit", exitCode: typeof parsed["exitCode"] === "number" ? parsed["exitCode"] : undefined };
  }
  if (parsed["type"] === "error" && typeof parsed["message"] === "string") {
    return { type: "error", message: parsed["message"] };
  }
  return undefined;
}
