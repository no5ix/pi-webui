import { useMemo } from "react";
import type { PluginRegistry } from "../../plugins/registry";
import type {
  QualifiedActivityNoteContribution,
  QualifiedCodeFenceRendererContribution,
  QualifiedComposerContribution,
  QualifiedGlobalPanelContribution,
  QualifiedListActionContribution,
  QualifiedListLabelContribution,
  QualifiedListSectionContribution,
  QualifiedMessageActionContribution,
  QualifiedMessageRendererContribution,
  QualifiedNavSectionContribution,
  QualifiedSettingsSectionContribution,
  QualifiedToolRendererContribution,
  QualifiedWorkspacePanelContribution,
  ListKind,
} from "../../plugins/types";

/**
 * What the machine on screen contributes, read once per contribution change.
 *
 * Every React host asks the same question — what does this machine's plugin set offer — and each host
 * answering it separately is how a family ends up read for the wrong machine, or read on every render.
 * The registry's reads are scoped by the machine it has selected, and the host's revision is the signal
 * that contributions changed, so this snapshot is rebuilt on those two and on nothing else.
 *
 * A family the host has not mounted yet is still listed here: the snapshot says what exists, and the
 * hosts that consume it are the ones that decide when to draw it.
 */
export interface ReactPluginContributionSnapshot {
  readonly settingsSections: readonly QualifiedSettingsSectionContribution[];
  readonly navSections: readonly QualifiedNavSectionContribution[];
  /**
   * The workspace panels a plugin registered, unscoped. A panel belongs to a workspace, and the registry
   * scopes it there (`boundWorkspacePanels`), because the scope is the workspace's own context — its
   * machine, its files, its host. The panel host asks for the binding; this list says panels exist.
   */
  readonly workspacePanels: readonly QualifiedWorkspacePanelContribution[];
  readonly globalPanels: readonly QualifiedGlobalPanelContribution[];
  readonly composer: readonly QualifiedComposerContribution[];
  readonly activityNotes: readonly QualifiedActivityNoteContribution[];
  readonly messageActions: readonly QualifiedMessageActionContribution[];
  /** A renderer for one fence language, absent when no plugin claims it. */
  findCodeFenceRenderer: (language: string) => QualifiedCodeFenceRendererContribution | undefined;
  /** A renderer for one tool call, absent when no plugin claims it. */
  findToolRenderer: (toolName: string) => QualifiedToolRendererContribution | undefined;
  /** A renderer for one custom message tag, absent when no plugin claims it. */
  findMessageRenderer: (tag: string) => QualifiedMessageRendererContribution | undefined;
  /** Content on every item of one Navigate list. */
  listLabels: (list: ListKind) => readonly QualifiedListLabelContribution[];
  /** Entries in every item's menu of one Navigate list. */
  listActions: (list: ListKind) => readonly QualifiedListActionContribution[];
  /** Sections of one Navigate list. */
  listSections: (list: ListKind) => readonly QualifiedListSectionContribution[];
}

export function usePluginContributions(
  registry: PluginRegistry | undefined,
  machineId: string,
  revision: number,
): ReactPluginContributionSnapshot {
  return useMemo(() => {
    if (registry === undefined) {
      // The machine's plugins are still loading: nothing is contributed, which is not the same claim as
      // "this machine has no plugins". A host that shows a plugin surface shows it empty for now.
      return {
        settingsSections: [],
        navSections: [],
        workspacePanels: [],
        globalPanels: [],
        composer: [],
        activityNotes: [],
        messageActions: [],
        findCodeFenceRenderer: () => undefined,
        findToolRenderer: () => undefined,
        findMessageRenderer: () => undefined,
        listLabels: () => [],
        listActions: () => [],
        listSections: () => [],
      };
    }
    return {
      settingsSections: registry.getSettingsSections(machineId),
      navSections: registry.getNavSections(machineId),
      workspacePanels: registry.getWorkspacePanels(),
      globalPanels: registry.getActiveGlobalPanels(machineId),
      composer: registry.getComposerContributions(machineId),
      activityNotes: registry.getActivityNotes(machineId),
      messageActions: registry.getMessageActions(machineId),
      findCodeFenceRenderer: (language) => registry.findCodeFenceRenderer(language, machineId),
      findToolRenderer: (toolName) => registry.findToolRenderer(toolName, machineId),
      findMessageRenderer: (tag) => registry.findMessageRenderer(tag, machineId),
      listLabels: (list) => registry.getListLabels(list, machineId),
      listActions: (list) => registry.getListActions(list, machineId),
      listSections: (list) => registry.getListSections(list, machineId),
    };
  }, [registry, machineId, revision]);
}
