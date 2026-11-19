import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { groupChatMessages, summarizeChatGroup } from "../../../chatGroups";
import type { ChatLine } from "../../../components/shared";
import type { DeferredImageRef } from "../../../../../shared/apiTypes";
import { Icon } from "../common/icons";
import { MessageItem } from "./MessageItem";
import { ToolExecutionCard } from "./ToolExecutionCard";
import { toolRowsOf } from "./toolRows";
import { isGroupOpen, toggleGroup, useConversation } from "../../state/conversationStore";

/**
 * The reading surface.
 *
 * The transcript follows the tail only while the reader is at the tail; a reader
 * who scrolled up keeps their place, and a page of history added above does not
 * move what they are looking at. A prepend is detected by the first row's key, so
 * it is anchored by height, not guessed.
 */
export interface MessageListProps {
  /** The session the transcript belongs to, and its machine: a plugin renderer is told both. */
  machineId: string;
  sessionId: string;
  messages: readonly ChatLine[];
  streaming: boolean;
  /**
   * The stream's connection. An empty transcript while the transcript is still
   * opening, reconnecting, or failed is not an empty conversation, so the
   * "say something" invitation stays hidden until the machine has answered.
   */
  connection: "idle" | "opening" | "live" | "gap" | "closed" | "failed";
  hasOlder: boolean;
  hasNewer: boolean;
  loadingOlder: boolean;
  loadingNewer: boolean;
  wide: boolean;
  onOlder: () => void;
  onNewer: () => void;
  imagePathFor?: ((ref: DeferredImageRef) => string | undefined) | undefined;
  onInsertPrompt?: ((text: string) => void) | undefined;
}

function answered(connection: MessageListProps["connection"]): boolean {
  return connection === "live" || connection === "gap" || connection === "closed";
}

const bottomThreshold = 64;

export function MessageList(props: MessageListProps): ReactNode {
  const scroller = useRef<HTMLDivElement | null>(null);
  const anchor = useRef({ firstKey: "", height: 0 });
  const seen = useRef(props.messages.length);
  const [atBottom, setAtBottom] = useState(true);
  const [outside, setOutside] = useState(0);
  const conversation = useConversation();

  const groups = useMemo(() => groupChatMessages([...props.messages]), [props.messages]);
  const firstKey = firstKeyOf(groups);

  useEffect(() => {
    const node = scroller.current;
    if (node === null) return;
    const previous = anchor.current;
    if (previous.firstKey !== "" && previous.firstKey !== firstKey) {
      const added = node.scrollHeight - previous.height;
      if (added > 0) node.scrollTop += added;
    }
    anchor.current = { firstKey, height: node.scrollHeight };
  }, [firstKey, groups]);

  useEffect(() => {
    const node = scroller.current;
    if (node === null) return;
    const arrived = props.messages.length - seen.current;
    seen.current = props.messages.length;
    if (atBottom) {
      node.scrollTop = node.scrollHeight;
      return;
    }
    if (arrived > 0) setOutside((count) => count + arrived);
  }, [atBottom, groups, props.messages.length]);

  const onScroll = (): void => {
    const node = scroller.current;
    if (node === null) return;
    const bottom = node.scrollHeight - node.scrollTop - node.clientHeight < bottomThreshold;
    if (bottom !== atBottom) {
      setAtBottom(bottom);
      if (bottom) setOutside(0);
    }
    if (node.scrollTop < bottomThreshold && props.hasOlder && !props.loadingOlder) props.onOlder();
    if (bottom && props.hasNewer && !props.loadingNewer) props.onNewer();
  };

  return (
    <div className="piw-transcript-wrap">
      <div
        className={props.wide ? "piw-transcript piw-transcript--wide" : "piw-transcript"}
        onScroll={onScroll}
        ref={scroller}
        role="log"
      >
        {props.loadingOlder ? <div className="piw-skeleton piw-skeleton--row">Loading older messages…</div> : null}
        {groups.length === 0 && answered(props.connection) ? <div className="piw-empty">No messages yet. Say something below.</div> : null}
        {groups.map((group) => {
          if (group.kind === "group") {
            const key = `group-${String(group.startIndex)}-${keyOfGroup(group.messages[0], group.startIndex)}`;
            const rows = toolRowsOf(group.messages, props.streaming);
            const summary = summarizeChatGroup(group.messages);
            const open = isGroupOpen(conversation, key);
            if (rows.length > 0) {
              return (
                <ToolExecutionCard
                  key={key}
                  machineId={props.machineId}
                  onToggle={() => { toggleGroup(key); }}
                  open={open}
                  rows={rows}
                  streaming={props.streaming}
                  summary={summary}
                />
              );
            }
            return (
              <section className="piw-card" key={key}>
                <button aria-expanded={open} className="piw-card__header" onClick={() => { toggleGroup(key); }} type="button">
                  <Icon label="" name="list" size="small" />
                  <span className="piw-card__title">{summary}</span>
                  <Icon label="" name={open ? "chevronUp" : "chevronDown"} size="small" />
                </button>
                {open ? (
                  <div className="piw-card__body">
                    {group.messages.map((message, inner) => (
                      <MessageItem
                        key={`${key}-${String(inner)}`}
                        imagePathFor={props.imagePathFor}
                        line={message}
                        machineId={props.machineId}
                        onInsertPrompt={props.onInsertPrompt}
                        sessionId={props.sessionId}
                        streaming={props.streaming}
                      />
                    ))}
                  </div>
                ) : null}
              </section>
            );
          }
          return (
            <MessageItem
              key={`row-${String(group.index)}-${keyOfGroup(group.message, group.index)}`}
              imagePathFor={props.imagePathFor}
              line={group.message}
              machineId={props.machineId}
              onInsertPrompt={props.onInsertPrompt}
              sessionId={props.sessionId}
              streaming={props.streaming}
            />
          );
        })}
        {props.loadingNewer ? <div className="piw-skeleton piw-skeleton--row">Loading newer messages…</div> : null}
      </div>
      {atBottom ? null : (
        <button className="piw-jump" onClick={() => {
          const node = scroller.current;
          if (node === null) return;
          node.scrollTop = node.scrollHeight;
          setAtBottom(true);
          setOutside(0);
        }} type="button">
          <Icon label="" name="chevronDown" size="small" />
          <span>Jump to latest</span>
          {outside > 0 ? <span className="piw-badge">{String(outside)}</span> : null}
        </button>
      )}
    </div>
  );
}

function firstKeyOf(groups: ReturnType<typeof groupChatMessages>): string {
  const first = groups[0];
  if (first === undefined) return "";
  return first.kind === "group" ? keyOfGroup(first.messages[0], 0) : keyOfGroup(first.message, 0);
}

function keyOfGroup(line: ChatLine | undefined, index: number): string {
  if (line === undefined) return "";
  const meta = line.meta;
  return `${meta?.entryId ?? ""}|${meta?.responseId ?? ""}|${meta?.timestamp ?? ""}|${line.role}|${String(index)}`;
}
