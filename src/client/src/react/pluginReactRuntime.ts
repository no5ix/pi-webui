import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { installPiWebReactRuntime, type PiWebReactMembers } from "../../../plugin-react";

/**
 * Publishes the workspace's React to plugins.
 *
 * The table is built from the React this bundle imports, by reference, so what a plugin reads is what
 * rendered the page. It is published before the workspace renders anything, because a plugin module
 * reads it as it loads, and a plugin whose import runs first would report a host that has no React.
 */
export const pluginReactRuntimeMembers: PiWebReactMembers = {
  useState: React.useState,
  useReducer: React.useReducer,
  useEffect: React.useEffect,
  useLayoutEffect: React.useLayoutEffect,
  useMemo: React.useMemo,
  useCallback: React.useCallback,
  useRef: React.useRef,
  useImperativeHandle: React.useImperativeHandle,
  useDebugValue: React.useDebugValue,
  useTransition: React.useTransition,
  useDeferredValue: React.useDeferredValue,
  useId: React.useId,
  useSyncExternalStore: React.useSyncExternalStore,
  useContext: React.useContext,
  createContext: React.createContext,
  createElement: React.createElement,
  cloneElement: React.cloneElement,
  isValidElement: React.isValidElement,
  memo: React.memo,
  forwardRef: React.forwardRef,
  lazy: React.lazy,
  startTransition: React.startTransition,
  Fragment: React.Fragment,
  Suspense: React.Suspense,
  jsx: jsxRuntime.jsx,
  jsxs: jsxRuntime.jsxs,
};

/** Publish the React the page renders with, and report the version a plugin will see. */
export function publishReactRuntimeForPlugins(): void {
  installPiWebReactRuntime({ version: React.version, members: pluginReactRuntimeMembers });
  void verifyPublishedReactRuntime();
}

/**
 * Ask the published modules whether they read what this page published.
 *
 * A plugin's only path to React is `@gang-of-beads/pi-web/jsx-runtime` and `…/plugin-react-hooks`, so
 * a build that tree-shook those entries into bare calls — exports dropped, module loads, nothing
 * reports — leaves every React plugin on the page contributing nothing while the page looks healthy.
 * Reading the published modules back after install, from inside the app's own graph, keeps their
 * exports live and turns that silent build outcome into a console report naming the missing member.
 */
export async function verifyPublishedReactRuntime(): Promise<void> {
  const [jsx, hooks] = await Promise.all([
    import("../../../jsx-runtime.js").catch(() => undefined),
    import("../../../plugin-react-hooks.js").catch(() => undefined),
  ]);
  const missing = [
    ...(jsx?.jsx === undefined ? ["jsx-runtime.jsx"] : []),
    ...(jsx?.jsxs === undefined ? ["jsx-runtime.jsxs"] : []),
    ...(jsx?.Fragment === undefined ? ["jsx-runtime.Fragment"] : []),
    ...(hooks?.useState === undefined ? ["plugin-react-hooks.useState"] : []),
    ...(hooks?.useMemo === undefined ? ["plugin-react-hooks.useMemo"] : []),
    ...(hooks?.createElement === undefined ? ["plugin-react-hooks.createElement"] : []),
  ];
  if (missing.length > 0) {
    console.error(`[pi-web] the published React runtime is incomplete: ${missing.join(", ")} — a plugin's React contribution cannot load.`);
  }
}
