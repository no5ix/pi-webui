/**
 * The React contribution vocabulary, with no React dependency.
 *
 * A plugin contributes UI by returning a React element, written as JSX against the `react` the host
 * provides. The plugin API package stays free of a React runtime dependency — `typecheck:plugin-api`
 * checks the contract against a world where React does not exist — so a contributed node is declared
 * structurally: an element is a `type` and its `props`, and a real `ReactElement` (which carries
 * `$$typeof` and `key` beside them) satisfies that shape. The React host is the one place that turns
 * a `PluginReactNode` back into a `ReactNode`, so the seam between the contract and React's own types
 * is a single audited line.
 */

/** An element a plugin contributes: a component (or intrinsic tag) and its props. */
export interface PluginReactElement {
  readonly type: PluginReactComponentType;
  readonly props: unknown;
  readonly key?: string | null;
}

/** A component a plugin contributes: a function of props returning a node. */
export type PluginReactComponentType =
  | string
  | ((props: never) => PluginReactNode)
  | { readonly render?: (props: never) => PluginReactNode };

/** A list of nodes, as React accepts them. */
export type PluginReactNodeList = readonly PluginReactNode[];

/**
 * What a plugin's React render returns: exactly the union React renders, spelled without importing
 * React. `undefined` and `null` render nothing, and a promise resolves before it is drawn.
 */
export type PluginReactNode =
  | string
  | number
  | boolean
  | null
  | undefined
  | PluginReactElement
  | PluginReactNodeList;

/** A component a plugin contributes, for a host that mounts it as a component rather than a node. */
export type PluginReactComponent<TProps> = (props: TProps) => PluginReactNode;
