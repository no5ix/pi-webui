import { useEffect, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import type { Project, SessionInfo, SessionRef, Workspace } from "../../../../../shared/apiTypes";
import { setWorkbenchTab, usePanels, type WorkbenchTab } from "../../state/panels";
import { useGit, readGitStatus, type GitScope } from "../../state/gitStore";
import { Icon, type IconName } from "../common/icons";
import { GitPanel } from "./GitPanel";
import { FilesPanel } from "./FilesPanel";
import { TerminalPanel } from "./TerminalPanel";
import { GoalsPanel } from "./GoalsPanel";
import "./workbench.css";

/**
 * The right column.
 *
 * Four tabs over one workspace: Git, Files, Terminal, Goals. The tab the reader
 * chose is the shell's state, so the ⌘1–4 chords and a reload land on the same
 * tab. A tab with no workspace to act on says which scope is missing instead of
 * drawing controls that would answer nothing.
 */
export interface WorkbenchPanelProps {
  machineId: string;
  subject: {
    machineId: string;
    project: Project | undefined;
    workspace: Workspace | undefined;
    session: SessionRef | undefined;
    sessionInfo: SessionInfo | undefined;
  };
}

const tabs: readonly { tab: WorkbenchTab; label: string; icon: IconName; chord: string }[] = [
  { tab: "git", label: "Git", icon: "gitBranch", chord: "⌘1" },
  { tab: "files", label: "Files", icon: "file", chord: "⌘2" },
  { tab: "terminal", label: "Terminal", icon: "terminal", chord: "⌘3" },
  { tab: "goals", label: "Goals", icon: "goals", chord: "⌘4" },
];

export function WorkbenchPanel(props: WorkbenchPanelProps): ReactNode {
  const panels = usePanels();
  const git = useGit();
  const { project, workspace } = props.subject;
  const scope = project === undefined || workspace === undefined ? undefined : { machineId: props.machineId, projectId: project.id, workspaceId: workspace.id };

  useEffect(() => {
    if (scope === undefined) return;
    void readGitStatus(scope);
  }, [scope?.machineId, scope?.projectId, scope?.workspaceId]);

  const changed = git.status.value?.files.length;

  const moveTab = (delta: number): void => {
    const index = tabs.findIndex((entry) => entry.tab === panels.workbenchTab);
    const next = tabs[(index + delta + tabs.length) % tabs.length];
    if (next !== undefined) setWorkbenchTab(next.tab);
  };

  return (
    <div className="piw-workbench" data-testid="workbench" id="workspace-panel">
      <nav
        aria-label="Workbench"
        className="piw-workbench__tabs"
        onKeyDown={(event: ReactKeyboardEvent<HTMLElement>) => {
          if (event.key === "ArrowRight") {
            event.preventDefault();
            moveTab(1);
          } else if (event.key === "ArrowLeft") {
            event.preventDefault();
            moveTab(-1);
          }
        }}
        role="tablist"
      >
        {tabs.map((entry) => (
          <button
            aria-controls="workspace-panel-body"
            aria-selected={panels.workbenchTab === entry.tab}
            className={panels.workbenchTab === entry.tab ? "piw-tab piw-tab--selected" : "piw-tab"}
            id={`piw-tab-${entry.tab}`}
            key={entry.tab}
            onClick={() => { setWorkbenchTab(entry.tab); }}
            role="tab"
            tabIndex={panels.workbenchTab === entry.tab ? 0 : -1}
            title={`${entry.label} ${entry.chord}`}
            type="button"
          >
            <Icon label="" name={entry.icon} size="small" />
            <span>{entry.label}</span>
            {entry.tab === "git" && changed !== undefined && changed > 0 ? <span className="piw-badge">{String(changed)}</span> : null}
          </button>
        ))}
      </nav>

      <div className="piw-workbench__body" id="workspace-panel-body" role="tabpanel" tabIndex={0}>
        {scope === undefined ? (
          <p className="piw-empty">{workspace === undefined ? "No workspace is chosen. The workbench acts on a workspace." : "The project of this workspace is unknown."}</p>
        ) : panels.workbenchTab === "git" ? (
          <GitPanel scope={scope} />
        ) : panels.workbenchTab === "files" ? (
          <FilesPanel scope={scope} />
        ) : panels.workbenchTab === "terminal" ? (
          <TerminalPanel scope={scope} />
        ) : panels.workbenchTab === "goals" && workspace !== undefined ? (
          <GoalsPanel scope={{ ...scope, workspacePath: workspace.path }} />
        ) : (
          <p className="piw-empty">Goals read the workspace on disk, and this workspace has no path to read.</p>
        )}
      </div>
    </div>
  );
}

export type { GitScope };
