import { piWebApi, type PiWebStatusResponse } from "../api";
import { selectedMachineId, type GetState, type SetState } from "./types";

export interface PiWebStatusControllerDependencies {
  api?: Pick<typeof piWebApi, "piWebStatus">;
  onRefreshError?: (machineId: string, error: unknown) => void;
  now?: () => number;
}

export const PI_WEB_STATUS_FRESH_MS = 30_000;

interface StatusRead {
  flight?: Promise<PiWebStatusResponse>;
  answer?: { at: number; value: PiWebStatusResponse };
}

export class PiWebStatusController {
  private readonly api: Pick<typeof piWebApi, "piWebStatus">;
  private readonly onRefreshError: (machineId: string, error: unknown) => void;
  private requestSequence = 0;
  private readonly now: () => number;
  private readonly reads = new Map<string, StatusRead>();

  constructor(
    private readonly getState: GetState,
    private readonly setState: SetState,
    dependencies: PiWebStatusControllerDependencies = {},
  ) {
    this.api = dependencies.api ?? piWebApi;
    this.onRefreshError = dependencies.onRefreshError ?? (() => undefined);
    this.now = dependencies.now ?? (() => Date.now());
  }

  read(machineId: string): Promise<PiWebStatusResponse> {
    const entry = this.reads.get(machineId) ?? {};
    this.reads.set(machineId, entry);
    if (entry.flight !== undefined) return entry.flight;
    if (entry.answer !== undefined && this.now() - entry.answer.at < PI_WEB_STATUS_FRESH_MS) return Promise.resolve(entry.answer.value);
    const flight = this.api.piWebStatus(machineId).then((value) => {
      entry.answer = { at: this.now(), value };
      return value;
    }).finally(() => {
      delete entry.flight;
    });
    entry.flight = flight;
    return flight;
  }

  async refresh(): Promise<void> {
    const machineId = selectedMachineId(this.getState());
    const requestSequence = ++this.requestSequence;
    try {
      const piWebStatus = await this.read(machineId);
      if (!this.isCurrent(machineId, requestSequence)) return;
      this.setState({ piWebStatus });
    } catch (error) {
      if (!this.isCurrent(machineId, requestSequence)) return;
      this.setState({ piWebStatus: undefined });
      this.onRefreshError(machineId, error);
    }
  }

  private isCurrent(machineId: string, requestSequence: number): boolean {
    return selectedMachineId(this.getState()) === machineId && requestSequence === this.requestSequence;
  }
}
