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

/**
 * An element a plugin contributes: what to render, the props to render it with, and its children.
 *
 * The shape is React's own element read structurally — a real `ReactElement` carries these beside
 * `$$typeof` — because the contract must compile where React does not exist. The host is the one place
 * that treats the two as one, and it checks the shape before it spends the cast (`pluginReactNode.tsx`).
 */
export interface PluginReactElement {
  /**
   * What to render. React's own element types spell this as `string | JSXElementConstructor`, and
   * `JSXElementConstructor` — components returning React's wider `ReactNode`, class components, the
   * built-ins — has no spelling in a contract that must compile where React does not exist. So the
   * member stays open here and the check stays real: `isPluginReactNode` rejects a `type` that is not
   * a tag, a function, or a component object before React is asked to draw it.
   */
  readonly type: unknown;
  readonly props: unknown;
  readonly key?: string | null;
  readonly children?: PluginReactNode;
}

/**
 * A component a plugin contributes, spelled so React's own element types assign to it.
 *
 * The wide members are deliberate: a real `ReactElement`'s `type` is React's `JSXElementConstructor`,
 * which covers function components, class components and the built-ins, and its return is React's own
 * `ReactNode`, a wider union than the one spelled here without React. The host does not trust the
 * shape to type-check a plugin's work — `isPluginReactNode` inspects what arrives at render time — so
 * the declaration stays open and the check stays real.
 */
export type PluginReactComponentType =
  | string
  | ((props: never) => PluginReactNode)
  | ((props: never) => unknown)
  | (new (props: never) => unknown)
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

/**
 * True when a contributed value has the shape React renders.
 *
 * The host checks a contribution with this before it hands it to React, so a plugin that returns a Lit
 * template, a DOM node, or an object of its own is named in a report. React would draw nothing for
 * those and say nothing, and a surface that is silently empty cannot be told apart from one that is
 * still loading.
 */
export function isPluginReactNode(value: unknown): value is PluginReactNode {
  if (value === null || value === undefined) return true;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return true;
  if (Array.isArray(value)) return true;
  return isElementShaped(value);
}

function isElementShaped(value: unknown): value is PluginReactElement {
  if (typeof value !== "object" || value === null) return false;
  const element: Partial<PluginReactElement> = value;
  const type = element.type;
  const renderableType = typeof type === "string" || typeof type === "function" || (typeof type === "object" && type !== null);
  if (!renderableType) return false;
  return typeof element.props === "object" && element.props !== null;
}
