/** The four tools the desktop workbench offers, in tab order. */export const WORKBENCH_KINDS = ["git", "files", "terminal", "goals"] as const;
export type WorkbenchKind = (typeof WORKBENCH_KINDS)[number];

/** A panel that can stand under a workbench tab. */
export interface WorkbenchPanel {
  readonly id: string;
  readonly localId: string;
  readonly title: string;
  readonly fronts?: string | undefined;
  /** The panel's own daemon calls; the app reads the Git tab's count through it. */
  readonly operations?: ((path: string, init?: RequestInit) => Promise<unknown>) | undefined;
};

/** The panel standing under each tab, when the machine has one. */
export type WorkbenchSlots = Partial<Record<WorkbenchKind, WorkbenchPanel>>;

/** One tab, as the strip draws it. */
export interface WorkbenchTab {
  kind: WorkbenchKind;
  label: string;
  selected: boolean;
  /** A tab with no panel under it is shown disabled, with the reason in its tooltip. */
  disabled: boolean;
  /** What the tab says under its name: the panel under it, or why there is none. */
  detail: string;
  /** A count the tab carries: the Git tab's changed files, and nothing else's. */
  badge: number | undefined;
};

const TAB_LABELS: Record<WorkbenchKind, string> = { git: "Git", files: "Files", terminal: "Terminal", goals: "Goals" };

/** Why a tab has nothing under it, in the words a reader acts on. */
export const WORKBENCH_UNAVAILABLE_MESSAGES: Record<WorkbenchKind, string> = {
  git: "No Git panel is registered for the selected project.",
  files: "No Files panel is available on this machine.",
  terminal: "No Terminal panel is available on this machine.",
  goals: "No Goals panel is registered for the selected project.",
};

/**
 * The panel list is by id, and two ids the host resolves are not inferable.
 *
 * Files and Terminal are slots: a plugin registers a panel and names the slot it
 * replaces, so the panel that stands under the tab is the host's route answer,
 * not a string this module can spell. The rest is matched by the panel's own
 * words, because a third-party panel's id is nobody's business - and a panel that
 * fronts a conversation surface (`session-changes`, `session-goal`) is that
 * conversation's view, not a repository or project tool.
 */
export function workbenchKindOfPanel(
  panel: WorkbenchPanel,
  resolved: { files?: string | undefined; terminal?: string | undefined } = {},
): WorkbenchKind | undefined {
  if (resolved.files !== undefined && panel.id === resolved.files) return "files";
  if (resolved.terminal !== undefined && panel.id === resolved.terminal) return "terminal";
  if (panel.fronts === "session-changes" || panel.fronts === "session-goal") return undefined;
  const haystack = `${panel.title} ${panel.localId} ${panel.id}`.toLowerCase();
  if (/\bgit\b|source control|version control/u.test(haystack)) return "git";
  if (/\bgoals?\b|project objectives/u.test(haystack)) return "goals";
  if (/\bterminals?\b/u.test(haystack)) return "terminal";
  if (/\bfiles?\b|file browser/u.test(haystack)) return "files";
  return undefined;
}

/**
 * The four tabs, in the order the strip draws them.
 *
 * All four are always in the strip. A tab whose panel is not registered is
 * disabled with the reason as its detail: the reference shows four named tools,
 * and a strip that silently shows three makes the reader hunt for the tool they
 * came to use. The selected tab is the panel the column is showing; when the
 * column shows something outside the four (a plugin page, a conversation view),
 * no tab is selected, and the strip does not pretend otherwise.
 */
export function workbenchTabs(
  slots: WorkbenchSlots,
  shownPanelId: string | undefined,
  gitBadge: number | undefined,
): WorkbenchTab[] {
  return WORKBENCH_KINDS.map((kind) => {
    const panel = slots[kind];
    return {
      kind,
      label: TAB_LABELS[kind],
      selected: panel !== undefined && panel.id === shownPanelId,
      disabled: panel === undefined,
      detail: panel === undefined ? WORKBENCH_UNAVAILABLE_MESSAGES[kind] : panel.title,
      badge: kind === "git" ? gitBadge : undefined,
    };
  });
}
