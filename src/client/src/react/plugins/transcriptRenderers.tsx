import type { ReactNode } from "react";
import { LitTemplateBoundary } from "./LitTemplateBoundary";
import { pluginRegistry, usePluginBridge } from "./pluginBridge";
import { insertComposerText, submitComposerDraft } from "../state/composerStore";
import { pushToast } from "../components/common/Toasts";
import type {
  MessageRendererViewModel,
  QualifiedMessageRendererContribution,
  QualifiedToolRendererContribution,
} from "../../plugins/types";

/**
 * The plugin renderers the transcript hosts: a card for one custom message tag,
 * and a card for one tool's rows.
 *
 * Both follow the contract's rule that a card is never an empty hole. The
 * registry is asked for the claim; when there is no claim - or the renderer
 * answers undefined because its own data has not arrived - the host's card
 * stands. A renderer that throws leaves the host's card standing too, and the
 * failure is named in the console.
 */
export function useMessageRenderer(tag: string, machineId: string): QualifiedMessageRendererContribution | undefined {
  usePluginBridge();
  return pluginRegistry().findMessageRenderer(tag, machineId);
}

export function useToolRenderer(toolName: string, machineId: string): QualifiedToolRendererContribution | undefined {
  usePluginBridge();
  return pluginRegistry().findToolRenderer(toolName, machineId);
}

export interface PluginMessageCardProps {
  renderer: QualifiedMessageRendererContribution;
  view: MessageRendererViewModel;
}

/** One plugin's card for one custom message. */
export function PluginMessageCard(props: PluginMessageCardProps): ReactNode {
  return (
    <div className="piw-plugin-card" data-plugin={props.renderer.pluginId} data-testid="plugin-message-card">
      <LitTemplateBoundary template={props.renderer.render(props.view)} />
    </div>
  );
}

/**
 * One plugin's card for one tool call. The renderer may answer undefined - its
 * details have not arrived - and the caller keeps its own card in that case, so
 * the card only mounts once there is something to show.
 */


export interface MessageViewModelInput {
  readonly sessionId: string;
  readonly messageId: string;
  readonly tag: string;
  readonly payload: unknown;
  readonly streaming: boolean;
  readonly createdAt: string | undefined;
  readonly kind: "message" | "entry";
  readonly drawn: readonly string[] | undefined;
}

/**
 * The view a message renderer is handed.
 *
 * `insertIntoComposer` and `sendMessage` are the composer's own operations, so a
 * card that offers a reply puts it in front of the reader rather than sending it
 * in their name. `followingUserTexts` and `followingRows` report only what is
 * loaded - the transcript's loading state is the truth here, and a card that
 * claims to know what came after an unloaded page would be lying.
 */
export function messageRendererView(input: MessageViewModelInput): MessageRendererViewModel {
  return {
    sessionId: input.sessionId,
    messageId: input.messageId,
    tag: input.tag,
    payload: input.payload,
    streaming: input.streaming,
    createdAt: input.createdAt,
    kind: input.kind,
    ...(input.drawn === undefined ? {} : { drawn: input.drawn }),
    insertIntoComposer: (text: string) => { insertComposerText(text); },
    sendMessage: async (text: string) => {
      insertComposerText(text);
      const outcome = await submitComposerDraft();
      if (outcome === "no-composer") pushToast({ body: "The composer is not open, so nothing was sent.", title: "Send", tone: "warning" });
    },
  };
}
