import { useEffect, useRef, useState } from "react";
import { toSafeMarkdownHtml } from "../formatting/markdown";
import { deferredImagePath } from "../api/urls";
import { toolExecutionDisplayStatus, type ChatLine, type ChatPart, type ToolExecutionPart } from "../chatTypes";
import { resolveAppUrl } from "../appUrl";
import { messageCopyText } from "../chatMessages";
import { writeClipboardText } from "../clipboard";
import { Icon } from "./icons";

interface ConversationMessageProps {
  message: ChatLine;
  streaming: boolean;
  session: { id: string; cwd: string } | undefined;
  machineId: string;
}

function markdown(value: string) {
  return <div className="rw-markdown" dangerouslySetInnerHTML={{ __html: toSafeMarkdownHtml(value) }} />;
}

function executionStatus(part: ToolExecutionPart, streaming: boolean): string {
  return toolExecutionDisplayStatus(part.status, streaming);
}

function ToolExecution({ part, streaming }: { part: ToolExecutionPart; streaming: boolean }) {
  const status = executionStatus(part, streaming);
  const details = part.args === undefined ? undefined : JSON.stringify(part.args, null, 2);
  return <details className={`rw-tool-execution ${status}`}>
    <summary><Icon name={status === "success" ? "check-circle" : status === "error" ? "x" : "activity"}/><strong>{part.toolName}</strong><span>{part.summary}</span><small>{status}{part.durationMs === undefined ? "" : ` · ${part.durationMs}ms`}</small></summary>
    {(details !== undefined || part.resultText !== undefined || part.preview?.diff !== undefined) && <div className="rw-tool-details">
      {details !== undefined && <pre>{details}</pre>}
      {part.preview?.diff !== undefined && <pre className="rw-tool-diff">{part.preview.diff}</pre>}
      {part.resultText !== undefined && <pre>{part.resultText}</pre>}
    </div>}
  </details>;
}

function MessagePart({ part, message, streaming, session, machineId, onImageOpen }: {
  part: ChatPart;
  message: ChatLine;
  streaming: boolean;
  session: { id: string; cwd: string } | undefined;
  machineId: string;
  onImageOpen: (src: string, alt: string) => void;
}) {
  if (part.type === "text") return message.role === "bash" ? <pre className="rw-shell-output">{part.text}</pre> : markdown(part.display ?? part.text);
  if (part.type === "thinking") return <div className="rw-thinking">{markdown(part.display ?? part.text)}</div>;
  if (part.type === "toolCall") return <div className="rw-tool-call"><Icon name="activity"/><strong>{part.toolName}</strong><span>{part.summary}</span>{part.args !== undefined && <details><summary>Arguments</summary><pre>{JSON.stringify(part.args, null, 2)}</pre></details>}</div>;
  if (part.type === "toolExecution") return <ToolExecution part={part} streaming={streaming}/>;
  if (part.type === "toolResult") return <details className={`rw-tool-result${part.isError ? " error" : ""}`}><summary><Icon name={part.isError ? "x" : "check-circle"}/>{part.toolName} result</summary><pre>{part.text}</pre></details>;
  if (part.type === "image") {
    if ("data" in part) {
      const src = `data:${part.mimeType};base64,${part.data}`;
      return <button className="rw-image-button" type="button" aria-label="View attached image" onClick={() => onImageOpen(src, "attached image")}><img className="rw-message-image" src={src} alt="attached image" loading="lazy"/></button>;
    }
    if (session === undefined) return <span className="rw-missing-image">Image attachment (session scope missing)</span>;
    const src = resolveAppUrl(deferredImagePath(session, part.ref, machineId));
    const alt = "toolCallId" in part.ref ? "tool result image" : "attached image";
    return <button className="rw-image-button" type="button" aria-label="View attached image" onClick={() => onImageOpen(src, alt)}><img className="rw-message-image" src={src} alt={alt} loading="lazy"/></button>;
  }
  if (part.type === "skillInvocation") return <details className="rw-skill-part"><summary>Skill · {part.name}</summary><small>{part.location}</small>{markdown(part.content)}</details>;
  if (part.type === "skillRead") return <div className="rw-skill-part"><strong>Loaded {part.name}</strong><small>{part.path}</small></div>;
  if (part.type === "custom") return <details className="rw-custom-part"><summary>{part.tag}</summary>{part.text === undefined ? <pre>{JSON.stringify(part.payload, null, 2)}</pre> : markdown(part.text)}</details>;
  if (part.type === "extensionNotice") return <div className={`rw-extension-notice ${part.level}`}>{part.text}</div>;
  return null;
}

function timestamp(value: string | undefined): string {
  if (value === undefined) return "";
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(time) : value;
}

export function ConversationMessage({ message, streaming, session, machineId }: ConversationMessageProps) {
  const viewerRef = useRef<HTMLDialogElement>(null);
  const [viewer, setViewer] = useState<{ src: string; alt: string }>();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const dialog = viewerRef.current;
    if (dialog === null) return;
    if (viewer !== undefined && !dialog.open) dialog.showModal();
    if (viewer === undefined && dialog.open) dialog.close();
  }, [viewer]);
  const copyText = messageCopyText(message);
  return <>
    <article className={`rw-message ${message.role}`}>
      <div className="rw-message-meta"><span>{message.role}</span><time>{timestamp(message.meta?.timestamp)}</time>{copyText !== "" && (message.role === "user" || message.role === "assistant") && <button type="button" aria-label={copied ? "Copied message" : `Copy ${message.role} message`} onClick={async event => { event.stopPropagation(); setCopied(await writeClipboardText(copyText)); }}>{copied ? "Copied" : "Copy"}</button>}</div>
      <div className="rw-message-body">{message.parts.map((part, index) => <MessagePart key={`${part.type}-${index}`} part={part} message={message} streaming={streaming} session={session} machineId={machineId} onImageOpen={(src, alt) => setViewer({ src, alt })}/>)}</div>
      {message.meta?.failureDetail !== undefined && <details className="rw-failure-detail"><summary>Error details</summary><pre>{message.meta.failureDetail}</pre></details>}
    </article>
    <dialog ref={viewerRef} className="rw-image-viewer" aria-label="Image preview" onClose={() => setViewer(undefined)}>
      <button type="button" aria-label="Close image preview" onClick={() => viewerRef.current?.close()}>Close</button>
      {viewer && <img src={viewer.src} alt={viewer.alt}/>}
    </dialog>
  </>;
}

export function editedFilesFromMessages(messages: readonly ChatLine[]): { path: string; status: string }[] {
  const files = new Map<string, string>();
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== "toolExecution" && part.type !== "toolCall") continue;
      if (!["write", "edit", "apply_patch"].includes(part.toolName)) continue;
      if (typeof part.args !== "object" || part.args === null) continue;
      const path: unknown = Reflect.get(part.args, "path");
      if (typeof path !== "string" || path.trim() === "") continue;
      files.set(path, part.type === "toolExecution" ? part.status : "running");
    }
  }
  return [...files].map(([path, status]) => ({ path, status }));
}
