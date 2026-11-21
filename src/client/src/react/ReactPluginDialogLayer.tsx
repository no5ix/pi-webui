import { useEffect, useLayoutEffect, useRef } from "react";
import { PluginSurface } from "./PluginSurface";
import { PluginReactSurface } from "./plugins/PluginReactSurface";
import type { ReactPluginDialogEntry } from "./usePluginRegistry";

export function ReactPluginDialogLayer({ entries }: { readonly entries: readonly ReactPluginDialogEntry[] }) {
  const restoreFocus = useRef<HTMLElement | undefined>(undefined);
  const previousCount = useRef(0);
  useLayoutEffect(() => {
    if (previousCount.current === 0 && entries.length > 0) {
      restoreFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    }
    if (previousCount.current > 0 && entries.length === 0) {
      restoreFocus.current?.focus();
      restoreFocus.current = undefined;
    }
    previousCount.current = entries.length;
  }, [entries.length]);
  useEffect(() => () => { restoreFocus.current?.focus(); }, []);
  const topDialogId = entries[entries.length - 1]?.id;
  return <>
    {entries.map(entry => <PluginDialogSurface key={entry.id} entry={entry} isTop={entry.id === topDialogId} />)}
  </>;
}

function PluginDialogSurface({ entry, isTop }: { readonly entry: ReactPluginDialogEntry; readonly isTop: boolean }) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const fullscreen = entry.dialog.presentation === "fullscreen";

  useEffect(() => {
    if (!isTop) return;
    const surface = surfaceRef.current;
    if (surface === null) return;
    const closeButton = surface.querySelector<HTMLButtonElement>("button[aria-label='Close plugin dialog']");
    closeButton?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !fullscreen) {
        event.preventDefault();
        entry.close();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = [...surface.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])")];
      if (controls.length === 0) {
        event.preventDefault();
        surface.focus();
        return;
      }
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [entry, fullscreen, isTop]);

  const className = entry.dialog.presentation === "fullscreen"
    ? "rw-plugin-dialog rw-plugin-dialog-fullscreen"
    : entry.dialog.presentation === "alert"
      ? "rw-plugin-dialog rw-plugin-dialog-alert"
      : "rw-plugin-dialog";

  return <div className="rw-plugin-dialog-backdrop" aria-hidden={!isTop} onMouseDown={event => {
    if (!isTop) return;
    if (!fullscreen && event.target === event.currentTarget) entry.close();
  }}>
    <section ref={surfaceRef} className={className} role="dialog" aria-modal={isTop ? "true" : undefined} aria-label={entry.dialog.label} tabIndex={-1}>
      <button className="rw-plugin-dialog-close" type="button" aria-label="Close plugin dialog" onClick={entry.close}>×</button>
      {entry.kind === "react"
        ? <PluginReactSurface contributionId={`dialog:${String(entry.id)}`} pluginLabel={entry.dialog.label} node={entry.dialog.content} />
        : <PluginSurface contribution={entry.dialog.content} pluginLabel={entry.dialog.label} />}
    </section>
  </div>;
}
