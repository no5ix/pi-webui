import type { PiWebFleetOperation, PiWebStatusResponse } from "../../shared/apiTypes";
import { installationRestartRefusal, installationRestartState } from "../../shared/serviceRestart";

/**
 * Which of a Settings → Machines row's keys the machine itself would act on, read from its own
 * PI WEB status. A second PI WEB on the same account refuses Restart (the services installed for
 * this user run another PI WEB), so the row drew a key the server only refused. The row decides by
 * the server's own rule (`installationRestartState` in `shared/serviceRestart.ts`) and says the
 * server's own reason in place of a withheld key.
 *
 * While the machine's status is on its way the row has no key, so it never offers one its server
 * would refuse. A machine that reports no service state - an older one, Windows, Docker, a host
 * without a service manager - or whose status could not be read keeps its key: its server still
 * decides when it is pressed.
 */
export interface FleetMachineOffer {
  readonly restart: boolean;
  /** Why the key is withheld, in the words the row shows; empty when nothing is withheld or no reason is given. */
  readonly notes: readonly string[];
}

/** A row's status read: asked and not answered yet, answered, or not readable. */
export type FleetStatusRead =
  | { readonly kind: "reading" }
  | { readonly kind: "read"; readonly status: PiWebStatusResponse }
  | { readonly kind: "unread" };

export const FLEET_STATUS_READING: FleetStatusRead = { kind: "reading" };

const UNREPORTED: FleetMachineOffer = { restart: true, notes: [] };
const READING: FleetMachineOffer = { restart: false, notes: [] };

/**
 * `undefined`: no read was asked for, because the machine is not reachable. The offer then withholds
 * nothing; the row's reachability is what disables its key.
 */
export function fleetMachineOffer(read: FleetStatusRead | undefined): FleetMachineOffer {
  if (read === undefined || read.kind === "unread") return UNREPORTED;
  if (read.kind === "reading") return READING;
  return offerOfStatus(read.status);
}

/**
 * Restart is offered where the installation's state, by the rule the server refuses with, is
 * confirmed, and its refusal is the row's note.
 */
function offerOfStatus(status: PiWebStatusResponse): FleetMachineOffer {
  const states = [status.components.web.serviceRestart, status.components.sessiond.serviceRestart].filter((state) => state !== undefined);
  if (states.length === 0) return UNREPORTED;
  const installation = installationRestartState(states);
  const restartNote = installationRestartRefusal[installation];
  return {
    restart: installation === "confirmed",
    notes: restartNote === undefined ? [] : [restartNote],
  };
}

/**
 * The machines "Restart every machine" sends, from the reachable machines its caller passes: those
 * whose row offers the operation, so a bulk run never sends one the row withholds or cannot reach.
 * `undefined` while any row's status is still being read: the bulk key waits for every row to know
 * its keys.
 */
export function fleetBulkTargets(machineIds: readonly string[], statuses: Readonly<Record<string, FleetStatusRead>>, operation: PiWebFleetOperation): readonly string[] | undefined {
  if (machineIds.some((machineId) => statuses[machineId]?.kind === "reading")) return undefined;
  return machineIds.filter((machineId) => fleetMachineOffer(statuses[machineId])[operation]);
}
