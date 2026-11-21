import { isPluginReactNode } from "../../../../shared/pluginReactTypes";
import type { ReactNode } from "react";

/** A plugin returned something React cannot draw: a Lit template, a DOM node, a function. */
export class PluginReactContributionError extends Error {
  constructor(readonly contributionId: string, readonly received: string) {
    super(`Plugin contribution ${contributionId} returned ${received}, which is not a React node.`);
    this.name = "PluginReactContributionError";
  }
}

/**
 * The seam between the plugin contract's structural node and React's own.
 *
 * `plugin-api` declares a contributed node without importing React — the contract is typechecked
 * against a world where React does not exist — so its element is a `{ type, props }` pair, and a React
 * element is that pair beside `$$typeof` and `key`. Each side satisfies the other, and this module is
 * the one place the equivalence is spent, as a single cast.
 *
 * The value arrives as `unknown`, on purpose: the host boundary is the validator, and narrowing an
 * `unknown` is a check, while casting a typed value is a claim. A plugin that returns a Lit template, a
 * DOM node, or an object of its own is reported by name, because handed to React those draw nothing and
 * say nothing, and a surface that is silently empty cannot be told from one that is still loading.
 */
export function asReactNode(node: unknown, contributionId: string): ReactNode {
  if (!isPluginReactNode(node)) {
    throw new PluginReactContributionError(contributionId, describeNode(node));
  }
  return node as ReactNode;
}

function describeNode(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  if (typeof value !== "object") return `a ${typeof value}`;
  if ("strings" in value && "values" in value) return "a Lit template (the React host renders React contributions)";
  const constructor = value.constructor;
  const name = typeof constructor === "function" ? constructor.name : undefined;
  if (name !== undefined && name !== "Object") return `a ${name}`;
  return "an object";
}
