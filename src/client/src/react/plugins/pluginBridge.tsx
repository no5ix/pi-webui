import { useEffect, useRef, type ReactNode } from "react";
import { nothing, render } from "lit";
import { piWebApi } from "../../api/clients";
import { PluginRegistry } from "../../plugins/registry";
import { corePlugin } from "../../plugins/core";
import { loadExternalPlugins, type ExternalPluginLoadResult } from "../../plugins/external";
import { createPluginHostUi, type PluginDialogHost } from "../../plugins/pluginHostUi";
import type { PluginDialog, QualifiedComposerContribution, QualifiedThemeContribution, QualifiedThemePairContribution } from "../../plugins/types";
import { machineScopedPluginId } from "../../../../shared/machinePluginIds";
import { setPluginThemes } from "../state/theme";
import { Dialog } from "../components/common/Dialog";
import { createStore, useStoreSelect } from "../state/store";

/**
 * The plugin layer under the React shell.
 *
 * A PI WEB plugin registers against `PluginRegistry`; its UI is Custom Elements
 * and Lit templates and its contributions are read from that registry. None of
 * that is a React concern, so the React shell does not reimplement it: it owns
 * one registry — built the way the Lit shell built its own — and reads
 * contributions from it. Plugin surfaces are hosted by `LitBoundary` (panels,
 * settings sections, transcript and tool renderers) and by `PluginDialogLayer`
 * for `showDialog`.
 *
 * Two things the shell does not yet do, said plainly: a plugin that asks to open
 * a plugin page is forwarded as a `pi-web-plugin-open-page` event (the React
 * router has no plugin page route), and no fleet source is handed to the
 * registry, so a plugin that reads the fleet sees no machines.
 */
export interface PluginBridgeState {
  readonly machineId: string;
  readonly version: number;
  readonly loading: boolean;
  readonly failures: readonly string[];
}

export const pluginStore = createStore<PluginBridgeState>({ machineId: "local", version: 0, loading: false, failures: [] });

const dialogStore = createStore<{ readonly dialogs: readonly PluginDialog[]; readonly seq: number }>({ dialogs: [], seq: 0 });

let registry: PluginRegistry | undefined;
const loadedMachines = new Set<string>();

export function pluginRegistry(): PluginRegistry {
  if (registry !== undefined) return registry;
  const dialogHost: PluginDialogHost = {
    showDialog: (dialog) => {
      dialogStore.update((current) => ({ dialogs: [...current.dialogs, dialog], seq: current.seq + 1 }));
      return {
        close: () => {
          dismiss(dialog);
        },
      };
    },
  };
  registry = new PluginRegistry({
    ui: createPluginHostUi(dialogHost),
    readPiWebStatus: (machineId) => piWebApi.piWebStatus(machineId),
    openPage: (pageId) => {
      const split = pageId.indexOf(":");
      window.dispatchEvent(
        new CustomEvent("pi-web-plugin-open-page", {
          detail: { pluginId: split < 0 ? "core" : pageId.slice(0, split), id: split < 0 ? pageId : pageId.slice(split + 1) },
        }),
      );
    },
    fetchJson: async (path, init) => {
      const response = await fetch(new URL(path, document.baseURI).href, {
        ...(init?.method === undefined ? {} : { method: init.method }),
        ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error(`${String(response.status)} ${response.statusText}`);
      const data: unknown = await response.json();
      return data;
    },
  });
  registry.register({ id: "core", plugin: corePlugin });
  return registry;
}

function dismiss(dialog: PluginDialog): void {
  dialogStore.update((current) => ({ dialogs: current.dialogs.filter((entry) => entry !== dialog), seq: current.seq + 1 }));
  dialog.onClose?.();
}

export function usePluginBridge(): PluginBridgeState {
  return useStoreSelect(pluginStore, (value) => value);
}

export function usePluginComposerContributions(machineId: string): readonly QualifiedComposerContribution[] {
  usePluginBridge();
  return pluginRegistry().getComposerContributions(machineId);
}


export function usePluginThemes(): { themes: readonly QualifiedThemeContribution[]; pairs: readonly QualifiedThemePairContribution[] } {
  usePluginBridge();
  const instance = pluginRegistry();
  return { themes: instance.getThemes(), pairs: instance.getThemePairs() };
}






/** Load what this install ships, and, for a remote, what that machine lists. */
export async function loadPlugins(machineId: string): Promise<void> {
  const instance = pluginRegistry();
  pluginStore.update((current) => ({ ...current, machineId, loading: true }));
  const failures: string[] = [];
  const local = await loadExternalPlugins("pi-web-plugins/manifest.json", {
    shouldLoadPlugin: (entry) => !instance.hasPlugin(entry.id),
  }).catch((error: unknown) => {
    failures.push(describe(error));
    return undefined;
  });
  register(instance, local, failures);
  if (machineId !== "local" && !loadedMachines.has(machineId)) {
    const remote = await loadExternalPlugins(`api/machines/${encodeURIComponent(machineId)}/pi-web-plugins/manifest.json`, {
      machineId,
      shouldLoadPlugin: (entry) =>
        !instance.hasPlugin(machineScopedPluginId(machineId, entry.id)) && instance.shouldLoadRemotePlugin(entry.id, entry.machineSpecific),
    }).catch((error: unknown) => {
      failures.push(describe(error));
      return undefined;
    });
    register(instance, remote, failures);
    if (remote?.failures.length === 0) loadedMachines.add(machineId);
  }
  pluginStore.update((current) => ({ machineId, version: current.version + 1, loading: false, failures }));
  setPluginThemes(instance.getThemes(), instance.getThemePairs());
}

function register(instance: PluginRegistry, result: ExternalPluginLoadResult | undefined, failures: string[]): void {
  if (result === undefined) return;
  for (const failure of result.failures) {
    failures.push(`${failure.entry.id}: ${describe(failure.error)}`);
  }
  for (const registration of result.registrations) {
    if (instance.hasPlugin(registration.id)) continue;
    try {
      instance.register(registration);
    } catch (error) {
      failures.push(`${registration.id}: ${describe(error)}`);
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Presents a plugin's `showDialog` request in the shell's modal layer. */
export function PluginDialogLayer(): ReactNode {
  const snapshot = useStoreSelect(dialogStore, (value) => value);
  const active = snapshot.dialogs[snapshot.dialogs.length - 1];
  useEffect(() => {
    document.body.style.overflow = snapshot.dialogs.length > 0 ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [snapshot.dialogs.length]);
  if (active === undefined) return null;
  return (
    <Dialog
      onClose={() => { dismiss(active); }}
      open={true}
      size={active.presentation === "alert" ? "compact" : active.presentation === "fullscreen" ? "full" : "wide"}
      title={active.label}
    >
      <PluginDialogContent content={active.content} />
    </Dialog>
  );
}

function PluginDialogContent({ content }: { content: PluginDialog["content"] }): ReactNode {
  const host = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const element = host.current;
    if (element === null) return;
    render(content, element);
    return () => {
      render(nothing, element);
    };
  }, [content]);
  return <div ref={host} />;
}
