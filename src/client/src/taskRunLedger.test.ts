import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  TaskRunLedger,
  taskRunKey,
  taskRunStatusText,
  taskRunVerdict,
  type TaskRunRecord,
} from "./taskRunLedger.js";
import { runDuration } from "./runDuration.js";

/** A storage that behaves like a browser's: enumerable, string-only, and replaceable per test. */
function fakeStorage() {
  const values = new Map<string, string>();
  const storage = {
    get length() { return values.size; },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  return { storage, values };
}

const record = (over: Partial<TaskRunRecord> = {}): TaskRunRecord => ({
  outcome: "completed",
  elapsedMs: 134_000,
  finishedAtMs: 1_700_000_134_000,
  partial: false,
  ...over,
});

const key = (machineId = "local", sessionId = "session-1") => taskRunKey(machineId, sessionId);

let store: ReturnType<typeof fakeStorage>;
const storageKey = (k: string) => `pi-web-task-run/${k}`;

beforeEach(() => {
  store = fakeStorage();
  Object.defineProperty(globalThis, "localStorage", { value: store.storage, configurable: true, writable: true });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "localStorage");
});

describe("taskRunVerdict", () => {
  it("keeps the page's five words down to the four a reader is shown", () => {
    expect(taskRunVerdict(record({ outcome: "completed" }))).toBe("completed");
    expect(taskRunVerdict(record({ outcome: "failed" }))).toBe("failed");
    expect(taskRunVerdict(record({ outcome: "stopped" }))).toBe("cancelled");
    expect(taskRunVerdict(record({ outcome: "interrupted" }))).toBe("cancelled");
    expect(taskRunVerdict(record({ outcome: "unknown" }))).toBe("unconfirmed");
  });
});

describe("taskRunStatusText", () => {
  it("says what the last task did and what it cost", () => {
    expect(taskRunStatusText(record()).text).toBe("took 2m 14s");
    expect(taskRunStatusText(record({ outcome: "failed" })).text).toBe("failed after 2m 14s");
    expect(taskRunStatusText(record({ outcome: "stopped" })).text).toBe("stopped after 2m 14s");
    expect(taskRunStatusText(record({ outcome: "unknown", elapsedMs: 5_000 })).text).toBe("ended");
  });

  it("is honest in the sentence a hover reveals: no verdict for an unconfirmed end, a lower bound for a partial watch", () => {
    expect(taskRunStatusText(record()).title).toBe("The page measured 2m 14s from seeing this task start to seeing it finish.");
    expect(taskRunStatusText(record({ outcome: "failed" })).title).toContain("seeing it fail");
    expect(taskRunStatusText(record({ outcome: "unknown" })).title).toContain("did not see how it ended");
    expect(taskRunStatusText(record({ outcome: "unknown", partial: true })).title).toContain("joined it partway");
    expect(taskRunStatusText(record({ partial: true })).title).toContain("this page watched part of it");
    expect(taskRunStatusText(record({ outcome: "unknown" })).title).not.toContain("finished");
  });

  it("formats a span in the units a reader compares with", () => {
    expect(runDuration(900)).toBe("1s");
    expect(runDuration(3_400)).toBe("3s");
    expect(runDuration(65_000)).toBe("1m 5s");
    expect(runDuration(3_720_000)).toBe("1h 2m");
    expect(runDuration(-5)).toBe("0s");
  });
});

describe("TaskRunLedger", () => {
  it("keeps the finished run of the session it was recorded for, and of no other", () => {
    const ledger = new TaskRunLedger();
    ledger.record(key(), record());
    expect(ledger.last(key())?.outcome).toBe("completed");
    expect(ledger.last(key("local", "session-2"))).toBeUndefined();
    expect(ledger.last(key("machine-b", "session-1"))).toBeUndefined();
  });

  it("freezes the span the page measured, which is what makes it a fact and not a clock", () => {
    const ledger = new TaskRunLedger();
    ledger.record(key(), record({ elapsedMs: 42_000 }));
    expect(ledger.last(key())).toMatchObject({ elapsedMs: 42_000, finishedAtMs: 1_700_000_134_000 });
  });

  it("clears the record when the next task starts, so no status line shows a stale verdict", () => {
    const ledger = new TaskRunLedger();
    ledger.record(key(), record());
    ledger.clear(key());
    expect(ledger.last(key())).toBeUndefined();
    expect(store.values.has(storageKey(key()))).toBe(false);
  });

  it("survives a reload, because the question is asked after the page is gone", () => {
    new TaskRunLedger().record(key(), record());
    expect(new TaskRunLedger().last(key())).toMatchObject({ outcome: "completed", elapsedMs: 134_000 });
  });

  it("writes under the app's own key, so one browser holds one list", () => {
    new TaskRunLedger().record(key(), record());
    expect(store.values.has(storageKey(key("local", "session-1")))).toBe(true);
  });

  it("drops a stored row that is not a record, and keeps the rows that are", () => {
    store.values.set(storageKey("a"), "not json");
    store.values.set(storageKey("b"), JSON.stringify({ outcome: "exploded", elapsedMs: 1, finishedAtMs: 1 }));
    store.values.set(storageKey("c"), JSON.stringify({ outcome: "completed", elapsedMs: -1, finishedAtMs: 1 }));
    store.values.set(storageKey("d"), JSON.stringify({ outcome: "stopped", elapsedMs: 2, finishedAtMs: 1 }));
    store.values.set(storageKey("e"), JSON.stringify({ outcome: "completed" }));
    store.values.set("other-key", JSON.stringify({ outcome: "completed", elapsedMs: 2, finishedAtMs: 1 }));
    const ledger = new TaskRunLedger();
    expect(ledger.last("d")).toMatchObject({ outcome: "stopped" });
    for (const junk of ["a", "b", "c", "e"]) expect(ledger.last(junk)).toBeUndefined();
  });

  it("leaves a storage entry that is not its own alone", () => {
    store.values.set("some-other-app", "keep me");
    new TaskRunLedger().record(key(), record());
    expect(store.values.get("some-other-app")).toBe("keep me");
  });

  it("bounds its own list, keeping the newest runs", () => {
    const ledger = new TaskRunLedger();
    for (let index = 0; index < 210; index += 1) {
      ledger.record(key("local", `session-${String(index)}`), record({ elapsedMs: 1_000, finishedAtMs: 1_000 + index }));
    }
    const stored = [...store.values.keys()].filter((entry) => entry.startsWith("pi-web-task-run/"));
    expect(stored.length).toBe(200);
    expect(ledger.last(key("local", "session-209"))).toBeDefined();
    // The bound is the device's memory: the page that is running still knows what it watched, and the
    // list the next load reads holds the newest runs.
    expect(new TaskRunLedger().last(key("local", "session-209"))).toBeDefined();
    expect(new TaskRunLedger().last(key("local", "session-0"))).toBeUndefined();
  });

  it("treats a storage that throws as a ledger with no memory, not a broken status bar", () => {
    const hostile = {
      get length() { return 1; },
      key: () => "pi-web-task-run/x",
      getItem: () => { throw new Error("site data blocked"); },
      setItem: () => { throw new Error("quota"); },
      removeItem: () => { throw new Error("quota"); },
    };
    Object.defineProperty(globalThis, "localStorage", { value: hostile, configurable: true, writable: true });
    const ledger = new TaskRunLedger();
    expect(() => { ledger.record(key(), record()); }).not.toThrow();
    expect(ledger.last(key())).toMatchObject({ outcome: "completed" });
  });

  it("works in an environment with no storage at all", () => {
    Reflect.deleteProperty(globalThis, "localStorage");
    const ledger = new TaskRunLedger();
    ledger.record(key(), record());
    expect(ledger.last(key())?.elapsedMs).toBe(134_000);
  });
});
