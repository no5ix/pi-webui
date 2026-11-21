import { useCallback, useRef, useState } from "react";
import { ConfirmDialog } from "../ConfirmDialog";
import type { PluginConfirmRequest } from "../../plugins/types";

/** One confirmation a plugin asked for, with the promise that is waiting on the reader. */
export interface ReactPluginConfirmEntry {
  readonly id: number;
  readonly request: PluginConfirmRequest;
  readonly settle: (confirmed: boolean) => void;
}

export interface ReactPluginConfirmQueue {
  readonly entries: readonly ReactPluginConfirmEntry[];
  /** Ask the reader. The promise settles when the dialog closes, and false on any dismissal. */
  ask: (request: PluginConfirmRequest) => Promise<boolean>;
  /** Close one entry with the reader's answer. */
  settle: (id: number, confirmed: boolean) => void;
}

/**
 * The queue behind a plugin's `confirm`.
 *
 * A plugin's action is a promise: it wants to know whether the reader said yes before it deletes
 * something. The app's own confirm surface is a component that opens and closes, not a promise, so the
 * queue is what turns one into the other — an entry per request, a promise per entry, settled by the
 * dialog's key. A dismissal (Escape, backdrop, unmount) settles false: a plugin's destructive action
 * runs only on the key that confirms, which is the rule the built-in surfaces follow.
 */
export function usePluginReactConfirm(): ReactPluginConfirmQueue {
  const [entries, setEntries] = useState<readonly ReactPluginConfirmEntry[]>([]);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const sequence = useRef(0);

  const settle = useCallback((id: number, confirmed: boolean) => {
    const entry = entriesRef.current.find(candidate => candidate.id === id);
    entriesRef.current = entriesRef.current.filter(candidate => candidate.id !== id);
    setEntries(entriesRef.current);
    entry?.settle(confirmed);
  }, []);

  const ask = useCallback((request: PluginConfirmRequest) => {
    const id = ++sequence.current;
    let settleEntry: (confirmed: boolean) => void = () => undefined;
    const answer = new Promise<boolean>((resolve) => {
      settleEntry = resolve;
    });
    entriesRef.current = [...entriesRef.current, { id, request, settle: settleEntry }];
    setEntries(entriesRef.current);
    return answer;
  }, []);

  return { entries, ask, settle };
}

/**
 * One queued confirmation, on the app's own dialog.
 *
 * The top of the queue is drawn, so an action that asks twice in a row is answered one at a time, and
 * every entry below stays pending until the reader closes the one above it.
 */
export function PluginReactConfirmLayer({ queue }: { readonly queue: ReactPluginConfirmQueue }) {
  const top = queue.entries[queue.entries.length - 1];
  if (top === undefined) return null;
  const { request } = top;
  return (
    <ConfirmDialog
      open
      title={request.title}
      description={request.message}
      confirmLabel={request.confirmLabel}
      danger={request.tone === "danger"}
      onConfirm={() => queue.settle(top.id, true)}
      onCancel={() => queue.settle(top.id, false)}
    />
  );
}
