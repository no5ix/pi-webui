import "./conversation.css";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { sessionsApi } from "../../../api";
import type { ChatLine } from "../../../components/shared";
import type { ExtensionDialogAnswer, Project, SessionInfo, SessionRef, Workspace, DeferredImageRef } from "../../../../../shared/apiTypes";
import { useSessionStream, useSessionStreamSession, streamRuntime } from "../../state/sessionStream";
import { useSubjectStatus } from "../../state/subjectRuntime";
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
  onCommandPalette: () => void;
  onOpenNavigation: () => void;
  onOpenWorkbench: () => void;
}

export function ConversationPanel(props: ConversationPanelProps): ReactNode {
  const stream = useSessionStream();
  const conversation = useConversation();
  const { session, sessionInfo, workspace, project } = props.subject;
  const [dismissed, setDismissed] = useState<Record<string, true>>({});
  const subjectStatus = useSubjectStatus();
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
        layout={props.layout}
        machineId={props.machineId}
        onCommandPalette={() => { props.onCommandPalette(); }}
        onOpenNavigation={() => { props.onOpenNavigation(); }}
        onOpenWorkbench={() => { props.onOpenWorkbench(); }}
        onOpenSettings={() => { props.onOpenSettings(); }}
        onToggleWidth={() => { setTranscriptWidth(conversation.width === "wide" ? "measure" : "wide"); }}
        projectName={project?.name}
        session={session}
        sessionInfo={sessionInfo}
        status={stream.status}
        subjectReason={subjectStatus.reason}
        subjectState={subjectStatus.state}
        transcriptTitle={transcriptTitle(stream.messages)}
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

        <TranscriptCards
          surface="subagents"
          messages={stream.messages}
          open={{ background: isCardOpen(conversation, "background"), editedFiles: isCardOpen(conversation, "editedFiles"), subagents: isCardOpen(conversation, "subagents") }}
          onToggle={(card) => { toggleCard(card); }}
          sessionInfo={sessionInfo}
          status={stream.status}
        />

        {stream.loading ? <div className="piw-skeleton piw-skeleton--block">Reading the transcript…</div> : null}
        {stream.error !== undefined && stream.messages.length === 0 ? <p className="piw-empty">The transcript did not load: {stream.error}</p> : null}

        <MessageList
          machineId={props.machineId}
          sessionId={session?.id ?? ""}
          connection={stream.connection}
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
          surface="footer"
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

/**
 * What the reader first said in the transcript on screen.
 *
 * A session opened by link has no board entry, so the transcript is its only
 * name; the first prompt is what a person recognises, and a transcript with no
 * prompt yet has no name to offer.
 */
function transcriptTitle(messages: readonly ChatLine[]): string | undefined {
  for (const line of messages) {
    if (line.role !== "user") continue;
    for (const part of line.parts) {
      if (part.type !== "text") continue;
      const words = part.text.trim();
      if (words === "") continue;
      return words.length > 120 ? `${words.slice(0, 120)}…` : words;
    }
  }
  return undefined;
}

function QueuedPrompts({ machineId, queued, session }: { machineId: string; queued: readonly { kind: string; text: string }[]; session: SessionRef | undefined }): ReactNode {  if (queued.length === 0) return null;
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

/**
 * The stream's own state, where a join that has not opened yet is normal for a
 * moment. The notice waits for "opening" to have persisted before it speaks, so
 * a transcript that is joining is not labelled as a problem, and a join that is
 * stuck says so with the control that tries again.
 */
const openingGraceMs = 2000;

function ConnectionNotice({ connection, error, onRetry }: { connection: string; error: string | undefined; onRetry: () => void }): ReactNode {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const sinceRef = useRef(Date.now());
  useEffect(() => {
    sinceRef.current = Date.now();
    setNowMs(Date.now());
  }, [connection]);
  useEffect(() => {
    if (connection !== "opening") return;
    const tick = window.setInterval(() => { setNowMs(Date.now()); }, 500);
    return () => { window.clearInterval(tick); };
  }, [connection]);
  if (connection === "live" || connection === "idle") return null;
  if (connection === "opening" && nowMs - sinceRef.current < openingGraceMs) return null;
  const words = connection === "gap"
    ? "The transcript stream fell behind"
    : connection === "failed"
      ? "The transcript stream failed"
      : connection === "closed"
        ? "The transcript stream is closed: the transcript below is the machine's stored history"
        : `The transcript stream is ${connection}`;
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
