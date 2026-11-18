import { isRecord } from "../../../../shared/unknownValues";
import { createStore, useStoreSelect, type Store } from "./store";

/**
 * What the reader has opened in the transcript.
 *
 * A collapsed tool group, an open card, a wide measure: these are reading
 * choices, not application facts, so they live in the React layer and are
 * remembered per session. Nothing here is a second copy of a server fact.
 */
export type ConversationCard = "subagents" | "background" | "editedFiles";
export type TranscriptWidth = "measure" | "wide";

export interface ConversationState {
  readonly cards: Readonly<Record<string, boolean>>;
  readonly groups: Readonly<Record<string, boolean>>;
  readonly tools: Readonly<Record<string, boolean>>;
  readonly width: TranscriptWidth;
}

const storageKey = "pi-web-react:conversation:v1";
const defaults: ConversationState = { cards: {}, groups: {}, tools: {}, width: "measure" };

function readStored(): ConversationState {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? "null");
    if (!isRecord(parsed)) return defaults;
    return {
      cards: flags(parsed["cards"]),
      groups: flags(parsed["groups"]),
      tools: flags(parsed["tools"]),
      width: parsed["width"] === "wide" ? "wide" : "measure",
    };
  } catch {
    return defaults;
  }
}

function flags(value: unknown): Record<string, boolean> {
  if (!isRecord(value)) return {};
  const opened: Record<string, boolean> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === true) opened[key] = true;
  }
  return opened;
}

function persist(state: ConversationState): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    return;
  }
}

export const conversationStore: Store<ConversationState> = createStore<ConversationState>(readStored());

export function useConversation(): ConversationState {
  return useStoreSelect(conversationStore, (value) => value);
}

export function isCardOpen(state: ConversationState, card: ConversationCard): boolean {
  return state.cards[card] === true;
}

export function toggleCard(card: ConversationCard): void {
  conversationStore.update((current) => {
    const next = { ...current, cards: { ...current.cards, [card]: current.cards[card] !== true } };
    persist(next);
    return next;
  });
}

export function isGroupOpen(state: ConversationState, key: string): boolean {
  return state.groups[key] === true;
}

export function toggleGroup(key: string): void {
  conversationStore.update((current) => {
    const next = { ...current, groups: { ...current.groups, [key]: current.groups[key] !== true } };
    persist(next);
    return next;
  });
}



export function setTranscriptWidth(width: TranscriptWidth): void {
  conversationStore.update((current) => {
    const next = { ...current, width };
    persist(next);
    return next;
  });
}
