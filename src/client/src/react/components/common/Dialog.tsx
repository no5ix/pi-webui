import { useEffect, useRef, useState, type SyntheticEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./icons";

/**
 * A modal layer that the browser Back gesture consumes before it leaves the app.
 *
 * PI WEB pushes a placeholder history frame when a layer opens (the same rule the
 * Lit shell follows), so Back closes the top layer rather than navigating away,
 * and a layer that is closed by any other means removes its own frame.
 */
export interface DialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: "compact" | "wide" | "full";
  testId?: string;
}

export function Dialog(props: DialogProps): ReactNode {
  const panel = useRef<HTMLDivElement | null>(null);

  useLayerFrame(props.open, props.onClose);
  useLayerMechanics(props.open, panel, props.onClose);

  if (!props.open) return null;
  const width = props.size === "compact" ? "min(420px, 92vw)" : props.size === "full" ? "min(1180px, 94vw)" : "min(760px, 94vw)";
  return createPortal(
    <div className="piw-dialog-scrim" data-testid={props.testId === undefined ? undefined : `${props.testId}-scrim`} onMouseDown={() => { props.onClose(); }}>
      <div
        aria-label={props.title}
        aria-modal="true"
        className="piw-dialog"
        onMouseDown={(event) => { event.stopPropagation(); }}
        ref={panel}
        role="dialog"
        style={{ width, maxWidth: "94vw", maxHeight: "86vh" }}
      >
        <header className="piw-dialog__header">
          <h2 className="piw-dialog__title">{props.title}</h2>
          <button aria-label="Close" className="piw-icon-button" onClick={() => { props.onClose(); }} type="button">
            <Icon label="" name="close" />
          </button>
        </header>
        <div className="piw-dialog__body">{props.children}</div>
        {props.footer === undefined ? null : <footer className="piw-dialog__footer">{props.footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

export interface InputDialogProps {
  open: boolean;
  title: string;
  label: string;
  confirmLabel: string;
  placeholder?: string | undefined;
  initialValue?: string | undefined;
  problem?: string | undefined;
  onSubmit: (value: string) => void;
  onClose: () => void;
}

/**
 * A one-field ask: a session name, a project name, a machine name.
 *
 * The shell's rename commands need the same dialog the rail's menus use, so the
 * command, the header control and the menu row all open this one surface, and the
 * value travels to the same operation.
 */
export function InputDialog(props: InputDialogProps): ReactNode {
  const [value, setValue] = useState(props.initialValue ?? "");
  const trimmed = value.trim();
  const submit = (): void => {
    if (trimmed === "") return;
    props.onSubmit(trimmed);
    props.onClose();
  };
  const onSubmitForm = (event: SyntheticEvent<HTMLFormElement>): void => {
    event.preventDefault();
    submit();
  };
  return (
    <Dialog
      onClose={props.onClose}
      open={props.open}
      size="compact"
      title={props.title}
      footer={
        <>
          <button className="piw-button" onClick={props.onClose} type="button">
            Cancel
          </button>
          <button className="piw-button piw-button--primary" disabled={trimmed === ""} onClick={submit} type="button">
            {props.confirmLabel}
          </button>
        </>
      }
    >
      <form className="piw-field" onSubmit={onSubmitForm}>
        <label className="piw-field">
          <span className="piw-label">{props.label}</span>
          <input
            className="piw-input"
            onChange={(event) => { setValue(event.target.value); }}
            placeholder={props.placeholder}
            value={value}
          />
        </label>
        {props.problem === undefined ? null : <p className="piw-problem">{props.problem}</p>}
      </form>
    </Dialog>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog(props: ConfirmDialogProps): ReactNode {
  return (
    <Dialog
      onClose={() => { props.onClose(); }}
      open={props.open}
      size="compact"
      title={props.title}
      footer={
        <>
          <button className="piw-button" onClick={() => { props.onClose(); }} type="button">
            Cancel
          </button>
          <button
            className={props.danger === true ? "piw-button piw-button--danger" : "piw-button piw-button--primary"}
            onClick={() => {
              props.onConfirm();
              props.onClose();
            }}
            type="button"
          >
            {props.confirmLabel}
          </button>
        </>
      }
    >
      {props.body}
    </Dialog>
  );
}

const frameKey = "pi-web-react:layer";

function useLayerFrame(open: boolean, onClose: () => void): void {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const state = { [frameKey]: true };
    window.history.pushState(state, "", window.location.href);
    const onPopState = (event: PopStateEvent): void => {
      const state: unknown = event.state;
      if (state !== null && typeof state === "object" && frameKey in state) return;
      close.current();
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      const current: unknown = window.history.state;
      if (current !== null && typeof current === "object" && frameKey in current) window.history.back();
    };
  }, [open]);
}

function useLayerMechanics(open: boolean, panel: React.RefObject<HTMLDivElement | null>, onClose: () => void): void {
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const target = panel.current;
    target?.querySelector<HTMLElement>("input, textarea, select, button, [tabindex]")?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = focusableWithin(target);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === target)) {
        event.preventDefault();
        last?.focus();
        return;
      }
      if (!event.shiftKey && active === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose, open, panel]);
}

function focusableWithin(root: HTMLElement | null): HTMLElement[] {
  if (root === null) return [];
  const selector = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";
  return [...root.querySelectorAll<HTMLElement>(selector)].filter((element) => element.offsetParent !== null);
}
