import { describe, expect, it } from "vitest";
import { createStore, idleRead, readFailed } from "./store";

describe("createStore", () => {
  it("publishes a new value to every subscriber", () => {
    const store = createStore({ count: 0 });
    const seen: number[] = [];
    const unsubscribe = store.subscribe(() => {
      seen.push(store.get().count);
    });
    store.set({ count: 1 });
    store.set({ count: 2 });
    unsubscribe();
    store.set({ count: 3 });
    expect(seen).toEqual([1, 2]);
  });

  it("stays silent when the value identity does not change", () => {
    const store = createStore({ count: 0 });
    const value = store.get();
    let notified = 0;
    store.subscribe(() => {
      notified += 1;
    });
    store.set(value);
    store.update((previous) => previous);
    expect(notified).toBe(0);
  });

  it("stops notifying a listener that unsubscribed twice and keeps the others", () => {
    const store = createStore(0);
    let first = 0;
    let second = 0;
    const unsubscribeFirst = store.subscribe(() => {
      first += 1;
    });
    store.subscribe(() => {
      second += 1;
    });
    unsubscribeFirst();
    unsubscribeFirst();
    store.set(1);
    expect(first).toBe(0);
    expect(second).toBe(1);
  });

  it("lets a listener unsubscribe during a publish without skipping its peers", () => {
    const store = createStore(0);
    let late = 0;
    const unsubscribeEarly = store.subscribe(() => {
      unsubscribeEarly();
    });
    store.subscribe(() => {
      late += 1;
    });
    store.set(1);
    expect(late).toBe(1);
  });
});

describe("read state", () => {
  it("states idle as an unknown with no reason", () => {
    expect(idleRead.phase).toBe("idle");
    expect(idleRead.value).toBeUndefined();
    expect(idleRead.error).toBeUndefined();
  });

  it("states a failure with the reason it reports", () => {
    expect(readFailed(new Error("machine offline"))).toEqual({
      value: undefined,
      phase: "failed",
      error: "machine offline",
    });
    expect(readFailed("refused by policy").error).toBe("refused by policy");
  });
});
