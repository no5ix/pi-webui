import { useEffect, useRef, type ReactNode } from "react";
import { nothing, render, type TemplateResult } from "lit";

/**
 * A Lit template inside the React tree.
 *
 * A plugin contribution hands the shell a `TemplateResult`, and the only honest
 * way to show one is Lit's own renderer. This boundary owns a node, renders the
 * template into it, re-renders when the template changes, and clears the node
 * when the contribution goes away, so a plugin body appears and disappears with
 * the React surface that hosts it and never outlives it.
 */
export interface LitTemplateBoundaryProps {
  template: TemplateResult | undefined;
  className?: string | undefined;
  label?: string | undefined;
}

export function LitTemplateBoundary(props: LitTemplateBoundaryProps): ReactNode {
  const host = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = host.current;
    if (node === null) return;
    if (props.template === undefined) {
      render(nothing, node);
      return;
    }
    render(props.template, node);
    return () => {
      render(nothing, node);
    };
  }, [props.template]);

  return <div aria-label={props.label} className={props.className} ref={host} />;
}
