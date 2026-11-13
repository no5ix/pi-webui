/**
 * Where the conversation's own structure says to jump.
 *
 * Two questions a reader of a long transcript asks with a thumb: "what did I last ask?" and "what did
 * it answer?". Both are answered by the transcript's rows - a user message and an assistant response -
 * and by nothing to do with pixels. A fixed scroll distance is a guess: it lands in the middle of a
 * tool call, or three screens short of a reply, and on a transcript that loads in pages it lands
 * where the page happened to be.
 *
 * The rows are what the page is showing: a transcript window that moved up to load older messages
 * offers the rows it holds, and the row that is being written now is an assistant response like any
 * other. A thinking block, a tool call, a shell row, a command row and an extension notice are
 * execution, not the conversation, and are skipped: the reader wants the sentence, not the trace.
 */

/** What a row is, as far as navigation cares. Execution rows are "other" and are passed over. */
export type ConversationRole = "user" | "assistant" | "other";

export interface ConversationRow {
  /** The transcript's own index for the row, the one its element carries as `data-index`. */
  readonly index: number;
  readonly role: ConversationRole;
}

/**
 * The most recent user prompt at or above the reading position.
 *
 * Standing on the start of a user message and asking for the most recent one means the one before it:
 * a button that keeps going to the same place is a button that stopped working. A reading position
 * inside a user message counts as standing on it.
 */
export function latestUserPrompt(rows: readonly ConversationRow[], readingIndex: number): number | undefined {
  let found: number | undefined;
  for (const row of rows) {
    if (row.role !== "user") continue;
    if (row.index < readingIndex) found = row.index;
    else break;
  }
  return found;
}

/**
 * The next assistant response below the reading position.
 *
 * Tool calls, thinking blocks, shell and command rows and notices are skipped: an assistant response
 * is the row that carries the answer. A response that is still being written counts, because a reader
 * who asks "what is it saying?" wants to be looking at it while it grows.
 */
export function nextAssistantResponse(rows: readonly ConversationRow[], readingIndex: number): number | undefined {
  for (const row of rows) {
    if (row.index <= readingIndex) continue;
    if (row.role === "assistant") return row.index;
  }
  return undefined;
}

/** Whether there is anything below to jump to. The control says so instead of doing nothing. */
export function hasAssistantResponseAfter(rows: readonly ConversationRow[], readingIndex: number): boolean {
  return nextAssistantResponse(rows, readingIndex) !== undefined;
}

/**
 * The rows the page is showing, in transcript order.
 *
 * An element with no usable index is left out rather than guessed at, and duplicates collapse: the
 * page can show the same row twice across a page boundary, and a navigation target that appears twice
 * is one target.
 */
export function conversationRows(rows: readonly { index: unknown; role: ConversationRole }[]): ConversationRow[] {
  const seen = new Set<number>();
  const out: ConversationRow[] = [];
  for (const row of rows) {
    const index = typeof row.index === "number" ? row.index : Number(row.index);
    if (!Number.isFinite(index) || index < 0) continue;
    if (seen.has(index)) continue;
    seen.add(index);
    out.push({ index, role: row.role });
  }
  return out.sort((a, b) => a.index - b.index);
}

/**
 * A row's role, from the class the transcript gives it.
 *
 * The transcript names a row's role in its classes, and a tool-only row is a shell, not a message: a
 * tool call carries no answer, and jumping to one is how a reader ends up staring at a diff.
 */
export function conversationRole(classes: readonly string[]): ConversationRole {
  if (classes.includes("tool-execution-shell")) return "other";
  if (classes.includes("user")) return "user";
  if (classes.includes("assistant")) return "assistant";
  return "other";
}
