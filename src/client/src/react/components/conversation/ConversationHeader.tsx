import { useRef, useState, type ReactNode } from "react";
import { sessionsApi } from "../../../api";
import { isSessionActive } from "../../../../../shared/activity";
import type { SessionActivity, SessionInfo, SessionRef, SessionStatus } from "../../../../../shared/apiTypes";
import { Icon, IconButton } from "../common/icons";
import { ContextMenu, type ContextMenuItem } from "../common/ContextMenu";
import { LitBoundary } from "../common/LitBoundary";
import type { TranscriptWidth } from "../../state/conversationStore";
import { writeClipboardText } from "../../../clipboard";
import { boardRuntime } from "../../state/board";

/**
 * The conversation's title row.
 *
 * It states what is open, what the machine says it is doing, and every action
 * that acts on this session. An action the machine refuses answers with its
 * reason in the row's own live region.
 */
export interface ConversationHeaderProps {
  machineId: string;
  session: SessionRef | undefined;
  sessionInfo: SessionInfo | undefined;
  projectName: string | undefined;
  status: SessionStatus | undefined;
  activity: SessionActivity | undefined;
  width: TranscriptWidth;
  onToggleWidth: () => void;
  onOpenSettings: () => void;
}

export function ConversationHeader(props: ConversationHeaderProps): ReactNode {
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const more = useRef<HTMLButtonElement | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const { session, machineId, status, activity } = props;
  const title = props.sessionInfo?.name ?? props.sessionInfo?.firstMessage ?? "No session open";
  const running = isSessionActive(status, activity);
  const words = activity?.label ?? (running ? "Working" : status === undefined ? "Unknown" : "Idle");
  const fail = (label: string) => (error: unknown) => {
    setNotice(`${label}: ${error instanceof Error ? error.message : String(error)}`);
  };

  return (
    <header className="piw-panel__header piw-conversation__header">
      <div className="piw-conversation__heading">
        <h1 className="piw-conversation__title" title={title}>{title}</h1>
        <div className="piw-conversation__meta">
          <span className={`piw-dot ${running ? "piw-dot--working" : ""}`} />
          <span>{words}</span>
          {props.projectName === undefined ? null : <span className="piw-conversation__project">{props.projectName}</span>}
        </div>
      </div>
      <span className="piw-panel__spacer" />
      <span aria-live="polite" className="piw-visually-hidden">{notice ?? ""}</span>
      {running && session !== undefined ? (
        <IconButton
          icon="square"
          label="Stop the running turn"
          onClick={() => {
            void sessionsApi.abort(session, machineId).then(() => undefined, fail("Stop"));
          }}
        />
      ) : null}
      {session !== undefined ? (
        <IconButton
          icon="refresh"
          label="Reload the session"
          onClick={() => {
            void sessionsApi.reloadSession(session, machineId).then(() => undefined, fail("Reload"));
          }}
        />
      ) : null}
      {props.sessionInfo !== undefined ? (
        <IconButton icon="edit" label="Rename this session" onClick={() => { setRenaming(true); }} />
      ) : null}
      <button aria-label="Session actions" className="piw-icon-button" onClick={() => { setMenuAnchor(more.current); }} ref={more} title="Session actions" type="button">
        <Icon label="" name="more" />
      </button>
      <IconButton
        icon={props.width === "wide" ? "panelRight" : "panelLeft"}
        label={props.width === "wide" ? "Use the reading measure" : "Use the full width"}
        onClick={props.onToggleWidth}
      />
      <IconButton icon="gear" label="Settings" onClick={() => { props.onOpenSettings(); }} />
      <ContextMenu
        anchor={menuAnchor}
        items={sessionActions(props, () => { setRenaming(true); }, setNotice)}
        onClose={() => { setMenuAnchor(null); }}
        open={menuAnchor !== null}
      />
      {renaming && props.sessionInfo !== undefined ? (
        <LitBoundary
          events={{ cancel: () => { setRenaming(false); }}}
          properties={{
            currentName: props.sessionInfo.name ?? "",
            subject: "session",
            onSubmit: (name: string) => rename(props, name, () => { setRenaming(false); }, setNotice),
            onCancel: () => { setRenaming(false); },
          }}
          tag="session-rename-dialog"
        />
      ) : null}
    </header>
  );
}

function sessionActions(
  props: ConversationHeaderProps,
  onRename: () => void,
  notify: (message: string | undefined) => void,
): ContextMenuItem[] {
  const { session, machineId, status } = props;
  if (session === undefined) return [];
  const run = (label: string, call: () => Promise<unknown>): (() => void) => () => {
    void call().then(
      () => { notify(undefined); },
      (error: unknown) => { notify(`${label}: ${error instanceof Error ? error.message : String(error)}`); },
    );
  };
  const items: ContextMenuItem[] = [
    { label: "Rename", icon: "edit", onSelect: onRename },
    { label: "Copy session id", icon: "copy", onSelect: () => { void writeClipboardText(session.id); }},
    { label: "Copy working directory", icon: "copy", onSelect: () => { void writeClipboardText(session.cwd); }},
  ];
  if (status?.queuedMessages.length !== undefined && status.queuedMessages.length > 0) {
    items.push({ label: "Clear queued prompts", icon: "queue", onSelect: run("Clear queue", () => sessionsApi.clearQueue(session, machineId)) });
  }
  items.push({ label: "Continue in a new session", icon: "play", onSelect: run("Continue", () => sessionsApi.continueInNewSession(session, machineId)) });
  items.push({ label: "Detach from parent", icon: "gitBranch", onSelect: run("Detach", () => sessionsApi.detachParent(session, machineId)) });
  items.push({ separator: true, label: "" });
  items.push({ danger: true, label: "Archive", icon: "archive", onSelect: run("Archive", () => sessionsApi.archive(session, machineId)) });
  items.push({ danger: true, label: "Archive with descendants", icon: "archive", onSelect: run("Archive tree", () => sessionsApi.archiveWithDescendants(session, machineId)) });
  return items;
}

async function rename(props: ConversationHeaderProps, name: string, close: () => void, notify: (message: string | undefined) => void): Promise<void> {
  const { session, machineId } = props;
  const trimmed = name.trim();
  if (session === undefined || trimmed === "") return;
  try {
    await sessionsApi.runCommand(session, `/name ${trimmed}`, machineId);
    void boardRuntime.read({ force: true });
    close();
    notify(undefined);
  } catch (error) {
    notify(`Rename: ${error instanceof Error ? error.message : String(error)}`);
  }
}
