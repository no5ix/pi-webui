import { useRef, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import type { Project } from "../../../../../shared/apiTypes";
import { sessionLabel } from "../../../sessionLabels";
import { modifiedMs } from "../../../sessionOrder";
import { Icon, IconButton } from "../common/icons";
import { relativeTime, type SessionRowFacts } from "./navigationModel";

/**
 * The rail's rows.
 *
 * A row is a real button so it is reachable by keyboard and by a screen reader,
 * and its kebab menu is a second button beside it rather than a control nested
 * inside it. The row states what the machine said: the state dot is the live
 * activity, the unread marker is the daemon's unread catalog, a missing project
 * folder is said in words, and a session that has no title yet is named by the
 * label the rest of the product uses.
 */

export interface SessionRowProps {
  facts: SessionRowFacts;
  nowMs: number;
  /** Search results say which workspace path a session was found by. */
  showPath: boolean;
  onOpen: () => void;
  onMenu: (anchor: DOMRect) => void;
}

export function SessionRow(props: SessionRowProps): ReactNode {
  const { facts, nowMs, showPath, onOpen, onMenu } = props;
  const title = sessionLabel(facts.session);
  const stateClass = facts.running ? "piw-dot piw-dot--working" : facts.activity?.phase === "error" ? "piw-dot piw-dot--error" : "piw-dot";
  const classes = showPath && facts.workspace !== undefined ? "piw-row piw-navigation__session" : "piw-row";
  return (
    <li className="piw-navigation__row">
      <button
        aria-current={facts.selected ? "true" : undefined}
        aria-label={`Open session ${title}`}
        className={facts.selected ? "piw-row piw-row--selected" : classes}
        onClick={onOpen}
        onContextMenu={(event: ReactMouseEvent<HTMLButtonElement>) => {
          event.preventDefault();
          onMenu(event.currentTarget.getBoundingClientRect());
        }}
        title={`${title}\n${facts.session.cwd}`}
        type="button"
      >
        <span aria-hidden="true" className={stateClass} />
        <span className="piw-row__title" dir="auto">{title}</span>
        {facts.unread === undefined ? null : <span aria-label="Unread" className="piw-dot piw-dot--unread" role="status" title="Finished while you were away" />}
        {showPath ? <span className="piw-navigation__path">{facts.session.cwd}</span> : null}
        <span className="piw-navigation__time">{relativeTime(modifiedMs(facts.session.modified), nowMs)}</span>
      </button>
      <RowMenuButton label={`Menu for session ${title}`} onMenu={onMenu} />
    </li>
  );
}

export interface ProjectRowProps {
  project: Project;
  expanded: boolean;
  sessionCount: number;
  pinned: boolean;
  onToggle: () => void;
  onMenu: (anchor: DOMRect) => void;
}

export function ProjectRow(props: ProjectRowProps): ReactNode {
  const { project, expanded, sessionCount, pinned, onToggle, onMenu } = props;
  return (
    <div className="piw-navigation__row piw-navigation__project">
      <button
        aria-expanded={expanded}
        aria-label={`${expanded ? "Collapse" : "Expand"} project ${project.name}`}
        className="piw-row"
        onClick={onToggle}
        onContextMenu={(event: ReactMouseEvent<HTMLButtonElement>) => {
          event.preventDefault();
          onMenu(event.currentTarget.getBoundingClientRect());
        }}
        title={project.path}
        type="button"
      >
        <Icon className="piw-navigation__project-icon" name={expanded ? "folderOpen" : "folder"} />
        <Icon className="piw-navigation__chevron" name={expanded ? "chevronDown" : "chevronRight"} size="small" />
        <span className="piw-row__title" dir="auto">{project.name}</span>
        {project.folderMissing === true ? <span className="piw-navigation__missing">folder missing</span> : null}
        {pinned ? <Icon label="Pinned project" name="pin" size="small" /> : null}
        {sessionCount === 0 ? null : <span className="piw-navigation__time">{String(sessionCount)}</span>}
      </button>
      <RowMenuButton label={`Menu for project ${project.name}`} onMenu={onMenu} />
    </div>
  );
}

export interface StartingRowProps {
  label: string;
  problem: string | undefined;
  onRetry: () => void;
}

/** A session this browser asked for and the machine has not answered with yet. */
export function StartingRow(props: StartingRowProps): ReactNode {
  const { label, problem, onRetry } = props;
  const dotClass = problem === undefined ? "piw-dot piw-dot--working" : "piw-dot piw-dot--error";
  return (
    <li className="piw-navigation__row">
      <div className="piw-row piw-navigation__status" role="status">
        <span aria-hidden="true" className={dotClass} />
        <span className="piw-row__title" dir="auto">{problem === undefined ? label : `${label}: ${problem}`}</span>
      </div>
      {problem === undefined ? null : <IconButton icon="refresh" label={`Start again: ${label}`} onClick={onRetry} />}
    </li>
  );
}

export interface ShowMoreRowProps {
  hiddenCount: number;
  onShow: () => void;
}

export function ShowMoreRow(props: ShowMoreRowProps): ReactNode {
  return (
    <li className="piw-navigation__row">
      <button className="piw-row piw-navigation__show-more" onClick={props.onShow} type="button">
        <span className="piw-row__title">{`Show ${String(props.hiddenCount)} more`}</span>
      </button>
    </li>
  );
}

function RowMenuButton(props: { label: string; onMenu(anchor: DOMRect): void }): ReactNode {
  const trigger = useRef<HTMLSpanElement | null>(null);
  const open = (): void => {
    const element = trigger.current;
    if (element === null) return;
    props.onMenu(element.getBoundingClientRect());
  };
  return (
    <span ref={trigger}>
      <IconButton className="piw-navigation__kebab" icon="more" label={props.label} onClick={open} />
    </span>
  );
}
