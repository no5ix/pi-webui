import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./icons";

/**
 * The shell's menu. A row is a real menuitem, the keyboard walks every enabled
 * row, and the menu never claims a command exists that it cannot run: a disabled
 * row states its reason.
 */
export interface ContextMenuItem {
  label: string;
  icon?: IconName;
  onSelect?: () => void;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
}

export interface ContextMenuProps {
  open: boolean;
  anchor: HTMLElement | DOMRect | null;
  items: readonly ContextMenuItem[];
  onClose: () => void;
}

interface Placement {
  top: number;
  left: number;
}

const menuGap = 4;
const viewportEdge = 8;

export function ContextMenu(props: ContextMenuProps): ReactNode {
  const surface = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(0);

  const selectable = useMemo(
    () => props.items.map((item, index) => ({ item, index })).filter((entry) => entry.item.separator !== true && entry.item.disabled !== true),
    [props.items],
  );

  useEffect(() => {
    if (!props.open) return;
    setActive(selectable.length === 0 ? 0 : 0);
    const opened = document.activeElement;
    surface.current?.focus();
    return () => {
      if (opened instanceof HTMLElement) opened.focus();
    };
  }, [props.open, selectable.length]);

  useEffect(() => {
    if (!props.open) return;
    const closeOnPointer = (event: PointerEvent): void => {
      const target = event.target;
      if (target instanceof Node && surface.current?.contains(target) === true) return;
      props.onClose();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.stopPropagation();
        props.onClose();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const count = Math.max(selectable.length, 1);
        const step = event.key === "ArrowDown" ? 1 : count - 1;
        const order = selectable.map((entry) => entry.index);
        const position = order.indexOf(active);
        const nextPosition = position < 0 ? 0 : (position + step) % count;
        const next = order[nextPosition];
        if (next !== undefined) setActive(next);
        return;
      }
      if (event.key === "Enter") {
        const entry = selectable.find((candidate) => candidate.index === active);
        if (entry === undefined) return;
        event.preventDefault();
        props.onClose();
        entry.item.onSelect?.();
      }
    };
    document.addEventListener("pointerdown", closeOnPointer, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointer, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [active, props, selectable]);

  if (!props.open) return null;

  const place = placeMenu(props.anchor);
  return createPortal(
    <div
      aria-label="Menu"
      className="piw-menu"
      data-testid="context-menu"
      ref={surface}
      role="menu"
      style={{ position: "fixed", top: `${String(place.top)}px`, left: `${String(place.left)}px` }}
      tabIndex={-1}
    >
      {props.items.map((item, index) =>
        item.separator === true ? (
          <div className="piw-menu__separator" key={`separator-${String(index)}`} role="separator" />
        ) : (
          <button
            aria-disabled={item.disabled === true}
            className={item.danger === true ? "piw-menu__item piw-menu__item--danger" : "piw-menu__item"}
            disabled={item.disabled === true}
            key={`${item.label}-${String(index)}`}
            onClick={() => {
              props.onClose();
              item.onSelect?.();
            }}
            onMouseEnter={() => { setActive(index); }}
            role="menuitem"
            title={item.disabled === true ? item.label : undefined}
            type="button"
          >
            {item.icon === undefined ? null : <Icon label="" name={item.icon} size="small" />}
            <span>{item.label}</span>
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}

function placeMenu(anchor: HTMLElement | DOMRect | null): Placement {
  const rect = anchorRect(anchor);
  const width = 240;
  const left = Math.min(Math.max(rect.left, viewportEdge), Math.max(viewportEdge, window.innerWidth - width - viewportEdge));
  const estimatedHeight = 220;
  const opensBelow = rect.bottom + estimatedHeight + menuGap < window.innerHeight;
  const top = opensBelow ? rect.bottom + menuGap : Math.max(viewportEdge, rect.top - estimatedHeight - menuGap);
  return { top, left };
}

function anchorRect(anchor: HTMLElement | DOMRect | null): DOMRect {
  if (anchor === null) return new DOMRect(window.innerWidth / 2, window.innerHeight / 2, 0, 0);
  if (anchor instanceof HTMLElement) return anchor.getBoundingClientRect();
  return anchor;
}


