import { machinesApi } from "../../api/clients";
import type { Machine, MachineHealth } from "../../../../shared/apiTypes";
import { createStore, readFailed, type ReadState } from "./store";

/**
 * The machine roster in one place.
 *
 * The window bar's machine label, the quick switcher, the settings surface, the
 * access gate and the plugin runtime context all need the same rows, and a
 * plugin's `AppState.machines` must be the same list the shell shows. Reading it
 * per component gave each of them its own copy, its own failure state, and its
 * own moment of "no machines".
 */
export interface MachinesState {
  readonly read: ReadState<readonly Machine[]>;
  readonly machines: readonly Machine[];
  readonly health: ReadonlyMap<string, MachineHealth>;
}

export const machinesStore = createStore<MachinesState>({
  read: { value: undefined, phase: "idle", error: undefined },
  machines: [],
  health: new Map(),
});


export async function readMachines(): Promise<void> {
  machinesStore.update((current) => ({
    ...current,
    read: { value: current.machines.length === 0 ? undefined : current.machines, phase: "loading", error: undefined },
  }));
  try {
    const machines = await machinesApi.machines();
    machinesStore.update((current) => ({ ...current, read: { value: machines, phase: "ready", error: undefined }, machines }));
  } catch (error) {
    const failure = readFailed(error);
    machinesStore.update((current) => ({ ...current, read: { value: current.machines, phase: "failed", error: failure.error } }));
  }
}

export async function readMachineHealth(machineId: string): Promise<void> {
  try {
    const health = await machinesApi.health(machineId);
    machinesStore.update((current) => {
      const next = new Map(current.health);
      next.set(health.machineId, health);
      return { ...current, health: next };
    });
  } catch {
    return;
  }
}

/** A machine the roster did not answer with is not remembered: the list is the server's claim. */
export async function addMachine(input: { name: string; baseUrl: string; token?: string }): Promise<void> {
  await machinesApi.addMachine(input);
  await readMachines();
}

export async function renameMachine(machineId: string, name: string): Promise<void> {
  await machinesApi.updateMachine(machineId, { name });
  await readMachines();
}

export async function removeMachine(machineId: string): Promise<void> {
  await machinesApi.deleteMachine(machineId);
  await readMachines();
}

export async function recheckMachine(machineId: string): Promise<void> {
  await machinesApi.recheckMachine(machineId);
  await readMachineHealth(machineId);
}
