import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useGit, gitWriteUnavailableReason, readGitStatus, selectGitDiff, gitFileGroup, gitFileDiffRequest, type GitScope, type GitStatusFile } from "../../state/gitStore";
import { Icon, IconButton } from "../common/icons";
import { registerShellCommands } from "../../state/shellCommands";
import { writeClipboardText } from "../../../clipboard";

/**
 * The Git tab.
 *
 * The branch, the counts, the changed files and a file's diff all come from the
 * Git plugin's backend, which is the same answer the Git panel reads. The write
 * operations are said as unavailable, in the plugin's own words, because PI WEB
 * has no endpoint for them: a control that cannot be honoured is not drawn.
 */
export interface GitPanelProps {
  scope: GitScope | undefined;
}

export function GitPanel(props: GitPanelProps): ReactNode {
  const git = useGit();
  const scope = props.scope;
  const [expanded, setExpanded] = useState<Record<string, true>>({});

  useEffect(() => {
    if (scope === undefined) return;
    void readGitStatus(scope);
  }, [scope?.machineId, scope?.projectId, scope?.workspaceId]);

  useEffect(() => {
    if (scope === undefined) return;
    const unsubscribe = registerShellCommands([
      { id: "git.refresh", title: "Refresh Git status", group: "Git", run: () => { void readGitStatus(scope); }},
      {
        id: "git.openDiff",
        title: "Open the diff of the first changed file",
        group: "Git",
        disabled: git.status.value?.files.length === 0 ? "No changed files" : undefined,
        run: () => {
          const file = git.status.value?.files[0];
          if (file === undefined) return;
          selectGitDiff(scope, gitFileDiffRequest(file));
        },
      },
    ]);
    return unsubscribe;
  }, [scope, git.status.value]);

  const groups = useMemo(() => {
    const staged: GitStatusFile[] = [];
    const unstaged: GitStatusFile[] = [];
    const untracked: GitStatusFile[] = [];
    for (const file of git.status.value?.files ?? []) {
      const group = gitFileGroup(file);
      if (group === "staged") staged.push(file);
      else if (group === "unstaged") unstaged.push(file);
      else untracked.push(file);
    }
    return { staged, unstaged, untracked };
  }, [git.status.value]);

  if (scope === undefined) return <p className="piw-empty">No workspace is chosen, so there is no Git state to read.</p>;
  if (git.status.phase === "loading") return <p className="piw-empty">Reading Git status…</p>;
  if (git.status.phase === "failed" || git.status.phase === "refused") {
    return <p className="piw-empty">{`Git status did not answer: ${git.status.error ?? "no reason given"}`}</p>;
  }
  const status = git.status.value;
  if (status === undefined) return <p className="piw-empty">Git status is unknown.</p>;
  if (!status.isGitRepo) return <p className="piw-empty">This workspace is not a Git repository.</p>;

  return (
    <div className="piw-git" data-testid="git-panel">
      <div className="piw-git__meta">
        <span className="piw-chip">
          <Icon label="" name="gitBranch" size="small" />
          {status.branch ?? "detached"}
        </span>
        {status.upstream === undefined ? null : <span className="piw-row__meta">{status.upstream}</span>}
        {status.ahead === undefined && status.behind === undefined ? null : (
          <span className="piw-row__meta">{`${String(status.ahead ?? 0)} ahead · ${String(status.behind ?? 0)} behind`}</span>
        )}
        <span className="piw-workbench__toolbar-spacer" />
        <IconButton icon="refresh" label="Refresh Git status" onClick={() => { void readGitStatus(scope); }} />
      </div>

      <div className="piw-git__files">
        <FileGroup files={groups.staged} label="Staged" scope={scope} expanded={expanded} setExpanded={setExpanded} />
        <FileGroup files={groups.unstaged} label="Unstaged" scope={scope} expanded={expanded} setExpanded={setExpanded} />
        <FileGroup files={groups.untracked} label="Untracked" scope={scope} expanded={expanded} setExpanded={setExpanded} />
        {(git.status.value?.files.length ?? 0) === 0 ? <p className="piw-empty">Nothing is changed in this workspace.</p> : null}
      </div>

      <GitDiff />

      <p className="piw-workbench__message">{gitWriteUnavailableReason}</p>
    </div>
  );
}

function FileGroup(props: {
  files: readonly GitStatusFile[];
  label: string;
  scope: GitScope;
  expanded: Record<string, true>;
  setExpanded: (set: (current: Record<string, true>) => Record<string, true>) => void;
}): ReactNode {
  if (props.files.length === 0) return null;
  return (
    <section>
      <h3 className="piw-label">{`${props.label} (${String(props.files.length)})`}</h3>
      <ul className="piw-git__files-list">
        {props.files.map((file) => {
          const request = gitFileDiffRequest(file);
          const key = `${request.path}|${String(request.staged)}`;
          return (
            <li key={key}>
              <div className="piw-git__row">
                <button
                  className="piw-row"
                  onClick={() => {
                    props.setExpanded((current) => ({ ...current, [key]: true }));
                    selectGitDiff(props.scope, request);
                  }}
                  type="button"
                >
                  <span className="piw-git__row-state">{gitFileStateWords(file)}</span>
                  <span className="piw-row__title piw-mono" dir="auto">{file.path}</span>
                </button>
                <IconButton icon="copy" label={`Copy path ${file.path}`} onClick={() => { void writeClipboardText(file.path); }} />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * The Git backend answers a file's state as words for the index and the working
 * tree. One word when both agree, and "index/working tree" when a file is, for
 * example, staged as modified and then edited again.
 */
function gitFileStateWords(file: GitStatusFile): string {
  return file.index === file.workingTree ? file.index : `${file.index}/${file.workingTree}`;
}

function GitDiff(): ReactNode {
  const git = useGit();
  const scroller = useRef<HTMLDivElement | null>(null);
  if (git.diff.phase === "loading") return <p className="piw-empty">Reading the diff…</p>;
  if (git.diff.phase === "failed") return <p className="piw-empty">{`The diff did not answer: ${git.diff.error ?? "no reason given"}`}</p>;
  const diff = git.diff.value;
  if (diff === undefined) return <p className="piw-empty">Choose a changed file to read its diff.</p>;
  return (
    <div className="piw-git__diff" ref={scroller}>
      <div className="piw-git__diff-header">
        <span className="piw-mono">{diff.path ?? "workspace"}</span>
        <span className="piw-row__meta">{diff.staged ? "staged" : "working tree"}</span>
        {diff.truncated ? <span className="piw-badge">truncated</span> : null}
      </div>
      {diff.diff.split("\n").map((line, index) => (
        <div className={`piw-git__diff-line ${diffClass(line)}`} key={`${String(index)}-${line.slice(0, 24)}`}>
          {line}
        </div>
      ))}
    </div>
  );
}

function diffClass(line: string): string {
  if (line.startsWith("+") && !line.startsWith("+++")) return "piw-git__diff-line--added";
  if (line.startsWith("-") && !line.startsWith("---")) return "piw-git__diff-line--removed";
  if (line.startsWith("@@")) return "piw-git__diff-line--hunk";
  if (line.startsWith("diff ") || line.startsWith("index ") || line.startsWith("+++") || line.startsWith("---")) return "piw-git__diff-line--meta";
  return "";
}
