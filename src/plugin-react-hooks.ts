import type { PiWebReactMembers } from "./plugin-react.js";
import { piWebReactMember } from "./plugin-react.js";

/**
 * The React a plugin builds with.
 *
 * Importing this module reads the React the workspace published, so a plugin's bundle carries no React
 * of its own and every component on the page is rendered by one reconciler — the React that renders a
 * plugin's element is the React whose dispatcher its hooks close over, which is the one thing a page
 * with two React copies cannot promise (the symptom is React's "Invalid hook call", reported against
 * the plugin and diagnosed for hours as a plugin bug).
 *
 * Each member keeps React's type, generics and overloads, so a plugin writes ordinary React:
 * `useState`, `useEffect`, `useMemo`, `createElement`, `memo`. The JSX runtime a plugin's `jsx:
 * "react-jsx"` output imports is published beside this module as the host's own `jsx-runtime`, so a
 * plugin does not name `react` anywhere in its source.
 *
 * A workspace that has published no React — a plugin module opened on its own — raises
 * `PiWebReactRuntimeError` as the module loads, and the registry reports the plugin as failed.
 */
export const useState: PiWebReactMembers["useState"] = piWebReactMember("useState");
export const useReducer: PiWebReactMembers["useReducer"] = piWebReactMember("useReducer");
export const useEffect: PiWebReactMembers["useEffect"] = piWebReactMember("useEffect");
export const useLayoutEffect: PiWebReactMembers["useLayoutEffect"] = piWebReactMember("useLayoutEffect");
export const useMemo: PiWebReactMembers["useMemo"] = piWebReactMember("useMemo");
export const useCallback: PiWebReactMembers["useCallback"] = piWebReactMember("useCallback");
export const useRef: PiWebReactMembers["useRef"] = piWebReactMember("useRef");
export const useImperativeHandle: PiWebReactMembers["useImperativeHandle"] = piWebReactMember("useImperativeHandle");
export const useDebugValue: PiWebReactMembers["useDebugValue"] = piWebReactMember("useDebugValue");
export const useTransition: PiWebReactMembers["useTransition"] = piWebReactMember("useTransition");
export const useDeferredValue: PiWebReactMembers["useDeferredValue"] = piWebReactMember("useDeferredValue");
export const useId: PiWebReactMembers["useId"] = piWebReactMember("useId");
export const useSyncExternalStore: PiWebReactMembers["useSyncExternalStore"] = piWebReactMember("useSyncExternalStore");
export const useContext: PiWebReactMembers["useContext"] = piWebReactMember("useContext");
export const createContext: PiWebReactMembers["createContext"] = piWebReactMember("createContext");
export const createElement: PiWebReactMembers["createElement"] = piWebReactMember("createElement");
export const cloneElement: PiWebReactMembers["cloneElement"] = piWebReactMember("cloneElement");
export const isValidElement: PiWebReactMembers["isValidElement"] = piWebReactMember("isValidElement");
export const memo: PiWebReactMembers["memo"] = piWebReactMember("memo");
export const forwardRef: PiWebReactMembers["forwardRef"] = piWebReactMember("forwardRef");
export const lazy: PiWebReactMembers["lazy"] = piWebReactMember("lazy");
export const startTransition: PiWebReactMembers["startTransition"] = piWebReactMember("startTransition");
export const Fragment: PiWebReactMembers["Fragment"] = piWebReactMember("Fragment");
export const Suspense: PiWebReactMembers["Suspense"] = piWebReactMember("Suspense");
