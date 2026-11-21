import { describe, expect, it, vi } from "vitest";
import type { Machine, PiWebStatusResponse } from "../api";
import { initialAppState, type AppState } from "../appState";
import { PI_WEB_STATUS_FRESH_MS, PiWebStatusController, type PiWebStatusControllerDependencies } from "./piWebStatusController";

type StatusApi = NonNullable<PiWebStatusControllerDependencies["api"]>;

describe("PiWebStatusController.read: one read of a machine's status for every reader (P7 slice c)", () => {
  it("joins a read on its way, reuses a fresh answer for the page's refresh, and asks again once it is stale", async () => {
    let now = 1_000;
    const harness = createHarness("local", () => now);
    const answer = createDeferred<PiWebStatusResponse>();
    harness.piWebStatus.mockReturnValueOnce(answer.promise).mockResolvedValue(status("later"));

    const plugin = harness.controller.read("local");
    const page = harness.controller.refresh();
    answer.resolve(status("first"));
    const pluginAnswer = await plugin;
    await page;
    const whileOnItsWay = harness.piWebStatus.mock.calls.length;
    now += PI_WEB_STATUS_FRESH_MS - 1;
    await harness.controller.refresh();
    const whileFresh = harness.piWebStatus.mock.calls.length;
    now += 2;
    await harness.controller.refresh();

    expect({ pluginAnswer: pluginAnswer.generatedAt, whileOnItsWay, whileFresh, afterStale: harness.piWebStatus.mock.calls.length, shown: harness.state().piWebStatus?.generatedAt })
      .toEqual({ pluginAnswer: "first", whileOnItsWay: 1, whileFresh: 1, afterStale: 2, shown: "later" });
  });

  it("asks again after a failed read, and keeps machines apart", async () => {
    const harness = createHarness();
    harness.piWebStatus.mockRejectedValueOnce(new Error("offline")).mockResolvedValue(status("ok"));

    await expect(harness.controller.read("local")).rejects.toThrow("offline");
    await harness.controller.read("local");
    await harness.controller.read("remote-a");

    expect(harness.piWebStatus.mock.calls.map((call) => call[0])).toEqual(["local", "local", "remote-a"]);
  });

});

describe("PiWebStatusController", () => {
  it("targets the selected machine and applies refreshed status", async () => {
    const harness = createHarness("remote-a");
    harness.piWebStatus.mockResolvedValue(status("remote"));

    await harness.controller.refresh();

    expect(harness.piWebStatus).toHaveBeenCalledWith("remote-a");
    expect(harness.state().piWebStatus?.generatedAt).toBe("remote");
  });


  it("clears current status and reports periodic refresh failures", async () => {
    const harness = createHarness();
    const error = new Error("offline");
    harness.setStatus(status("old"));
    harness.piWebStatus.mockRejectedValue(error);

    await harness.controller.refresh();

    expect(harness.state().piWebStatus).toBeUndefined();
    expect(harness.onRefreshError).toHaveBeenCalledWith("local", error);
  });
});

function createHarness(machineId = "local", now?: () => number) {
  let state: AppState = { ...initialAppState(), selectedMachine: machine(machineId) };
  const piWebStatus = vi.fn<StatusApi["piWebStatus"]>();
  const onRefreshError = vi.fn<(machineId: string, error: unknown) => void>();
  const controller = new PiWebStatusController(
    () => state,
    (patch) => { state = { ...state, ...patch }; },
    { api: { piWebStatus }, onRefreshError, ...(now === undefined ? {} : { now }) },
  );
  return {
    controller,
    piWebStatus,
    onRefreshError,
    state: () => state,
    setStatus: (piWebStatusValue: PiWebStatusResponse) => { state = { ...state, piWebStatus: piWebStatusValue }; },
    selectMachine: (id: string) => { state = { ...state, selectedMachine: machine(id) }; },
  };
}

function machine(id: string): Machine {
  return {
    id,
    name: id,
    kind: id === "local" ? "local" : "remote",
    ...(id === "local" ? {} : { baseUrl: `https://${id}.example.test` }),
    createdAt: "now",
    updatedAt: "now",
  };
}

function status(generatedAt: string): PiWebStatusResponse {
  return {
    packageName: "@gang-of-beads/pi-web",
    generatedAt,
    components: {
      web: { component: "web", label: "Web/UI", stale: false, available: true },
      sessiond: { component: "sessiond", label: "Session daemon", stale: false, available: true },
    },
    commands: {},
    messages: [],
  };
}

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}
