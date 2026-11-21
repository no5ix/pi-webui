import type { DeferredImageRef, ExtensionCompletionItem, ExtensionNoticeLevel } from "../../shared/apiTypes";

/** Conversation and completion contracts shared by React views and transcript services. */
type ChatRole = "user" | "assistant" | "tool" | "system" | "bash" | "skill";

export interface ToolPreview {
  diff?: string;
  firstChangedLine?: number;
  error?: string;
}

/** The execution status the data carries: what actually happened to the call. */
export const ToolExecutionStatus = {
  Pending: "pending",
  Running: "running",
  Success: "success",
  Error: "error",
} as const;
export type ToolExecutionStatus = (typeof ToolExecutionStatus)[keyof typeof ToolExecutionStatus];

/**
 * What the card displays. There is no displayed "pending": a call the agent
 * has issued while the turn streams is running - the owner read "pending" as
 * waiting for something that never started, when the command was executing.
 * The same call with no turn behind it is interrupted, not pending.
 */
export type ToolExecutionDisplayStatus = Exclude<ToolExecutionStatus, "pending"> | "interrupted";

export function toolExecutionDisplayStatus(status: ToolExecutionStatus, streaming: boolean): ToolExecutionDisplayStatus {
  if (status !== ToolExecutionStatus.Pending) return status;
  return streaming ? "running" : "interrupted";
}

export interface ToolExecutionPart {
  type: "toolExecution";
  toolCallId?: string;
  toolName: string;
  summary: string;
  args?: unknown;
  status: ToolExecutionStatus;
  resultText?: string;
  content?: unknown;
  details?: unknown;
  preview?: ToolPreview;
  /** The lines an extension tool's own pi renderers draw for its arguments and its result (pi-insertion-points.md slice 2). */
  drawnCall?: readonly string[];
  drawnResult?: readonly string[];
  /** How long the tool ran, as pi recorded it on the final result (pi 1.1.0); absent before 1.1.0 and while it runs. */
  durationMs?: number;
}


/** Where a custom row comes from: a custom message, or a custom session entry an extension draws. */
export type CustomRowKind = "message" | "entry";

export type ChatPart =
  /** `display`: how an extension's markdown transformer has the text drawn; `text` stays what was said. */
  | { type: "text"; text: string; display?: string }
  | { type: "image"; mimeType: string; data: string }
  /** A deferred image, fetched by address when it scrolls into view (`DeferredImageRef`). */
  | { type: "image"; mimeType: string; ref: DeferredImageRef }
  /** A run of adjacent thinking blocks (`joinThinking`); `contentIndex`: pi's index of the run's last block, so a live delta can tell the next block from more of it. */
  | { type: "thinking"; text: string; display?: string; contentIndex?: number }
  | { type: "skillInvocation"; name: string; location: string; content: string }
  | { type: "skillRead"; name: string; path: string; toolCallId?: string }
  | { type: "toolCall"; toolCallId?: string; toolName: string; summary: string; args?: unknown; drawnCall?: readonly string[] }
  | ToolExecutionPart
  | { type: "toolResult"; toolCallId?: string; toolName: string; text: string; isError: boolean; content?: unknown; details?: unknown; drawnResult?: readonly string[]; durationMs?: number }
  /**
   * An extension's custom message or entry. `drawn`: the lines the extension's own pi renderer
   * draws, from the daemon; `text`: a message's content, pi's default when nothing draws it.
   */
  | { type: "custom"; tag: string; payload: unknown; kind: CustomRowKind; drawn?: readonly string[]; text?: string }
  /** An extension's notify, live only; see extensionNotices.ts. */
  | { type: "extensionNotice"; id: string; level: ExtensionNoticeLevel; text: string; count: number; at: number }
  | { type: "empty" };

/**
 * Delivery state of a message this browser sent (docs/design/message-states.md). `sending` and
 * `takingBack` are this device's until the machine answers; the rest are the machine's. A
 * message never fails: it is on its way until the machine takes it, or it leaves the transcript
 * (taken back, or cancelled by a refusal) and its words go back to the composer. Only messages
 * sent from this browser carry one: history loaded from the server is delivered by definition.
 */
export type MessageDeliveryState = "sending" | "takingBack" | "received" | "queued" | "delivered";

export interface MessageDelivery {
  /** Correlation id minted by this browser and echoed back by the server. */
  clientMessageId: string;
  state: MessageDeliveryState;
  /** How the agent will take the message when it is still queued. */
  kind?: "steer" | "followUp";
  /** A `!` command's line rather than a message: it keeps "Sending…" until it runs (`deliveryMark`). */
  shell?: true;
}

export interface ChatLine {
  role: ChatRole;
  parts: ChatPart[];
  source?: "compaction" | "branch_summary";
  meta?: {
    timestamp?: string;
    /** The provider's id for the reply this line belongs to; see messageIdentity.ts. */
    responseId?: string;
    /** The daemon's id for the history entry this line was read from; a row with no other identity is keyed by it (rowIdentity.ts). */
    entryId?: string;
    /** Built from an assistant reply that ended in an error; see retriedAttempt.ts. */
    failedAttempt?: true;
    /** A model error's provider text, whole, shown behind Details under the row's sentence (B34). */
    failureDetail?: string;
    /** Present only on messages this browser sent; see MessageDelivery. */
    delivery?: MessageDelivery;
    clientMessageId?: string;
    /**
     * The server's optimistic copy of an accepted prompt. The agent commits its
     * own copy later, and that copy supersedes this line rather than following
     * it - which is how the same message stops rendering twice on a client that
     * cannot correlate by id (another device, or this one after a reload).
     */
    echo?: boolean;
    /**
     * The sender-minted identity riding on an echo line. The echo is the only
     * copy another device holds while a message waits in the queue, so a
     * withdrawal frame must be able to find it by id.
     */
    echoClientMessageId?: string;
    model?: { provider?: string; id?: string; responseId?: string };
    /** Thinking level the assistant message was generated with, when known. */
    thinkingLevel?: string;
    /** The plugin whose composer control pressed Send for this message, as the machine stamped it. */
    sentVia?: string;
    /** The device whose batch carried this message, as the machine stamped it. */
    sentBy?: string;
  };
}

export interface CompletionItem {
  kind: "command" | "file" | "model" | "extension";
  replaceFrom: number;
  replaceTo: number;
  insertText: string;
  detail: string;
  description?: string;
  /** What a command takes after its name (`<provider/model>`), shown beside it and not inserted. */
  argumentHint?: string;
  cursorOffset?: number;
  /** An extension provider's item, applied by the session's providers against the text it was suggested for. */
  extension?: { item: ExtensionCompletionItem; prefix: string; text: string; cursor: number };
}
