import { useEffect, useRef } from "react";
import { html, nothing, render } from "lit";
import type { TemplateResult } from "lit";

/**
 * A React host for one plugin contribution.
 *
 * The public plugin API (`src/plugin-api.ts`) is Lit-typed: a section, panel, renderer or composer
 * action returns a `TemplateResult`. React cannot render one, and a plugin cannot be asked to return
 * JSX, so this component hands a container to lit-html's own `render` and keeps the two renderers out
 * of each other's DOM: React owns the element, lit-html owns its content, and unmounting clears the
 * content so a plugin's own parts and event listeners leave with it.
 */
export interface PluginSurfaceProps {
  /** The contribution's own template, already produced by the plugin. */
  readonly contribution: TemplateResult | undefined;
  /** The plugin's name, shown when its interface fails to render. */
  readonly pluginLabel: string;
  readonly className?: string;
}

export function PluginSurface({ contribution, pluginLabel, className }: PluginSurfaceProps) {
  const host = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = host.current;
    if (container === null) return;
    try {
      render(contribution ?? nothing, container);
    } catch (error) {
      render(failedSurface(pluginLabel, error), container);
    }
    return () => {
      render(nothing, container);
    };
  }, [contribution, pluginLabel]);

  return <div className={className ?? "rw-plugin-surface"} data-pi-plugin-surface={pluginLabel} ref={host} />;
}

/**
 * A contribution produced where a throw is catchable.
 *
 * lit-html swallows an exception raised inside a binding's own function - the content comes out empty
 * and the failure only reaches the console - so the host that asks the plugin for its template catches
 * around that call. A plugin that cannot produce its interface is named in the panel it left empty,
 * and it does not take the other plugins' interfaces with it.
 */
export function pluginSurfaceResult(pluginLabel: string, produce: () => TemplateResult): TemplateResult | undefined {
  try {
    return produce();
  } catch (error) {
    return failedSurface(pluginLabel, error);
  }
}

function failedSurface(pluginLabel: string, error: unknown): TemplateResult {
  const reason = error instanceof Error ? error.message : String(error);
  return html`<p class="rw-setting-error" role="status">${pluginLabel} could not render its interface: ${reason}</p>`;
}
