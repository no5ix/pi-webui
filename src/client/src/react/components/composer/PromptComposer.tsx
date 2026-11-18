import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { sessionsApi } from "../../../api";
import { isSessionActive } from "../../../../../shared/activity";
import { isRecord } from "../../../../../shared/unknownValues";
import { deferredImagePath } from "../../../api/urls";
import { rowedClientMessageIds } from "../../../messageDelivery";
import { useSessionStream, streamRuntime } from "../../state/sessionStream";
import { useComposer, readModelSelection, sessionPromptsOf } from "../../state/composerStore";
import { registerShellCommands } from "../../state/shellCommands";
import { usePluginComposerContributions } from "../../plugins/pluginBridge";
import { LitBoundary } from "../common/LitBoundary";
import { pushToast } from "../common/Toasts";
import "./composer.css";

/**
 * The prompt surface.
 *
 * PI WEB's composer is one Custom Element with a long history: slash commands,
 * file mentions, attachments, drafts, prompt history, the outbox that carries a
 * prompt through a reload, queue and steer, plugin composer slots. The React
 * shell does not rebuild that — it hosts it, and feeds it the same properties
 * the Lit shell fed it. The sending state and the plugin notice land in React
 * state, where the shell can show them.
 */
export interface PromptComposerProps {
  machineId: string;
  sessionId: string | undefined;
  cwd: string | undefined;
  projectId: string | undefined;
  workspaceId: string | undefined;
  projectName: string | undefined;
}

interface PromptEditorElement extends HTMLElement {
  replaceText?: (text: string) => void;
  pasteText?: (text: string) => void;
  focusInput?: () => void;
  settleOutbox?: (ids: readonly string[]) => void;
}

export function PromptComposer(props: PromptComposerProps): ReactNode {
  const stream = useSessionStream();
  const composer = useComposer();
  const editor = useRef<PromptEditorElement | null>(null);
  const [sending, setSending] = useState(false);
  const contributions = usePluginComposerContributions(props.machineId);

  useEffect(() => {
    setSending(false);
    if (props.sessionId === undefined || props.cwd === undefined) return;
    void readModelSelection({ id: props.sessionId, cwd: props.cwd }, props.machineId);
  }, [props.machineId, props.sessionId, props.cwd]);

  useEffect(() => {
    const listener = (event: Event): void => {
      if (!(event instanceof CustomEvent)) return;
      const detail: unknown = event.detail;
      if (!isRecord(detail)) return;
      const text = detail["text"];
      if (typeof text !== "string") return;
      const node = editor.current;
      if (node === null) return;
      if (detail["mode"] === "paste") node.pasteText?.(text);
      else node.replaceText?.(text);
      node.focusInput?.();
    };
    window.addEventListener("pi-web-composer-insert", listener);
    return () => { window.removeEventListener("pi-web-composer-insert", listener); };
  }, []);

  const session = props.sessionId === undefined || props.cwd === undefined ? undefined : { id: props.sessionId, cwd: props.cwd };
  const status = stream.status;
  const queued = status?.queuedMessages ?? [];

  useEffect(() => {
    if (session === undefined) return;
    const unsubscribe = registerShellCommands([
      {
        id: "composer.focus",
        title: "Focus the composer",
        group: "Composer",
        run: () => editor.current?.focusInput?.(),
      },
      {
        id: "composer.abort",
        title: "Stop what the session is doing",
        group: "Composer",
        disabled: isSessionActive(status, stream.activity) ? undefined : "The session is idle",
        run: () => {
          void sessionsApi.abort(session, props.machineId).catch(() => undefined);
        },
      },
      {
        id: "composer.clearQueue",
        title: "Clear the queued prompts",
        group: "Composer",
        disabled: queued.length === 0 ? "Nothing is queued" : undefined,
        run: () => {
          void sessionsApi.clearQueue(session, props.machineId).catch(() => undefined);
        },
      },
      {
        id: "composer.cycleModel",
        title: "Cycle the model",
        group: "Composer",
        run: () => {
          void sessionsApi.cycleModel(session, "forward", props.machineId).then((next) => { streamRuntime.applyStatus(next); });
        },
      },
      {
        id: "composer.cycleThinking",
        title: "Cycle the thinking level",
        group: "Composer",
        run: () => {
          void sessionsApi.cycleThinkingLevel(session, props.machineId).then((next) => { streamRuntime.applyStatus(next); });
        },
      },
    ]);
    return unsubscribe;
  }, [props.machineId, session?.id, session?.cwd, queued.length, status, stream.activity]);

  const prompts = useMemo(
    () => sessionPromptsOf(stream.messages, (ref) => (session === undefined ? undefined : deferredImagePath(session, ref, props.machineId))),
    [stream.messages, session?.id, session?.cwd, props.machineId],
  );

  if (props.sessionId === undefined) {
    return (
      <div className="piw-composer piw-composer--empty" data-testid="composer">
        <p className="piw-empty">No session is open, so there is nothing to write to. Open a session on the left, or start one in a project.</p>
      </div>
    );
  }

  return (
    <div className="piw-composer" data-testid="composer">
      <LitBoundary
        onElement={(element) => {
          editor.current = isPromptEditorElement(element) ? element : null;
        }}
        properties={{
          sessionId: props.sessionId,
          cwd: props.cwd,
          machineId: props.machineId,
          projectId: props.projectId,
          workspaceId: props.workspaceId,
          canSteer: status?.isStreaming === true,
          isCompacting: status?.isCompacting === true,
          canStop: isSessionActive(status, stream.activity),
          status,
          statusArrival: "none",
          sending,
          availableThinkingLevels: composer.levels.value ?? [],
          sessionPrompts: prompts,
          rowedMessageIds: rowedClientMessageIds(stream.messages, queued),
          composerContributions: contributions,
          onOutgoingWritten: () => { setSending(true); },
          onLocalCommand: () => false,
          onStop: () => {
            if (session === undefined) return;
            void sessionsApi.abort(session, props.machineId).then(() => { setSending(false); });
          },
          onSelectModel: () => window.dispatchEvent(new CustomEvent("pi-web-open-model-picker")),
          onSelectThinking: () => window.dispatchEvent(new CustomEvent("pi-web-open-thinking-picker")),
          onPluginNotice: (message: string, severity: "info" | "warning" | "error") => {
            pushToast({ body: message, title: "A plugin said", tone: severity });
          },
        }}
        tag="prompt-editor"
        testId="prompt-editor"
      />
    </div>
  );
}

function isPromptEditorElement(element: HTMLElement): element is PromptEditorElement {
  return typeof Reflect.get(element, "replaceText") === "function" && typeof Reflect.get(element, "focusInput") === "function";
}
