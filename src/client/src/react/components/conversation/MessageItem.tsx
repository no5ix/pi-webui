import { useState, type ReactNode } from "react";
import { Icon, IconButton } from "../common/icons";
import { Markdown } from "../../markdown/Markdown";
import { PluginMessageCard, messageRendererView, useMessageRenderer } from "../../plugins/transcriptRenderers";
import { formatMessageTimestamp } from "../../markdown/formatTimestamp";
import { messageCopyText } from "../../../chatMessages";
import { writeClipboardText } from "../../../clipboard";
import { isResendableLine } from "../../../resendMessage";
import { deliveryMark, deliveryWords } from "../../../deliveryWords";
import type { ChatLine, ToolExecutionDisplayStatus } from "../../../components/shared";
import type { DeferredImageRef } from "../../../../../shared/apiTypes";
import { toolExecutionDisplayStatus } from "../../../components/shared";
import type { ChatPart } from "../../../components/shared";

/**
 * One transcript row.
 *
 * The parts of a pi message are drawn in the order they arrived: what was said,
 * what was thought, what was read, what was seen. A row never hides a part it
 * does not understand — an unknown part is drawn as what it is.
 */
export interface MessageItemProps {
  line: ChatLine;
  streaming: boolean;
  /** The subject a plugin renderer is told about: which machine, which session. */
  machineId: string;
  sessionId: string;
  imagePathFor?: ((ref: DeferredImageRef) => string | undefined) | undefined;
  onInsertPrompt?: ((text: string) => void) | undefined;
}

export function MessageItem(props: MessageItemProps): ReactNode {
  const { line, streaming } = props;
  const label = roleLabel(line);
  const timestamp = formatMessageTimestamp(line.meta?.timestamp);
  const mark = markOf(line, streaming);
  const model = modelLabel(line);
  const canCopy = line.parts.length > 0;
  const canResend = props.onInsertPrompt !== undefined && isResendableLine(line);
  return (
    <article className={`piw-message piw-message--${line.role}`} data-role={line.role}>
      <header className="piw-message__header">
        <span className="piw-label">{label}</span>
        {model === undefined ? null : <span className="piw-message__model piw-mono">{model}</span>}
        {mark === undefined ? null : <span className="piw-message__mark" title={mark.label}>{mark.text}</span>}
        <span className="piw-message__spacer" />
        {timestamp === undefined ? null : <time className="piw-message__time">{timestamp}</time>}
        {canCopy ? <CopyAction line={line} /> : null}
        {canResend ? (
          <IconButton
            icon="edit"
            label="Use this prompt again"
            onClick={() => {
              const text = messageCopyText(line);
              props.onInsertPrompt?.(text);
            }}
          />
        ) : null}
      </header>
      <div className="piw-message__body">
        {line.parts.map((part, index) => (
          <Part
            key={`${line.role}-${String(index)}`}
            imagePathFor={props.imagePathFor}
            part={part}
            streaming={streaming}
            subject={{ machineId: props.machineId, sessionId: props.sessionId, messageId: line.meta?.entryId ?? line.meta?.clientMessageId ?? "", createdAt: line.meta?.timestamp }}
          />
        ))}
      </div>
    </article>
  );
}

interface PartSubject {
  machineId: string;
  sessionId: string;
  messageId: string;
  createdAt: string | undefined;
}

/**
 * A custom message no plugin claims: what the extension drew, pi's own text, and
 * if neither arrived, the plain statement that nothing claimed it. The transcript
 * never shows an empty hole for a row that exists.
 */
function CustomFallback(props: { drawn: readonly string[] | undefined; text: string | undefined }): ReactNode {
  if (props.drawn !== undefined && props.drawn.length > 0) {
    return <pre className="piw-message__drawn piw-mono">{props.drawn.join("\n")}</pre>;
  }
  if (props.text !== undefined && props.text !== "") return <Markdown className="piw-message__text" text={props.text} />;
  return <div className="piw-message__note">A custom message no renderer claims.</div>;
}

function Part(props: {
  part: ChatPart;
  streaming: boolean;
  subject: PartSubject;
  imagePathFor?: ((ref: DeferredImageRef) => string | undefined) | undefined;
}): ReactNode {
  const { part } = props;
  const streaming = props.streaming;
  if (part.type === "custom") {
    const renderer = useMessageRenderer(part.tag, props.subject.machineId);
    if (renderer === undefined) return <CustomFallback drawn={part.drawn} text={part.text} />;
    return (
      <PluginMessageCard
        renderer={renderer}
        view={messageRendererView({
          sessionId: props.subject.sessionId,
          messageId: props.subject.messageId,
          tag: part.tag,
          payload: part.payload,
          streaming,
          createdAt: props.subject.createdAt,
          kind: part.kind,
          drawn: part.drawn,
        })}
      />
    );
  }
  if (part.type === "text") return <Markdown className="piw-message__text" text={part.display ?? part.text} />;
  if (part.type === "thinking") return <ThinkingBlock text={part.text} />;
  if (part.type === "image") {
    const source = "data" in part ? `data:${part.mimeType};base64,${part.data}` : props.imagePathFor?.(part.ref);
    if (source === undefined) return <div className="piw-empty">An image the server has not sent yet.</div>;
    return <img alt="Image from the conversation" className="piw-message__image" src={source} />;
  }
  if (part.type === "skillInvocation") return <SkillBlock name={part.name} location={part.location} content={part.content} />;
  if (part.type === "skillRead") return <div className="piw-message__note piw-mono">Read skill {part.name} ({part.path})</div>;
  if (part.type === "toolCall") {
    return <ToolInline name={part.toolName} status={props.streaming ? "running" : "interrupted"} summary={part.summary} />;
  }
  if (part.type === "toolExecution") {
    return <ToolInline name={part.toolName} status={toolExecutionDisplayStatus(part.status, props.streaming)} summary={part.summary} />;
  }
  if (part.type === "toolResult") {
    return <ToolInline name={part.toolName} status={part.isError ? "error" : "success"} summary={part.text} />;
  }
  if (part.type === "extensionNotice") return <div className={`piw-message__notice piw-message__notice--${part.level}`}>{part.text}{part.count > 1 ? ` ×${String(part.count)}` : ""}</div>;
  return null;
}

function ThinkingBlock({ text }: { text: string }): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <section className="piw-card piw-thinking">
      <button aria-expanded={open} className="piw-card__header" onClick={() => { setOpen((current) => !current); }} type="button">
        <Icon label="" name="sparkles" size="small" />
        <span className="piw-card__title">Thinking</span>
        <span className="piw-card__spacer" />
        <Icon label="" name={open ? "chevronUp" : "chevronDown"} size="small" />
      </button>
      {open ? <div className="piw-card__body piw-thinking__body">{text}</div> : null}
    </section>
  );
}

function SkillBlock({ name, location, content }: { name: string; location: string; content: string }): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <section className="piw-card">
      <button aria-expanded={open} className="piw-card__header" onClick={() => { setOpen((current) => !current); }} type="button">
        <Icon label="" name="layers" size="small" />
        <span className="piw-card__title">Skill {name}</span>
        <span className="piw-card__meta piw-mono">{location}</span>
        <Icon label="" name={open ? "chevronUp" : "chevronDown"} size="small" />
      </button>
      {open ? <Markdown className="piw-card__body" text={content} /> : null}
    </section>
  );
}

function ToolInline({ name, summary, status }: { name: string; summary: string; status: ToolExecutionDisplayStatus }): ReactNode {
  return (
    <div className={`piw-tool-inline piw-tool-inline--${status}`}>
      <Icon label="" name={status === "error" ? "rescue" : status === "running" ? "play" : "check"} size="small" />
      <span className="piw-mono">{summary === "" ? name : summary}</span>
    </div>
  );
}


function CopyAction({ line }: { line: ChatLine }): ReactNode {
  const [copied, setCopied] = useState(false);
  return (
    <IconButton
      icon={copied ? "check" : "copy"}
      label={copied ? "Copied" : "Copy message"}
      onClick={() => {
        void writeClipboardText(messageCopyText(line)).then((written) => {
          setCopied(written);
          window.setTimeout(() => { setCopied(false); }, 1600);
        });
      }}
    />
  );
}

function roleLabel(line: ChatLine): string {
  if (line.source === "compaction") return "COMPACTION";
  if (line.source === "branch_summary") return "BRANCH SUMMARY";
  if (line.role === "user") return "USER";
  if (line.role === "assistant") return "ASSISTANT";
  if (line.role === "bash") return "BASH";
  if (line.role === "system") return "SYSTEM";
  if (line.role === "tool") return "TOOL";
  return line.role.toUpperCase();
}

function modelLabel(line: ChatLine): string | undefined {
  const model = line.meta?.model;
  if (model === undefined) return undefined;
  const id = model.responseId ?? model.id;
  if (id === undefined || id === "") return model.provider;
  return model.provider !== undefined && model.provider !== "" ? `${model.provider}/${id}` : id;
}

function markOf(line: ChatLine, streaming: boolean) {
  const delivery = line.meta?.delivery;
  if (delivery === undefined) return undefined;
  const key = deliveryMark({
    state: delivery.state,
    writtenAt: Date.parse(line.meta?.timestamp ?? ""),
    now: Date.now(),
    working: streaming,
    shell: delivery.shell === true,
  });
  return key === undefined ? undefined : deliveryWords(key);
}
