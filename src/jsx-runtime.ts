import type { PiWebReactMembers } from "./plugin-react.js";
import { piWebReactMember } from "./plugin-react.js";

/**
 * The JSX runtime plugin code compiles against.
 *
 * A plugin's `jsx: "react-jsx"` output imports `<package>/jsx-runtime`, and that import must land on
 * the workspace's React, not on a copy the plugin bundler resolves for it. The host publishes the
 * runtime here, and a plugin's build names this package as its `jsxImportSource`, so the JSX in a
 * plugin's source is created by the reconciler that renders it — which is what lets a host component
 * and a plugin component sit in one tree.
 */
/**
 * The JSX namespace, re-exported so a plugin's `jsx: "react-jsx"` output finds the element types under
 * this import source. A plugin's `<div>` is then checked against React's own element types, and the
 * values that build it come from the published React.
 */
export type { JSX } from "react/jsx-runtime";

export const jsx: PiWebReactMembers["jsx"] = piWebReactMember("jsx");
export const jsxs: PiWebReactMembers["jsxs"] = piWebReactMember("jsxs");
export const Fragment: PiWebReactMembers["Fragment"] = piWebReactMember("Fragment");
