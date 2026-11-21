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
}
