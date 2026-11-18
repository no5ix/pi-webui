import type { ContextMenuItem } from "../common/ContextMenu";

/**
 * The row context menus, as data.
 *
 * A menu is a decision list, so it is built by one pure function per row kind:
 * the facts of the row say what is possible, the actions say what happens. The
 * panel keeps the actions dumb, and an unavailable action states itself
 * (a session with no parent cannot detach from one, an archived session is not
 * archived again) instead of vanishing, so the menu reads the same from both
 * places it opens — the right-click and the row's own kebab button.
 */

export interface ProjectMenuFacts {
  readonly pinned: boolean;
  readonly showArchived: boolean;
}

export interface ProjectMenuActions {
  onNewSession: () => void;
  onRename: () => void;
  onTogglePin: () => void;
  onToggleArchived: () => void;
  onClose: () => void;
}

export function projectMenuItems(facts: ProjectMenuFacts, actions: ProjectMenuActions): ContextMenuItem[] {
  return [
    { label: "New session", icon: "plus", onSelect: actions.onNewSession },
    { label: "Rename project", icon: "edit", onSelect: actions.onRename },
    { label: facts.pinned ? "Unpin project" : "Pin project", icon: "pin", onSelect: actions.onTogglePin },
    { label: facts.showArchived ? "Hide archived sessions" : "Show archived sessions", icon: "archive", onSelect: actions.onToggleArchived },
    { label: "Close project", icon: "close", danger: true, onSelect: actions.onClose },
  ];
}

export interface SessionMenuFacts {
  readonly pinned: boolean;
  readonly archived: boolean;
  readonly hasParent: boolean;
}

export interface SessionMenuActions {
  onOpen: () => void;
  onRename: () => void;
  onTogglePin: () => void;
  onContinueInNewSession: () => void;
  onDetachParent: () => void;
  onCopyPath: () => void;
  onArchive: () => void;
  onArchiveWithDescendants: () => void;
}

export function sessionMenuItems(facts: SessionMenuFacts, actions: SessionMenuActions): ContextMenuItem[] {
  const archive = facts.archived ? { disabled: true } : {};
  return [
    { label: "Open", icon: "play", onSelect: actions.onOpen },
    { label: "Rename session", icon: "edit", onSelect: actions.onRename },
    { label: facts.pinned ? "Unpin session" : "Pin session", icon: "pin", onSelect: actions.onTogglePin },
    { label: "Continue in new session", icon: "gitBranch", onSelect: actions.onContinueInNewSession },
    { label: "Detach parent", icon: "layers", onSelect: actions.onDetachParent, ...(facts.hasParent ? {} : { disabled: true }) },
    { label: "Copy path", icon: "copy", onSelect: actions.onCopyPath },
    { label: "Archive", icon: "archive", danger: true, onSelect: actions.onArchive, ...archive },
    { label: "Archive with descendants", icon: "archive", danger: true, onSelect: actions.onArchiveWithDescendants, ...archive },
  ];
}
