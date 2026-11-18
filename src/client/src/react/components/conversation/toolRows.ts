import { ToolExecutionStatus, toolExecutionDisplayStatus, type ChatLine, type ChatPart, type ToolPreview, type ToolExecutionDisplayStatus } from "../../../components/shared";

/**
 * A tool call as the transcript shows it.
 *
 * pi reports a call in pieces: a `toolCall` when it starts, a `toolExecution`
 * with the result the daemon computed, and a `toolResult` when the model sees
 * the answer. The reader wants one row per call, so the parts are joined by the
 * call id, in the order they arrived, and a call whose pieces never all arrive
 * stays visible with what is known.
 */
export interface ToolRow {
  readonly key: string;
  readonly name: string;
  readonly summary: string;
  readonly args: unknown;
  readonly resultText: string | undefined;
  readonly preview: ToolPreview | undefined;
  readonly durationMs: number | undefined;
  readonly status: ToolExecutionDisplayStatus;
  readonly drawnCall: readonly string[] | undefined;
  readonly drawnResult: readonly string[] | undefined;
}

export function toolRowsOf(lines: readonly ChatLine[], streaming: boolean): ToolRow[] {
  const rows: ToolRow[] = [];
  const byKey = new Map<string, number>();
  for (const line of lines) {
    for (const part of line.parts) {
      const entry = entryOf(part);
      if (entry === undefined) continue;
      const existing = entry.key === undefined ? undefined : byKey.get(entry.key);
      const index = existing ?? rows.length;
      const previous = existing === undefined ? undefined : rows[existing];
      const row: ToolRow = {
        key: entry.key ?? `${entry.name}-${String(index)}`,
        name: previous?.name ?? entry.name,
        summary: entry.summary !== "" ? entry.summary : (previous?.summary ?? entry.name),
        args: entry.args ?? previous?.args,
        resultText: entry.resultText ?? previous?.resultText,
        preview: entry.preview ?? previous?.preview,
        durationMs: entry.durationMs ?? previous?.durationMs,
        status: mergeStatus(previous?.status, entry.status, streaming),
        drawnCall: entry.drawnCall ?? previous?.drawnCall,
        drawnResult: entry.drawnResult ?? previous?.drawnResult,
      };
      if (existing === undefined) rows.push(row);
      else rows[existing] = row;
      if (entry.key !== undefined) byKey.set(entry.key, index);
    }
  }
  return rows;
}

function mergeStatus(
  previous: ToolExecutionDisplayStatus | undefined,
  next: ToolExecutionStatus | undefined,
  streaming: boolean,
): ToolExecutionDisplayStatus {
  if (next !== undefined) return toolExecutionDisplayStatus(next, streaming);
  return previous ?? toolExecutionDisplayStatus(ToolExecutionStatus.Running, streaming);
}

interface ToolPartEntry {
  key: string | undefined;
  name: string;
  summary: string;
  args: unknown;
  resultText: string | undefined;
  preview: ToolPreview | undefined;
  durationMs: number | undefined;
  status: ToolExecutionStatus | undefined;
  drawnCall: readonly string[] | undefined;
  drawnResult: readonly string[] | undefined;
}

function entryOf(part: ChatPart): ToolPartEntry | undefined {
  if (part.type === "toolCall") {
    return { key: part.toolCallId, name: part.toolName, summary: part.summary, args: part.args, resultText: undefined, preview: undefined, durationMs: undefined, status: ToolExecutionStatus.Running, drawnCall: part.drawnCall, drawnResult: undefined };
  }
  if (part.type === "toolExecution") {
    return {
      key: part.toolCallId,
      name: part.toolName,
      summary: part.summary,
      args: part.args,
      resultText: part.resultText,
      preview: part.preview,
      durationMs: part.durationMs,
      status: part.status,
      drawnCall: part.drawnCall,
      drawnResult: part.drawnResult,
    };
  }
  if (part.type === "toolResult") {
    return {
      key: part.toolCallId,
      name: part.toolName,
      summary: "",
      args: undefined,
      resultText: part.text,
      preview: undefined,
      durationMs: part.durationMs,
      status: part.isError ? ToolExecutionStatus.Error : ToolExecutionStatus.Success,
      drawnCall: undefined,
      drawnResult: part.drawnResult,
    };
  }
  return undefined;
}
