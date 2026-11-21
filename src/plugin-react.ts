import type * as ReactTypes from "react";
import type * as JsxRuntimeTypes from "react/jsx-runtime";

/**
 * The React a plugin uses is the React the workspace renders with.
 *
 * A plugin module is loaded by the browser, and a bundler will happily give every plugin its own copy
 * of React. Two copies in one page do not fail loudly: a component from the second copy, rendered by
 * the first, reaches for a dispatcher that is not its own, and React answers "Invalid hook call". A
 * panel that dies with that message tells a reader nothing about which side is at fault, so this module
 * makes the rule structural: a plugin never resolves `react`, it asks the host for it.
 *
 * The workspace publishes its React once, at boot, under a global key, as a table of the members a
 * plugin is handed. A plugin's bundle therefore carries no React at all, and a page whose workspace and
 * plugins were built against different React versions still has exactly one reconciler.
 */
export const PI_WEB_REACT_RUNTIME_KEY = "__piWebReactRuntime";

/**
 * The React members a plugin is handed, each with React's own type, generics and overloads. A plugin
 * builds JSX against the JSX runtime (`jsx`, `jsxs`, `Fragment`) and hooks from the same table, so the
 * plugin's `react` and the workspace's `react` are the same object.
 */
export interface PiWebReactMembers {
  readonly useState: typeof ReactTypes.useState;
  readonly useReducer: typeof ReactTypes.useReducer;
  readonly useEffect: typeof ReactTypes.useEffect;
  readonly useLayoutEffect: typeof ReactTypes.useLayoutEffect;
  readonly useMemo: typeof ReactTypes.useMemo;
  readonly useCallback: typeof ReactTypes.useCallback;
  readonly useRef: typeof ReactTypes.useRef;
  readonly useImperativeHandle: typeof ReactTypes.useImperativeHandle;
  readonly useDebugValue: typeof ReactTypes.useDebugValue;
  readonly useTransition: typeof ReactTypes.useTransition;
  readonly useDeferredValue: typeof ReactTypes.useDeferredValue;
  readonly useId: typeof ReactTypes.useId;
  readonly useSyncExternalStore: typeof ReactTypes.useSyncExternalStore;
  readonly useContext: typeof ReactTypes.useContext;
  readonly createContext: typeof ReactTypes.createContext;
  readonly createElement: typeof ReactTypes.createElement;
  readonly cloneElement: typeof ReactTypes.cloneElement;
  readonly isValidElement: typeof ReactTypes.isValidElement;
  readonly memo: typeof ReactTypes.memo;
  readonly forwardRef: typeof ReactTypes.forwardRef;
  readonly lazy: typeof ReactTypes.lazy;
  readonly startTransition: typeof ReactTypes.startTransition;
  readonly Fragment: typeof ReactTypes.Fragment;
  readonly Suspense: typeof ReactTypes.Suspense;
  readonly jsx: typeof JsxRuntimeTypes.jsx;
  readonly jsxs: typeof JsxRuntimeTypes.jsxs;
}

/** What the host publishes: its React version, and the members it hands plugins. */
export interface PiWebReactRuntime {
  readonly version: string;
  readonly members: PiWebReactMembers;
}

/** Raised when a plugin asks for React before the workspace published it. */
export class PiWebReactRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PiWebReactRuntimeError";
  }
}

declare global {
  // The published runtime, under the key named above. Declared so the accessors are typed.
  var __piWebReactRuntime: PiWebReactRuntime | undefined;
}

/**
 * Publish the React the page renders with; the workspace calls this before it boots a plugin registry.
 *
 * The first publisher wins. A second publisher means two bundles each convinced they own React: the
 * page is already rendered by the first, so the second is refused and its version is reported — the
 * report a maintainer needs to find the bundle that brought its own React.
 */
export function installPiWebReactRuntime(runtime: PiWebReactRuntime): { accepted: boolean; existingVersion?: string } {
  const current = globalThis.__piWebReactRuntime;
  if (current !== undefined) {
    console.warn(`[pi-web] ${PI_WEB_REACT_RUNTIME_KEY} was published twice: keeping ${current.version}, refusing ${runtime.version}.`);
    return { accepted: false, existingVersion: current.version };
  }
  globalThis.__piWebReactRuntime = runtime;
  return { accepted: true };
}

/** Forget the published React. For a test that installs its own. */
export function resetPiWebReactRuntime(): void {
  globalThis.__piWebReactRuntime = undefined;
}

/** The published React, with a report that says what to do — never an anonymous undefined. */
export function piWebReactRuntime(): PiWebReactRuntime {
  const runtime = globalThis.__piWebReactRuntime;
  if (runtime === undefined) {
    throw new PiWebReactRuntimeError(
      "No React runtime is published. A plugin's UI is rendered by the workspace's React, which the workspace publishes as it boots; a plugin loaded outside a workspace has no host to render into.",
    );
  }
  return runtime;
}

/** True once the host has published React, so a host can say what is missing instead of crashing. */
export function piWebReactRuntimeIsInstalled(): boolean {
  return globalThis.__piWebReactRuntime !== undefined;
}

/**
 * One member of the published React.
 *
 * A plugin module calls this as it loads, so a workspace that published no React makes the plugin's
 * import fail with a report that names the missing host, and the registry records the plugin as failed
 * instead of drawing a panel that throws on its first render.
 */
export function piWebReactMember<K extends keyof PiWebReactMembers>(name: K): PiWebReactMembers[K] {
  return piWebReactRuntime().members[name];
}
