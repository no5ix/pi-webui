import { useEffect, useMemo, useState, type ReactNode } from "react";
import { sessionsApi } from "../../../api";
import type { ExtensionDialogAnswer, Project, SessionInfo, SessionRef, Workspace, DeferredImageRef } from "../../../../../shared/apiTypes";
import { useSessionStream, useSessionStreamSession, streamRuntime } from "../../state/sessionStream";
import { registerShellCommands } from "../../state/shellCommands";
import { isCardOpen, toggleCard, useConversation, setTranscriptWidth } from "../../state/conversationStore";
import { LitBoundary } from "../common/LitBoundary";
import { deferredImagePath } from "../../../api/urls";
import { ConversationHeader } from "./ConversationHeader";
import { MessageList } from "./MessageList";
import { TranscriptCards } from "./TranscriptCards";
import { PromptComposer } from "../composer/PromptComposer";
import { ConversationFooter } from "../composer/ConversationFooter";

/**
 * The middle column.
 *
 * The transcript, the composer and the session's own actions. It reads the
 * stream store (the transcript engine, the session socket) and nothing else:
 * the panel does not keep a copy of a message, a status or a queued prompt.
 */
export interface ConversationPanelProps {
  machineId: string;
  subject: {
    machineId: string;
    project: Project | undefined;
    workspace: Workspace | undefined;
    session: SessionRef | undefined;
    sessionInfo: SessionInfo | undefined;
  };
  layout: "three" | "two" | "phone";
  onOpenSettings: () => void;
}

export function ConversationPanel(props: ConversationPanelProps): ReactNode {
  const stream = useSessionStream();
  const conversation = useConversation();
  const { session, sessionInfo, workspace, project } = props.subject;
  const [dismissed, setDismissed] = useState<Record<string, true>>({});
  useSessionStreamSession(session, props.machineId);

  const streaming = stream.status !== undefined && (stream.status.isStreaming || stream.status.isCompacting);

  const warnings = useMemo(
    () => (stream.status?.warnings ?? []).filter((warning) => !(warning.dismiss?.id !== undefined && dismissed[warning.dismiss.id] === true)),
    [stream.status, dismissed],
  );

  registerCommands(props, stream.status, session);

  return (
    <div className={`piw-conversation piw-conversation--${props.layout}`}>
      <ConversationHeader
        activity={stream.activity}
        machineId={props.machineId}
        onOpenSettings={() => { props.onOpenSettings(); }}
        onToggleWidth={() => { setTranscriptWidth(conversation.width === "wide" ? "measure" : "wide"); }}
        projectName={project?.name}
        session={session}
        sessionInfo={sessionInfo}
        status={stream.status}
        width={conversation.width}
      />

      <div className="piw-panel__body piw-conversation__body">
        <ConnectionNotice connection={stream.connection} error={stream.error} onRetry={() => { streamRuntime.refresh(); }} />
        {warnings.map((warning) => {
          const dismissId = warning.dismiss?.id;
          return (
            <div className={`piw-notice piw-notice--${warning.severity}`} key={dismissId ?? warning.message} role="status">
              <span className="piw-notice__text">{warning.message}</span>
              {dismissId === undefined ? null : (
                <button
                  className="piw-notice__dismiss"
                  onClick={() => {
                    setDismissed((current) => ({ ...current, [dismissId]: true }));
                    if (session !== undefined) void sessionsApi.dismissWarning(session, dismissId, props.machineId).catch(() => undefined);
                  }}
                  type="button"
                >
                  Dismiss
                </button>
              )}
            </div>
          );
        })}

        {(stream.status?.pendingDialogs ?? []).map((dialog) => (
          <LitBoundary
            key={dialog.dialogId}
            properties={{
              dialog,
              draftSessionId: session?.id ?? "",
              machineId: props.machineId,
              onAnswer: (dialogId: string, answer: ExtensionDialogAnswer) => {
                if (session !== undefined) void sessionsApi.answerDialog(session, dialogId, answer, props.machineId).catch(() => undefined);
              },
              onCancel: (dialogId: string) => {
                if (session !== undefined) void sessionsApi.cancelDialog(session, dialogId, props.machineId).catch(() => undefined);
              },
              onKey: (dialogId: string, key: string) => session !== undefined && void sessionsApi.sendDialogKey(session, dialogId, key, props.machineId),
              onLine: (dialogId: string, line: number, text: string) => session !== undefined && void sessionsApi.selectDialogLine(session, dialogId, line, text, props.machineId),
              onWidth: (dialogId: string, width: number) => session !== undefined && void sessionsApi.resizeDialogScreen(session, dialogId, width, props.machineId),
            }}
            tag="extension-dialog-card"
          />
        ))}

        {stream.loading ? <div className="piw-skeleton piw-skeleton--block">Reading the transcript…</div> : null}
        {stream.error !== undefined && stream.messages.length === 0 ? <p className="piw-empty">The transcript did not load: {stream.error}</p> : null}

        <MessageList
          hasNewer={stream.pageEnd < stream.total}
          hasOlder={stream.pageStart > 0}
          imagePathFor={session === undefined ? undefined : (ref: DeferredImageRef) => deferredImagePath({ id: session.id, cwd: session.cwd }, ref, props.machineId)}
          loadingNewer={stream.loadingNewer}
          loadingOlder={stream.loadingOlder}
          messages={stream.messages}
          onInsertPrompt={insertIntoComposer}
          onNewer={() => { streamRuntime.loadNewer(); }}
          onOlder={() => { streamRuntime.loadOlder(); }}
          streaming={streaming}
          wide={conversation.width === "wide"}
        />

        <TranscriptCards
          messages={stream.messages}
          open={{ background: isCardOpen(conversation, "background"), editedFiles: isCardOpen(conversation, "editedFiles"), subagents: isCardOpen(conversation, "subagents") }}
          onToggle={(card) => { toggleCard(card); }}
          sessionInfo={sessionInfo}
          status={stream.status}
        />
      </div>

      <footer className="piw-conversation__footer">
        <QueuedPrompts machineId={props.machineId} queued={stream.status?.queuedMessages ?? []} session={session} />
        <PromptComposer
          cwd={session?.cwd ?? workspace?.path}
          machineId={props.machineId}
          projectId={project?.id}
          sessionId={session?.id}
          workspaceId={workspace?.id}
          projectName={project?.name}
        />
        <ConversationFooter cwd={session?.cwd} machineId={props.machineId} projectName={project?.name} sessionId={session?.id} status={stream.status} />
      </footer>
    </div>
  );
}

function QueuedPrompts({ machineId, queued, session }: { machineId: string; queued: readonly { kind: string; text: string }[]; session: SessionRef | undefined }): ReactNode {
  if (queued.length === 0) return null;
  return (
    <div className="piw-queued" data-testid="queued-prompts">
      <span className="piw-label">{`Queued ${String(queued.length)}`}</span>
      {queued.map((entry, index) => (
        <span className="piw-queued__item" key={`${entry.kind}-${String(index)}`}>
          <span className="piw-queued__kind">{entry.kind === "steer" ? "Steer" : "Follow up"}</span>
          <span dir="auto">{entry.text}</span>
        </span>
      ))}
      {session === undefined ? null : (
        <button className="piw-button" onClick={() => { void sessionsApi.clearQueue(session, machineId); }} type="button">
          Clear queue
        </button>
      )}
    </div>
  );
}

function ConnectionNotice({ connection, error, onRetry }: { connection: string; error: string | undefined; onRetry: () => void }): ReactNode {
  if (connection === "live" || connection === "idle") return null;
  const words = connection === "gap" ? "The transcript stream fell behind" : connection === "failed" ? "The transcript stream failed" : `The transcript stream is ${connection}`;
  return (
    <div className="piw-notice piw-notice--warning" role="status">
      <span className="piw-notice__text">{`${words}${error === undefined ? "" : `: ${error}`}`}</span>
      <button className="piw-notice__dismiss" onClick={() => { onRetry(); }} type="button">
        Reconnect
      </button>
    </div>
  );
}

function registerCommands(props: ConversationPanelProps, status: ReturnType<typeof useSessionStream>["status"], session: SessionRef | undefined): void {
  const machineId = props.machineId;
  useEffect(() => {
    const run = (call: () => Promise<unknown>): (() => void) => () => {
      void call().catch(() => undefined);
    };
    const missing = session === undefined ? "No session is open" : undefined;
    const unsubscribe = registerShellCommands([
      { id: "session.abort", title: "Stop the running turn", group: "Session", disabled: missing, run: run(() => sessionsApi.abort(session ?? { id: "", cwd: "" }, machineId)) },
      { id: "session.reload", title: "Reload the session", group: "Session", disabled: missing, run: run(() => sessionsApi.reloadSession(session ?? { id: "", cwd: "" }, machineId)) },
      { id: "session.archive", title: "Archive this session", group: "Session", disabled: missing, run: run(() => sessionsApi.archive(session ?? { id: "", cwd: "" }, machineId)) },
      { id: "session.clearQueue", title: "Clear queued prompts", group: "Session", disabled: status?.queuedMessages.length === 0 ? "Nothing is queued" : missing, run: run(() => sessionsApi.clearQueue(session ?? { id: "", cwd: "" }, machineId)) },
      { id: "chat.jumpToLatest", title: "Jump to the latest message", group: "Conversation", run: () => document.querySelector<HTMLElement>(".piw-jump")?.click() },
      { id: "chat.toggleSubagents", title: "Toggle the subagents card", group: "Conversation", run: () => { toggleCard("subagents"); }},
      { id: "chat.toggleBackground", title: "Toggle the background card", group: "Conversation", run: () => { toggleCard("background"); }},
      { id: "chat.toggleEditedFiles", title: "Toggle the edited files card", group: "Conversation", run: () => { toggleCard("editedFiles"); }},
    ]);
    return unsubscribe;
  }, [machineId, session, status?.queuedMessages.length]);
}

function insertIntoComposer(text: string): void {
  window.dispatchEvent(new CustomEvent("pi-web-composer-insert", { detail: { text, mode: "set" } }));
}
