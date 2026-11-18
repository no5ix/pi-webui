import { useEffect, type ReactNode } from "react";
import { createStore, useStoreSelect } from "../../state/store";
import { Icon } from "./icons";

/**
 * The shell's notices.
 *
 * A notice is a fact the shell learned that the reader is not looking at: a
 * plugin failed to load, a stream fell behind, a machine said something. It is
 * dismissible, it names its source, and a blocking notice keeps its tone.
 */
export interface Toast {
  readonly id: number;
  readonly title: string;
  readonly body: string | undefined;
  readonly tone: "info" | "success" | "warning" | "error";
  readonly action: { label: string; run(): void } | undefined;
  readonly ttlMs: number | undefined;
}

const toastStore = createStore<{ readonly toasts: readonly Toast[]; readonly seq: number }>({ toasts: [], seq: 0 });

export function pushToast(toast: {
  title: string;
  body?: string;
  tone?: "info" | "success" | "warning" | "error";
  action?: { label: string; run(): void };
  ttlMs?: number;
}): void {
  const existing = toastStore.get().toasts.find((entry) => entry.title === toast.title && entry.body === (toast.body ?? undefined));
  if (existing !== undefined) return;
  toastStore.update((current) => ({
    seq: current.seq + 1,
    toasts: [
      ...current.toasts,
      {
        id: current.seq + 1,
        title: toast.title,
        body: toast.body,
        tone: toast.tone ?? "info",
        action: toast.action,
        ttlMs: toast.ttlMs,
      },
    ],
  }));
}

export function dismissToast(id: number): void {
  toastStore.update((current) => ({ ...current, toasts: current.toasts.filter((toast) => toast.id !== id) }));
}


export function useToasts(): readonly Toast[] {
  return useStoreSelect(toastStore, (value) => value.toasts);
}

export function Toasts(): ReactNode {
  const toasts = useToasts();
  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts
      .filter((toast) => toast.ttlMs !== undefined)
      .map((toast) => window.setTimeout(() => { dismissToast(toast.id); }, toast.ttlMs ?? 0));
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [toasts]);

  if (toasts.length === 0) return null;
  return (
    <div aria-live="polite" className="piw-toasts" data-testid="toasts">
      {toasts.map((toast) => (
        <div className={`piw-toast piw-toast--${toast.tone}`} key={toast.id} role="status">
          <Icon label="" name={toast.tone === "error" ? "rescue" : toast.tone === "warning" ? "info" : "check"} size="small" />
          <div className="piw-toast__text">
            <span className="piw-toast__title">{toast.title}</span>
            {toast.body === undefined ? null : <span className="piw-toast__body">{toast.body}</span>}
          </div>
          {toast.action === undefined ? null : (
            <button className="piw-toast__action" onClick={() => toast.action?.run()} type="button">
              {toast.action.label}
            </button>
          )}
          <button aria-label="Dismiss notice" className="piw-icon-button" onClick={() => { dismissToast(toast.id); }} type="button">
            <Icon label="" name="close" size="small" />
          </button>
        </div>
      ))}
    </div>
  );
}
