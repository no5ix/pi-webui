import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { request } from "../api/http";
import { piWebApi } from "../api";
import { corePlugin } from "../plugins/core";
import { loadExternalPlugins } from "../plugins/external";
import { PluginRegistry, type PluginFleetSource } from "../plugins/registry";
import { createPluginHostUi, type PluginDialogHost } from "../plugins/pluginHostUi";
import { createPluginReactHostUi } from "./plugins/pluginReactHostUi";
import { usePluginReactConfirm } from "./plugins/pluginReactConfirm";
import type { PluginDialog, PluginDialogHandle, PluginReactDialog, QualifiedContributionId } from "../plugins/types";

/**
 * A dialog a plugin opened.
 *
 * The kind is the host that draws it: a React contribution is rendered by the page's React, a Lit
 * template by the compatibility surface. One queue holds both, so a plugin that opens a dialog from
 * each gets the same stacking, focus and back-gesture accounting.
 */
export type ReactPluginDialogEntry =
  | { readonly kind: "lit"; readonly id: number; readonly dialog: PluginDialog; readonly close: () => void }
  | { readonly kind: "react"; readonly id: number; readonly dialog: PluginReactDialog; readonly close: () => void };

export interface ReactPluginRegistryState {
  readonly machineId: string;
  readonly registry: PluginRegistry;
  readonly failures: readonly string[];
  readonly revision: number;
}

export interface UsePluginRegistryOptions {
  readonly machineId: string;
  readonly openPage?: (pageId: QualifiedContributionId) => void;
  readonly fleet?: PluginFleetSource;
}

export function usePluginRegistry({ machineId, openPage, fleet }: UsePluginRegistryOptions) {
  const [snapshot, setSnapshot] = useState<ReactPluginRegistryState>();
  const [dialogs, setDialogs] = useState<readonly ReactPluginDialogEntry[]>([]);
  const dialogsRef = useRef(dialogs);
  dialogsRef.current = dialogs;
  const dialogSequence = useRef(0);
  const openPageRef = useRef(openPage);
  openPageRef.current = openPage;

  const closeDialog = useCallback((id: number) => {
    const entry = dialogsRef.current.find(dialog => dialog.id === id);
    if (entry === undefined) return;
    dialogsRef.current = dialogsRef.current.filter(dialog => dialog.id !== id);
    setDialogs(dialogsRef.current);
    try {
      entry.dialog.onClose?.();
    } catch (error) {
      console.error(`Plugin dialog ${entry.dialog.label} failed while closing`, error);
    }
  }, []);

  const showDialog = useCallback<PluginDialogHost["showDialog"]>(dialog => {
    const id = ++dialogSequence.current;
    const close = () => { closeDialog(id); };
    dialogsRef.current = [...dialogsRef.current, { kind: "lit", id, dialog, close }];
    setDialogs(dialogsRef.current);
    return { close } satisfies PluginDialogHandle;
  }, [closeDialog]);

  const showReactDialog = useCallback((dialog: PluginReactDialog) => {
    const id = ++dialogSequence.current;
    const close = () => { closeDialog(id); };
    dialogsRef.current = [...dialogsRef.current, { kind: "react", id, dialog, close }];
    setDialogs(dialogsRef.current);
    return { close } satisfies PluginDialogHandle;
  }, [closeDialog]);

  const confirm = usePluginReactConfirm();
  const reactUi = useMemo(
    () => createPluginReactHostUi({ showDialog: showReactDialog, confirm: confirm.ask }),
    [showReactDialog, confirm.ask],
  );
  const reactUiRef = useRef(reactUi);
  reactUiRef.current = reactUi;

  const refresh = useCallback(() => {
    setSnapshot(current => current?.machineId === machineId ? { ...current, revision: current.revision + 1 } : current);
  }, [machineId]);

  useEffect(() => {
    let active = true;
    const registered = new Set<string>();
    const registry = new PluginRegistry({
      ui: createPluginHostUi({ showDialog }),
      reactUi: reactUiRef.current,
      readPiWebStatus: (targetMachineId) => piWebApi.piWebStatus(targetMachineId),
      openPage: pageId => openPageRef.current?.(pageId),
      ...(fleet === undefined ? {} : { fleet }),
      fetchJson: (path, init) => request<unknown>(path, value => value, {
        ...(init?.method === undefined ? {} : { method: init.method }),
        ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      }),
    });
    registry.register({ id: "core", plugin: corePlugin });
    registered.add("core");
    setSnapshot({ machineId, registry, failures: [], revision: 0 });

    const manifestPath = machineId === "local"
      ? "pi-web-plugins/manifest.json"
      : `api/machines/${encodeURIComponent(machineId)}/pi-web-plugins/manifest.json`;
    void loadExternalPlugins(manifestPath, { ...(machineId === "local" ? {} : { machineId }) }).then(result => {
      if (!active) return;
      const failures = result.failures.map(failure => `${failure.entry.id}: ${formatError(failure.error)}`);
      for (const registration of result.registrations) {
        try {
          registry.register(registration);
          registered.add(registration.id);
        } catch (error) {
          failures.push(`${registration.id}: ${formatError(error)}`);
        }
      }
      setSnapshot({ machineId, registry, failures, revision: 1 });
    }).catch((error: unknown) => {
      if (active) setSnapshot({ machineId, registry, failures: [formatError(error)], revision: 1 });
    });

    return () => {
      active = false;
      for (const entry of dialogsRef.current) entry.close();
      for (const pluginId of registered) registry.disposePlugin(pluginId);
    };
  }, [machineId, showDialog, fleet]);

  const current = snapshot?.machineId === machineId ? snapshot : undefined;
  return {
    registry: current?.registry,
    failures: current?.failures ?? [],
    revision: current?.revision ?? 0,
    dialogs,
    confirm,
    refresh,
  };
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
