import { useState, type ReactNode } from "react";
import { Icon } from "../common/icons";
import { runDuration } from "../../../runDuration";
import type { ToolRow } from "./toolRows";

/**
 * A run of tool calls, collapsed to one line.
 *
 * The reader asks "what did it do here?" before "what did each call print?", so
 * the header carries the summary and the state, and the output opens on demand.
 */
export interface ToolExecutionCardProps {
  rows: readonly ToolRow[];
  summary: string;
  open: boolean;
  onToggle: () => void;
  streaming: boolean;
}

export function ToolExecutionCard(props: ToolExecutionCardProps): ReactNode {
  const { rows, summary, open, onToggle, streaming } = props;
  const failed = rows.filter((row) => row.status === "error").length;
  const running = rows.some((row) => row.status === "running");
  const elapsed = rows.reduce((total, row) => total + (row.durationMs ?? 0), 0);
  return (
    <section className="piw-card piw-tool-card" data-testid="tool-card">
      <button
        aria-expanded={open}
        className="piw-card__header piw-tool-card__header"
        onClick={() => { onToggle(); }}
        type="button"
      >
        <Icon label="" name={statusIcon(running, failed, streaming)} size="small" />
        <span className="piw-card__title">{summary}</span>
        <span className="piw-card__meta">{elapsed > 0 ? runDuration(elapsed) : null}</span>
        <Icon label="" name={open ? "chevronUp" : "chevronDown"} size="small" />
      </button>
      {open ? (
        <div className="piw-card__body piw-tool-card__body">
          {rows.map((row) => (
            <ToolRowItem key={row.key} row={row} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function statusIcon(running: boolean, failed: number, streaming: boolean): "check" | "rescue" | "play" {
  if (failed > 0) return "rescue";
  if (running && streaming) return "play";
  return "check";
}

function ToolRowItem({ row }: { row: ToolRow }): ReactNode {
  const [expanded, setExpanded] = useState(false);
  const detail = detailOf(row);
  return (
    <div className="piw-tool-row" data-testid={`tool-row-${row.name}`}>
      <button
        className="piw-tool-row__head"
        disabled={detail === null}
        onClick={() => { setExpanded((current) => !current); }}
        type="button"
      >
        <span className="piw-mono piw-tool-row__name">{row.summary === "" ? row.name : row.summary}</span>
        {row.durationMs === undefined ? null : <span className="piw-tool-row__duration">{runDuration(row.durationMs)}</span>}
        {detail === null ? null : <Icon label="" name={expanded ? "chevronUp" : "chevronRight"} size="small" />}
      </button>
      {expanded && detail !== null ? (
        <div className="piw-tool-row__detail">
          {detail.map((block, index) => (
            <pre className="piw-tool-row__output" key={`${row.key}-${String(index)}`}>
              {block}
            </pre>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function detailOf(row: ToolRow): readonly string[] | null {
  const blocks: string[] = [];
  if (row.drawnCall !== undefined) blocks.push(row.drawnCall.join("\n"));
  const args = argsText(row.args);
  if (args !== undefined) blocks.push(args);
  if (row.preview?.diff !== undefined && row.preview.diff !== "") blocks.push(row.preview.diff);
  if (row.resultText !== undefined && row.resultText !== "") blocks.push(row.resultText);
  if (row.preview?.error !== undefined) blocks.push(row.preview.error);
  return blocks.length === 0 ? null : blocks;
}

function argsText(args: unknown): string | undefined {
  if (args === undefined || args === null) return undefined;
  if (typeof args === "string") return args === "" ? undefined : args;
  try {
    const text = JSON.stringify(args, null, 2);
    return text === "{}" ? undefined : text;
  } catch {
    return undefined;
  }
}
