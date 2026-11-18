import { useMemo, type ReactNode } from "react";
import type { SessionInfo, SessionStatus } from "../../../../../shared/apiTypes";
import { isRecord } from "../../../../../shared/unknownValues";
import type { ChatLine } from "../../../components/shared";
import { useBoard } from "../../state/board";
import { useSelection, selectSession } from "../../state/selection";
import { Icon } from "../common/icons";
import type { ConversationCard } from "../../state/conversationStore";

/**
 * The three cards above the composer.
 *
 * Each one is derived from data the machine already sends: child sessions from
 * the board (a session whose parent is this one), the running background count
 * the session status carries, and the files the transcript's own tool calls
 * changed. Nothing is invented when a source has nothing to say; the card states
 * what is missing.
 */
export interface TranscriptCardsProps {
  messages: readonly ChatLine[];
  sessionInfo: SessionInfo | undefined;
  status: SessionStatus | undefined;
  open: Record<ConversationCard, boolean>;
  onToggle: (card: ConversationCard) => void;
}

export function TranscriptCards(props: TranscriptCardsProps): ReactNode {
  const board = useBoard();
  const selection = useSelection();
  const children = useMemo(
    () => (props.sessionInfo === undefined ? [] : board.board?.sessions.filter((session) => session.parentSessionPath === props.sessionInfo?.path) ?? []),
    [board.board, props.sessionInfo],
  );
  const edited = useMemo(() => editedFilesOf(props.messages), [props.messages]);
  const backgroundCount = props.status?.backgroundRunCount;

  return (
    <div className="piw-transcript-cards">
      {children.length === 0 ? null : (
        <Card card="subagents" count={children.length} label="Subagents" onToggle={props.onToggle} open={props.open.subagents}>
          <ul className="piw-card__list">
            {children.map((child) => (
              <li key={child.id}>
                <button
                  className="piw-row"
                  onClick={() =>{ selectSession({
                      machineId: selection.machineId,
                      ...(selection.projectId === undefined ? {} : { projectId: selection.projectId }),
                      sessionId: child.id,
                    }); }}
                  type="button"
                >
                  <Icon label="" name="bot" size="small" />
                  <span className="piw-row__title" dir="auto">{child.name ?? child.firstMessage}</span>
                  <span className="piw-row__meta">{String(child.messageCount)}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {backgroundCount === undefined || backgroundCount === 0 ? null : (
        <Card card="background" count={backgroundCount} label="Background" onToggle={props.onToggle} open={props.open.background}>
          <p className="piw-card__note">The machine reports {String(backgroundCount)} background {backgroundCount === 1 ? "run" : "runs"} for this session. It does not send their output on this channel; open the terminal to read them.</p>
        </Card>
      )}

      {edited.length === 0 ? null : (
        <Card card="editedFiles" count={edited.length} label="Edited Files" onToggle={props.onToggle} open={props.open.editedFiles}>
          <ul className="piw-card__list">
            {edited.map((file) => (
              <li key={file.path}>
                <button
                  className="piw-row"
                  onClick={() => window.dispatchEvent(new CustomEvent("pi-web-open-file", { detail: { path: file.path } }))}
                  type="button"
                >
                  <Icon label="" name="fileCode" size="small" />
                  <span className="piw-row__title piw-mono" dir="auto">{file.path}</span>
                  <span className="piw-row__meta">{`+${String(file.added)} -${String(file.removed)}`}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function Card(props: { card: ConversationCard; label: string; count: number; open: boolean; onToggle(card: ConversationCard): void; children: ReactNode }): ReactNode {
  return (
    <section className="piw-card">
      <button aria-expanded={props.open} className="piw-card__header" onClick={() => { props.onToggle(props.card); }} type="button">
        <span className="piw-card__title">{`${props.label} (${String(props.count)})`}</span>
        <span className="piw-card__spacer" />
        <Icon label="" name={props.open ? "chevronUp" : "chevronDown"} size="small" />
      </button>
      {props.open ? <div className="piw-card__body">{props.children}</div> : null}
    </section>
  );
}

export interface EditedFile {
  path: string;
  added: number;
  removed: number;
}

export function editedFilesOf(messages: readonly ChatLine[]): EditedFile[] {
  const byPath = new Map<string, EditedFile>();
  for (const line of messages) {
    for (const part of line.parts) {
      if (part.type !== "toolCall" && part.type !== "toolExecution" && part.type !== "toolResult") continue;
      const args = part.type === "toolCall" ? part.args : part.type === "toolExecution" ? part.preview : undefined;
      const path = pathOf(args);
      if (path === undefined) continue;
      const counts = diffCounts(part.type === "toolExecution" ? part.preview?.diff : undefined);
      const existing = byPath.get(path);
      byPath.set(path, { path, added: (existing?.added ?? 0) + counts.added, removed: (existing?.removed ?? 0) + counts.removed });
    }
  }
  return [...byPath.values()];
}

function pathOf(args: unknown): string | undefined {
  if (!isRecord(args)) return undefined;
  const path = args["path"] ?? args["file_path"] ?? args["filePath"];
  return typeof path === "string" && path !== "" ? path : undefined;
}

function diffCounts(diff: string | undefined): { added: number; removed: number } {
  if (diff === undefined) return { added: 0, removed: 0 };
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) added += 1;
    if (line.startsWith("-") && !line.startsWith("---")) removed += 1;
  }
  return { added, removed };
}
