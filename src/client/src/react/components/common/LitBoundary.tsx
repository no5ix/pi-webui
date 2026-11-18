import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

/**
 * The compatibility boundary for Custom Elements.
 *
 * PI WEB's plugin contract is Custom Elements: a contributed panel, page,
 * transcript renderer, settings panel or interactive surface is a registered
 * element that takes properties and emits events. React does not replace that
 * contract — it hosts it. This component owns one element instance, writes its
 * reactive properties, binds its events, and disposes it on unmount, so a plugin
 * written against Lit keeps working inside the React shell with no plugin-side
 * change.
 *
 * Everything above this boundary is React; everything a plugin contributes lives
 * behind it.
 */
export interface LitBoundaryProps {
  tag: string;
  properties?: Record<string, unknown>;
  events?: Record<string, (event: Event) => void>;
  /** Handed the element once it exists, for a host that calls the element's own methods. */
  onElement?(element: HTMLElement): void;
  className?: string;
  style?: CSSProperties;
  testId?: string;
}

export function LitBoundary(props: LitBoundaryProps): ReactNode {
  const host = useRef<HTMLDivElement | null>(null);
  const element = useRef<HTMLElement | null>(null);
  const handlers = useRef(props.events ?? {});
  handlers.current = props.events ?? {};

  useEffect(() => {
    const container = host.current;
    if (container === null) return;
    const created = document.createElement(props.tag);
    element.current = created;
    container.append(created);
    props.onElement?.(created);
    const bound = new Map<string, EventListener>();
    for (const name of Object.keys(handlers.current)) {
      const listener: EventListener = (event) => {
        handlers.current[name]?.(event);
      };
      bound.set(name, listener);
      created.addEventListener(name, listener);
    }
    applyProperties(created, props.properties);
    return () => {
      for (const [name, listener] of bound) created.removeEventListener(name, listener);
      created.remove();
      element.current = null;
    };
  }, [props.tag]);

  useEffect(() => {
    if (element.current === null) return;
    applyProperties(element.current, props.properties);
  }, [props.properties]);

  return (
    <div
      className={props.className}
      data-testid={props.testId}
      ref={host}
      style={{ ...props.style, display: "contents" }}
    />
  );
}

function applyProperties(target: HTMLElement, properties: Record<string, unknown> | undefined): void {
  if (properties === undefined) return;
  for (const [name, value] of Object.entries(properties)) {
    Reflect.set(target, name, value);
  }
}
