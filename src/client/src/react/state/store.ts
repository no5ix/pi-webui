import { useCallback, useRef, useSyncExternalStore } from "react";

/**
 * The React tree reads application state through external stores.
 *
 * PI WEB's data layer (the API clients, the socket clients, the transcript
 * store, the session board) is plain TypeScript and is not rewritten here: a
 * store wraps one of those engines, publishes an immutable snapshot, and React
 * subscribes with `useSyncExternalStore`. There is exactly one owner of each
 * fact, and it is the same owner the Lit tree had.
 */
export interface ReadableStore<T> {
  get: () => T;
  subscribe(listener: () => void): () => void;
}

export interface Store<T> extends ReadableStore<T> {
  set: (next: T) => void;
  update(mutate: (previous: T) => T): void;
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  const publish = (): void => {
    for (const listener of [...listeners]) listener();
  };
  return {
    get: () => value,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set: (next) => {
      if (next === value) return;
      value = next;
      publish();
    },
    update: (mutate) => {
      const next = mutate(value);
      if (next === value) return;
      value = next;
      publish();
    },
  };
}


/**
 * Read part of a store without re-rendering on unrelated writes.
 *
 * `select` must be stable — a module-scope function — because a new selector
 * identity rebuilds the cached snapshot, and the cached result is reused for an
 * unchanged source object.
 */
export function useStoreSelect<T, S>(store: ReadableStore<T>, select: (value: T) => S): S {
  const cache = useRef<{ source: T; selected: S } | null>(null);
  const subscribe = useCallback((listener: () => void) => store.subscribe(listener), [store]);
  const snapshot = useCallback((): S => {
    const source = store.get();
    const cached = cache.current;
    if (cached !== null && cached.source === source) return cached.selected;
    const selected = select(source);
    cache.current = { source, selected };
    return selected;
  }, [store, select]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** One run of a read that can be superseded, with the reason it is unknown stated. */
export interface ReadState<T> {
  readonly value: T | undefined;
  readonly phase: "idle" | "loading" | "ready" | "refused" | "failed";
  readonly error: string | undefined;
}

export const idleRead: ReadState<never> = { value: undefined, phase: "idle", error: undefined };

export function readFailed(error: unknown): ReadState<never> {
  return { value: undefined, phase: "failed", error: error instanceof Error ? error.message : String(error) };
}
