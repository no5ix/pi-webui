import "./git.css";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  addGitWorktree,
  gitFileDiffRequest,
  gitFileGroup,
  gitWriteUnavailableReason,
  readGitHistory,
  readGitStatus,
  selectGitCommit,
  selectGitDiff,
  useGit,
  type GitCommit,
  type GitScope,
  type GitStatusFile,
} from "../../state/gitStore";
import { formatMessageTimestamp } from "../../markdown/formatTimestamp";
import { Icon, IconButton } from "../common/icons";
import { registerShellCommands } from "../../state/shellCommands";
import { writeClipboardText } from "../../../clipboard";

/**
 * The Git tab.
 *
 * The branch, the counts, the changed files, the commit list and a patch all
 * come from the Git plugin's backend — the same five operations the plugin's own
 * panel reads. Staging, committing, fetching, pulling, pushing and switching
 * branches have no PI WEB endpoint, so they are named as unavailable in words:
 * a control that cannot be honoured is not drawn. `worktree-add` is the one
 * repository write the backend performs, and it is offered as a real form.
 */
export interface GitPanelProps {
  scope: GitScope | undefined;
}

type GitView = "changes" | "history";

function scopeKey(scope: GitScope): string {
  return `${scope.machineId}|${scope.projectId}|${scope.workspaceId}`;
}

export function GitPanel(props: GitPanelProps): ReactNode {
  const git = useGit();
  const scope = props.scope;
  const [expanded, setExpanded] = useState<Record<string, true>>({});
  const [view, setView] = useState<GitView>("changes");
  const historyRequested = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (scope === undefined) return;
    void readGitStatus(scope);
  }, [scope?.machineId, scope?.projectId, scope?.workspaceId]);

  useEffect(() => {
    if (scope === undefined || view !== "history") return;
    const key = scopeKey(scope);
    if (historyRequested.current === key) return;
    historyRequested.current = key;
    void readGitHistory(scope);
  }, [scope, view]);

  useEffect(() => {
    if (scope === undefined) return;
    const unsubscribe = registerShellCommands([
      {
        id: "git.refresh",
        title: "Refresh Git status",
        group: "Git",
        keywords: ["git", "status", "reload"],
        run: () => {
          void readGitStatus(scope);
          if (view === "history") historyRequested.current = undefined;
        },
      },
      {
        id: "git.history",
        title: "Show Git history",
        group: "Git",
        keywords: ["log", "commits", "history"],
        run: () => {
          setView("history");
          historyRequested.current = undefined;
          void readGitHistory(scope);
        },
      },
      {
        id: "git.openDiff",
        title: "Open the diff of the first changed file",
        group: "Git",
        keywords: ["diff", "changes"],
        disabled: git.status.value?.files.length === 0 ? "No changed files" : undefined,
        run: () => {
          const file = git.status.value?.files[0];
          if (file === undefined) return;
          setView("changes");
          selectGitDiff(scope, gitFileDiffRequest(file));
        },
      },
    ]);
    return unsubscribe;
  }, [scope, git.status.value, view]);

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
        <span className="piw-chip" title={status.branch ?? "detached"}>
          <Icon label="" name="gitBranch" size="small" />
          {status.branch ?? "detached"}
        </span>
        {status.upstream === undefined ? null : <span className="piw-row__meta" title={status.upstream}>{status.upstream}</span>}
        {status.ahead === undefined && status.behind === undefined ? null : (
          <span className="piw-row__meta">{`${String(status.ahead ?? 0)} ahead · ${String(status.behind ?? 0)} behind`}</span>
        )}
        <span className="piw-workbench__toolbar-spacer" />
        <IconButton icon="refresh" label="Refresh Git status" onClick={() => { void readGitStatus(scope); }} />
      </div>

      <div aria-label="Git view" className="piw-git__views" role="group">
        <button
          aria-pressed={view === "changes"}
          className={`piw-button ${view === "changes" ? "piw-button--primary" : ""}`}
          onClick={() => { setView("changes"); }}
          type="button"
        >
          {`Changes (${String(status.files.length)})`}
        </button>
        <button
          aria-pressed={view === "history"}
          className={`piw-button ${view === "history" ? "piw-button--primary" : ""}`}
          onClick={() => { setView("history"); }}
          type="button"
        >
          History
        </button>
      </div>

      {view === "changes"
        ? (
          <>
            <div className="piw-git__files">
              <FileGroup files={groups.staged} label="Staged" scope={scope} expanded={expanded} setExpanded={setExpanded} />
              <FileGroup files={groups.unstaged} label="Unstaged" scope={scope} expanded={expanded} setExpanded={setExpanded} />
              <FileGroup files={groups.untracked} label="Untracked" scope={scope} expanded={expanded} setExpanded={setExpanded} />
              {status.files.length === 0 ? <p className="piw-empty">Nothing is changed in this workspace.</p> : null}
            </div>
            <FileDiff />
            <p className="piw-workbench__message">{gitWriteUnavailableReason}</p>
          </>
        )
        : <GitHistory scope={scope} />}
    </div>
  );
}

/**
 * The commit list, one commit's patch, and the worktree write.
 *
 * History arrives a page at a time, so the list keeps the rows already read and
 * asks for the next page only when the reader asks for older commits.
 */
function GitHistory(props: { scope: GitScope }): ReactNode {
  const git = useGit();
  if (git.history.phase === "loading" && git.commits.length === 0) return <p className="piw-empty">Reading the commit history…</p>;
  if (git.history.phase === "failed" || git.history.phase === "refused") {
    return <p className="piw-empty">{`The commit history did not answer: ${git.history.error ?? "no reason given"}`}</p>;
  }
  if (git.history.phase === "idle") return <p className="piw-empty">The commit history has not been read.</p>;
  const unborn = git.history.value?.unborn === true;
  return (
    <>
      <div className="piw-git__files">
        {unborn && git.commits.length === 0 ? <p className="piw-empty">This repository has no commit yet.</p> : null}
        {!unborn && git.commits.length === 0 ? <p className="piw-empty">No commits to read for this branch.</p> : null}
        <ul className="piw-git__files-list">
          {git.commits.map((commit) => (
            <li key={commit.id}>
              <GitCommitRow commit={commit} scope={props.scope} selected={git.commitId === commit.id} />
            </li>
          ))}
        </ul>
        {git.history.value?.truncated === true && git.nextCursor === undefined ? (
          <p className="piw-row__meta">The plugin returned a truncated page.</p>
        ) : null}
        {git.nextCursor === undefined ? null : (
          <button
            className="piw-button"
            disabled={git.history.phase === "loading"}
            onClick={() => { void readGitHistory(props.scope, { append: true }); }}
            type="button"
          >
            Older commits
          </button>
        )}
      </div>
      <CommitDiff />
      <WorktreeForm scope={props.scope} />
    </>
  );
}

function GitCommitRow(props: { commit: GitCommit; scope: GitScope; selected: boolean }): ReactNode {
  const { commit, scope, selected } = props;
  const when = formatMessageTimestamp(commit.authoredAt);
  return (
    <button
      className={`piw-row ${selected ? "piw-row--selected" : ""}`}
      onClick={() => { selectGitCommit(scope, commit.id); }}
      type="button"
    >
      <span className="piw-row__title">{commit.subject === "" ? "(no subject)" : commit.subject}</span>
      <span className="piw-row__meta piw-mono">{commit.id.slice(0, 8)}</span>
      {when === undefined ? null : <span className="piw-row__meta">{when}</span>}
    </button>
  );
}

/**
 * Adding a linked worktree is the one write the Git backend performs, so the
 * form states what it creates: a branch, and a directory beside the repository
 * the machine will make.
 */
function WorktreeForm(props: { scope: GitScope }): ReactNode {
  const git = useGit();
  const [branch, setBranch] = useState("");
  const [path, setPath] = useState("");
  const [createBranch, setCreateBranch] = useState(true);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const busy = git.worktree.phase === "loading";

  const submit = () => {
    const trimmedBranch = branch.trim();
    const trimmedPath = path.trim();
    if (trimmedBranch === "") {
      setMessage("Name the branch to create or check out.");
      return;
    }
    if (!trimmedPath.startsWith("/")) {
      setMessage("The path must be absolute on the machine.");
      return;
    }
    setMessage(undefined);
    void addGitWorktree(props.scope, { branch: trimmedBranch, path: trimmedPath, createBranch }).then((reason) => {
      setMessage(reason);
    });
  };

  return (
    <form
      className="piw-git__worktree"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <h3 className="piw-label">New linked worktree</h3>
      <label className="piw-field">
        <span className="piw-label">Branch</span>
        <input
          className="piw-input"
          onChange={(event) => { setBranch(event.currentTarget.value); }}
          placeholder="feature/git-worktrees"
          value={branch}
        />
      </label>
      <label className="piw-field">
        <span className="piw-label">Directory on the machine</span>
        <input
          className="piw-input"
          onChange={(event) => { setPath(event.currentTarget.value); }}
          placeholder="/absolute/path/to/worktree"
          value={path}
        />
      </label>
      <label className="piw-checkbox">
        <input
          checked={createBranch}
          onChange={(event) => { setCreateBranch(event.currentTarget.checked); }}
          type="checkbox"
        />
        <span>Create the branch</span>
      </label>
      <div className="piw-git__worktree-actions">
        <button className="piw-button piw-button--primary" disabled={busy} type="submit">
          {busy ? "Creating…" : "Create worktree"}
        </button>
      </div>
      {message === undefined ? null : <p className="piw-workbench__message">{message}</p>}
      {git.worktree.phase === "ready" && git.worktree.value !== undefined ? (
        <p className="piw-workbench__message">{`Created ${git.worktree.value.branch} in ${git.worktree.value.path}`}</p>
      ) : null}
    </form>
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

function FileDiff(): ReactNode {
  const git = useGit();
  if (git.diff.phase === "loading") return <p className="piw-empty">Reading the diff…</p>;
  if (git.diff.phase === "failed") return <p className="piw-empty">{`The diff did not answer: ${git.diff.error ?? "no reason given"}`}</p>;
  const diff = git.diff.value;
  if (diff === undefined) return <p className="piw-empty">Choose a changed file to read its diff.</p>;
  return (
    <DiffBody
      header={(
        <>
          <span className="piw-mono">{diff.path ?? "workspace"}</span>
          <span className="piw-row__meta">{diff.staged ? "staged" : "working tree"}</span>
        </>
      )}
      lines={diff.diff}
      truncated={diff.truncated}
    />
  );
}

function CommitDiff(): ReactNode {
  const git = useGit();
  if (git.commitId === undefined) return <p className="piw-empty">Choose a commit to read its patch.</p>;
  if (git.commitDiff.phase === "loading") return <p className="piw-empty">Reading the commit patch…</p>;
  if (git.commitDiff.phase === "failed") return <p className="piw-empty">{`The commit patch did not answer: ${git.commitDiff.error ?? "no reason given"}`}</p>;
  const commitDiff = git.commitDiff.value;
  if (commitDiff === undefined) return <p className="piw-empty">This commit has no patch to read.</p>;
  return (
    <DiffBody
      header={(
        <>
          <span className="piw-mono">{commitDiff.commit.id.slice(0, 8)}</span>
          <span>{commitDiff.commit.subject}</span>
          {commitDiff.combined ? <span className="piw-badge">merge</span> : null}
        </>
      )}
      lines={commitDiff.diff}
      truncated={commitDiff.truncated}
    />
  );
}

function DiffBody(props: { header: ReactNode; lines: string; truncated: boolean }): ReactNode {
  return (
    <div className="piw-git__diff">
      <div className="piw-git__diff-header">
        {props.header}
        {props.truncated ? <span className="piw-badge">truncated</span> : null}
      </div>
      {props.lines.split("\n").map((line, index) => (
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
