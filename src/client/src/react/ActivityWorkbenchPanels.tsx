import type { ChatLine } from "../chatTypes";
import { Icon } from "./icons";

export interface ActivityRecord {
  readonly id: string;
  readonly toolName: string;
  readonly summary: string;
  readonly status: string;
  readonly timestamp: string;
}

export function collectToolRecords(messages: readonly ChatLine[], pattern: RegExp): ActivityRecord[] {
  const byId = new Map<string, ActivityRecord>();
  messages.forEach((message, messageIndex) => message.parts.forEach((part, partIndex) => {
    if (part.type !== "toolCall" && part.type !== "toolExecution") return;
    if (!pattern.test(part.toolName)) return;
    const id = part.toolCallId ?? message.meta?.entryId ?? String(messageIndex) + "-" + String(partIndex);
    const status = part.type === "toolExecution" ? part.status : "running";
    const previous = byId.get(id);
    if (previous === undefined || part.type === "toolExecution") {
      byId.set(id, { id, toolName: part.toolName, summary: part.summary, status, timestamp: message.meta?.timestamp ?? "" });
    }
  }));
  return [...byId.values()].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
}

export function collectEditedFileDiffs(messages: readonly ChatLine[]): { path: string; diff: string }[] {
  const files = new Map<string, string>();
  for (const message of messages) for (const part of message.parts) {
    if (part.type !== "toolExecution" || part.preview?.diff === undefined || typeof part.args !== "object" || part.args === null) continue;
    const path: unknown = Reflect.get(part.args, "path");
    if (typeof path === "string") files.set(path, part.preview.diff);
  }
  return [...files].map(([path, diff]) => ({ path, diff }));
}

export function summarizeActivityGroup(messages: readonly ChatLine[]): string {
  let thinking = 0, calls = 0, results = 0;
  for (const message of messages) for (const part of message.parts) {
    if (part.type === "thinking") thinking++;
    else if (part.type === "toolCall" || part.type === "toolExecution") calls++;
    else if (part.type === "toolResult") results++;
  }
  const labels: string[] = [];
  if (thinking) labels.push(String(thinking) + " " + (thinking === 1 ? "thinking" : "thinkings"));
  if (calls) labels.push(String(calls) + " " + (calls === 1 ? "tool call" : "tool calls"));
  if (results) labels.push(String(results) + " " + (results === 1 ? "tool result" : "tool results"));
  return labels.length ? labels.join(", ") : String(messages.length) + " activity messages";
}

export function ActivityRecordsPanel({ records, empty }: { records: readonly ActivityRecord[]; empty: string }) {
  return <div className="rw-activity-records">
    {records.length === 0 ? <div className="rw-empty-panel">{empty}</div> : records.map(record => <article className="rw-activity-record" key={record.id}>
      <div><strong>{record.toolName}</strong><span>{record.summary}</span></div>
      <small>{record.timestamp ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(Date.parse(record.timestamp)) : "Time unavailable"}</small>
      <em className={record.status === "success" ? "success" : record.status === "error" ? "error" : "running"}>{record.status}</em>
      <Icon name="chevron-right"/>
    </article>)}
  </div>;
}
