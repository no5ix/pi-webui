/**
 * The text a reading gesture asks about.
 *
 * A reader double-clicks a word or holds a sentence, and what the gesture means is "this text":
 * the word under the pointer, or the sentence around it. Reading it out of the DOM is a small piece
 * of geometry, and it is kept here, away from the component that draws the answer, so the boundary
 * rules can be read on their own.
 *
 * The geometry has to be composed-tree work. The transcript is drawn by a component, and the
 * document's own answers to "what is at this point" - `caretRangeFromPoint`, `elementFromPoint`,
 * the document selection's range - are retargeted at the shadow host: they name the host, never the
 * paragraph the reader is looking at. `ShadowRoot.elementsFromPoint` and a selection asked of the
 * shadow root are the versions that see inside, so the hit test is built from those plus the rects
 * of the text nodes themselves.
 *
 * Sentences end at the punctuation the transcript's languages use, and at a line break: pi writes
 * markdown, and a markdown paragraph is one block whose sentences a reader holds to translate.
 */

/** What a gesture named: the text, and the box it occupies on screen. */
export interface ReadingTarget {
  readonly text: string;
  readonly rect: ReadingRect;
}

export interface ReadingRect {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

/**
 * The word under a point, for the surfaces where a double-click leaves no selection: a word split
 * across two elements by a plugin's span, a word inside a code span.
 */
export function wordAtPoint(root: Document | ShadowRoot, x: number, y: number): ReadingTarget | undefined {
  const caret = caretAtPoint(root, x, y);
  if (caret === undefined) return undefined;
  const text = caret.node.nodeValue ?? "";
  const bounds = wordBounds(text, caret.offset);
  if (bounds === undefined) return undefined;
  return targetFromNodes([caret.node], text.slice(bounds.start, bounds.end), bounds.start, bounds.end) ?? rectTarget(blockRect(caret.node), text.slice(bounds.start, bounds.end));
}

/**
 * The sentence around a point, inside the block the point falls in.
 *
 * The block is the unit a reader sees as one statement: a paragraph, a list item, a heading, a table
 * cell, a blockquote, a code line. Its text is walked as the text nodes that make it up, so the
 * sentence is found in the same text the reader read, inline formatting included.
 */
export function sentenceAtPoint(root: Document | ShadowRoot, x: number, y: number): ReadingTarget | undefined {
  const caret = caretAtPoint(root, x, y);
  if (caret === undefined) return undefined;
  const block = blockOf(caret.node);
  if (block === undefined) return undefined;
  const walk = collectBlockText(block);
  if (walk.text.trim() === "") return undefined;
  const bounds = sentenceBounds(walk.text, walk.offsetOf(caret.node, caret.offset));
  const text = walk.text.slice(bounds.start, bounds.end).trim();
  if (text === "") return undefined;
  return targetFromNodes(walk.nodes, text, bounds.start, bounds.end) ?? rectTarget(blockRect(block), text);
}

/**
 * The text the reader selected, with its box.
 *
 * The selection is asked of the shadow root first: a selection made inside a component's tree is
 * answered there, and the document's answer names the host with a collapsed, boxless range.
 */
export function selectionTarget(root: Document | ShadowRoot, x: number, y: number): ReadingTarget | undefined {
  const text = selectionText(root, x, y);
  if (text === "") return undefined;
  const range = selectionRange(root, x, y);
  const fromRange = range === undefined ? undefined : targetFromRange(range, text);
  if (fromRange !== undefined) return fromRange;
  const node = textNodeWithText(root, x, y, text);
  if (node === undefined) return undefined;
  const index = (node.nodeValue ?? "").indexOf(text);
  return targetFromNodes([node], text, index, index + text.length) ?? rectTarget(blockRect(node), text);
}

interface Caret {
  readonly node: Text;
  readonly offset: number;
}

/**
 * The text position under a point, inside `root`'s composed tree.
 *
 * The point is resolved to the deepest element - descending through the shadow roots of the hosts
 * the document lists - and then to a character by measuring the element's own text nodes. Measuring
 * is what makes it honest: the browser's caret APIs are not asked, because across a shadow boundary
 * they answer about the host.
 */
function caretAtPoint(root: Document | ShadowRoot, x: number, y: number): Caret | undefined {
  const element = deepestElementAtPoint(root, x, y);
  if (element === undefined) return undefined;
  const inElement = caretInText(textNodesOf(element), x, y);
  if (inElement !== undefined) return inElement;
  const block = blockOf(element);
  if (block === undefined) return undefined;
  return caretInText(textNodesOf(block), x, y) ?? firstTextCaret(block);
}

/** The deepest element of `root`'s composed tree that covers the point. */
function deepestElementAtPoint(root: Document | ShadowRoot, x: number, y: number): Element | undefined {
  const elements = elementsAtPoint(root, x, y);
  for (const element of elements) {
    const nested = element.shadowRoot;
    if (nested === null) return element;
    const inner = deepestElementAtPoint(nested, x, y);
    if (inner !== undefined) return inner;
  }
  return elements[0];
}

function elementsAtPoint(root: Document | ShadowRoot, x: number, y: number): Element[] {
  return Array.from(root.elementsFromPoint(x, y));
}

/** The text nodes of a subtree, in reading order, empty ones dropped. */
function textNodesOf(element: Element): Text[] {
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node instanceof Text && (node.nodeValue ?? "") !== "") nodes.push(node);
  }
  return nodes;
}

/**
 * The character under the point among these text nodes.
 *
 * A text node that wraps covers several line boxes, so the node's own rect is not enough: each line
 * box of each node is tested, and the character is found by measuring the character rects.
 */
function caretInText(nodes: readonly Text[], x: number, y: number): Caret | undefined {
  for (const node of nodes) {
    const document = node.ownerDocument;
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const box of Array.from(range.getClientRects())) {
      if (y >= box.top && y <= box.bottom && x >= box.left - 1 && x <= box.right + 1) return { node, offset: characterOffset(node, x, y) };
    }
  }
  const covering = nodes.find((node) => {
    const box = nodeRect(node);
    return box !== undefined && y >= box.top && y <= box.bottom;
  });
  return covering === undefined ? undefined : { node: covering, offset: characterOffset(covering, x, y) };
}

/**
 * The character under a point.
 *
 * A paragraph of a transcript is one text node of thousands of characters, and a paragraph's text
 * nodes are measured on every gesture, so the character is found by narrowing on the line the point
 * is on and measuring only the handful of characters around it.
 */
function characterOffset(node: Text, x: number, y: number): number {
  const document = node.ownerDocument;
  const length = node.nodeValue?.length ?? 0;
  if (length === 0) return 0;
  const range = document.createRange();
  const boxAt = (index: number): DOMRect => {
    range.setStart(node, index);
    range.setEnd(node, index + 1);
    return range.getBoundingClientRect();
  };
  let low = 0;
  let high = length - 1;
  while (high - low > LINE_NARROWING_STOP) {
    const middle = Math.floor((low + high) / 2);
    const box = boxAt(middle);
    if (box.width === 0 && box.height === 0) {
      low = middle;
      continue;
    }
    if (y < box.top) high = middle;
    else if (y > box.bottom) low = middle;
    else break;
  }
  for (let index = low; index <= Math.min(high + LINE_NARROWING_STOP, length - 1); index += 1) {
    const box = boxAt(index);
    if (box.width === 0 && box.height === 0) continue;
    if (y < box.top - 1 || y > box.bottom + 1) continue;
    if (x < box.left + box.width / 2) return index;
  }
  return length;
}

/** Characters the line narrowing leaves to measure one by one. */
const LINE_NARROWING_STOP = 12;

function firstTextCaret(block: Element): Caret | undefined {
  const nodes = textNodesOf(block);
  const first = nodes[0];
  return first === undefined ? undefined : { node: first, offset: 0 };
}

const BLOCK_SELECTOR = "p, li, h1, h2, h3, h4, h5, h6, pre, td, th, blockquote, summary, .message, .part";

/**
 * The block a node belongs to, climbing the composed tree.
 *
 * A component's tree ends at its shadow root; the block the reader sees may be outside it, so the
 * climb crosses the boundary through the host.
 */
function blockOf(node: Node): HTMLElement | undefined {
  let current: Node | null = node;
  while (current !== null) {
    if (current instanceof HTMLElement && current.matches(BLOCK_SELECTOR)) return current;
    current = composedParent(current);
  }
  return undefined;
}

function composedParent(node: Node): Node | null {
  if (node.parentNode !== null) return node.parentNode;
  if (node instanceof ShadowRoot) return node.host;
  return null;
}

function blockRect(node: Node): ReadingRect | undefined {
  const block = blockOf(node) ?? node.parentElement ?? undefined;
  if (block === undefined) return undefined;
  const box = block.getBoundingClientRect();
  return box.width === 0 && box.height === 0 ? undefined : rectOf(box);
}

/**
 * A block's text as one string, with the nodes that make it up.
 *
 * The reader reads the block as one statement; the DOM stores it as several text nodes split by
 * inline markup. Positions are kept in the whole block's text so a caret in one node names a place
 * in the sentence, and a range is rebuilt from the whole-block position back onto the nodes.
 */
function collectBlockText(block: HTMLElement): {
  readonly text: string;
  readonly nodes: Text[];
  offsetOf: (node: Node, offset: number) => number;
} {
  const nodes = textNodesOf(block);
  const starts: number[] = [];
  let text = "";
  for (const node of nodes) {
    starts.push(text.length);
    text += node.nodeValue ?? "";
  }
  return {
    text,
    nodes,
    offsetOf: (node: Node, offset: number) => {
      const index = nodes.findIndex((candidate) => candidate === node);
      if (index === -1) return 0;
      return Math.min(text.length, (starts[index] ?? 0) + offset);
    },
  };
}

/**
 * The selection's text and range, asked of the tree the selected text lives in.
 *
 * The tree is found from the point the gesture happened at - one hit test, not a walk of the
 * transcript - because a selection inside a component's tree is answered by that tree, and the
 * document's answer names the host with a collapsed, boxless range.
 */
function selectionText(root: Document | ShadowRoot, x: number, y: number): string {
  for (const node of selectionOwners(root, x, y)) {
    const text = shadowSelection(node)?.toString().trim() ?? "";
    if (text !== "") return text;
  }
  return document.getSelection()?.toString().trim() ?? "";
}

function selectionRange(root: Document | ShadowRoot, x: number, y: number): Range | undefined {
  for (const node of selectionOwners(root, x, y)) {
    const selection = shadowSelection(node);
    if (selection === undefined || selection.rangeCount === 0) continue;
    const range = selection.getRangeAt(0);
    if (range.getClientRects().length > 0) return range;
  }
  return undefined;
}

/** The non-standard per-tree selection Chrome answers for a shadow root. */
function shadowSelection(node: Node): Selection | undefined {
  const candidate: unknown = Reflect.get(node, "getSelection");
  if (typeof candidate !== "function") return undefined;
  const answer: unknown = Reflect.apply(candidate, node, [document.getSelection()]);
  return answer instanceof Selection ? answer : undefined;
}

/** The trees a selection at the point can be answered by, innermost first. */
function selectionOwners(root: Document | ShadowRoot, x: number, y: number): Node[] {
  const owners: Node[] = [];
  let node: Node | null = root;
  for (let depth = 0; depth < 6; depth += 1) {
    if (!(node instanceof ShadowRoot || node instanceof Document)) break;
    owners.push(node);
    const element: Element | undefined = node === root ? deepestElementAtPoint(root, x, y) : elementsAtPoint(node, x, y)[0];
    node = element?.shadowRoot ?? null;
  }
  return owners;
}

/** The text node under the point that contains the selected text, so the word's box can be measured. */
function textNodeWithText(root: Document | ShadowRoot, x: number, y: number, text: string): Text | undefined {
  const element = deepestElementAtPoint(root, x, y);
  const scoped = element === undefined ? [] : textNodesOf(blockOf(element) ?? element);
  const withText = scoped.filter((node) => (node.nodeValue ?? "").includes(text));
  const atPoint = caretInText(withText, x, y)?.node;
  return atPoint ?? withText[0];
}

function targetFromNodes(nodes: readonly Text[], text: string, start: number, end: number): ReadingTarget | undefined {
  const span = spanInNodes(nodes, start, end);
  if (span === undefined) return undefined;
  const range = span.node.ownerDocument.createRange();
  range.setStart(span.node, span.start);
  range.setEnd(span.node, span.end);
  return targetFromRange(range, text);
}

/** The whole-block span, cut back to the single text node that covers most of it. */
function spanInNodes(nodes: readonly Text[], start: number, end: number): { node: Text; start: number; end: number } | undefined {
  let position = 0;
  for (const node of nodes) {
    const length = (node.nodeValue ?? "").length;
    const nodeStart = Math.max(start, position);
    const nodeEnd = Math.min(end, position + length);
    if (nodeEnd > nodeStart) return { node, start: nodeStart - position, end: nodeEnd - position };
    position += length;
  }
  return undefined;
}

function targetFromRange(range: Range, text: string): ReadingTarget | undefined {
  const first = range.getClientRects().item(0);
  const box = first ?? range.getBoundingClientRect();
  if (box.width === 0 && box.height === 0) return undefined;
  return { text, rect: rectOf(box) };
}

function rectTarget(rect: ReadingRect | undefined, text: string): ReadingTarget | undefined {
  return rect === undefined ? undefined : { text, rect };
}

function nodeRect(node: Text): ReadingRect | undefined {
  const range = node.ownerDocument.createRange();
  range.selectNodeContents(node);
  const box = range.getBoundingClientRect();
  return box.width === 0 && box.height === 0 ? undefined : rectOf(box);
}

function rectOf(box: DOMRect): ReadingRect {
  return { top: box.top, bottom: box.bottom, left: box.left, right: box.right };
}

/** A word: the run of word characters around the offset, as the transcript's languages write them. */
function wordBounds(text: string, offset: number): { start: number; end: number } | undefined {
  const clamped = Math.min(Math.max(offset, 0), Math.max(text.length - 1, 0));
  const isWord = (character: string) => /[\p{L}\p{N}'’_]/u.test(character);
  if (!isWord(text.charAt(clamped)) && !isWord(text.charAt(clamped - 1))) return undefined;
  let start = clamped;
  while (start > 0 && isWord(text.charAt(start - 1))) start -= 1;
  if (!isWord(text.charAt(start))) start = clamped;
  let end = start;
  while (end < text.length && isWord(text.charAt(end))) end += 1;
  return end > start ? { start, end } : undefined;
}

/**
 * The sentence around an offset in a block's text.
 *
 * The ends are the sentence-final punctuation of the languages the transcript is written in, and
 * the block's own edges. A space before the next sentence's first letter belongs to neither, so the
 * answer is trimmed.
 */
function sentenceBounds(text: string, offset: number): { start: number; end: number } {
  const clamped = Math.min(Math.max(offset, 0), text.length);
  const end = lastSentenceEnd(text, clamped);
  const start = lastSentenceStart(text, clamped);
  return { start, end: end > start ? end : text.length };
}

const SENTENCE_END = /[.!?。！？…]+["')」』）]?\s*$/u;

function lastSentenceEnd(text: string, offset: number): number {
  const tail = text.slice(offset);
  const match = SENTENCE_END.exec(tail);
  if (match === null) return text.length;
  return offset + match.index + match[0].length;
}

function lastSentenceStart(text: string, offset: number): number {
  const head = text.slice(0, offset);
  const matches = [...head.matchAll(/[.!?。！？…]+["')」』）]?(\s|$)/gu)];
  const last = matches[matches.length - 1];
  if (last === undefined) return 0;
  return last.index + last[0].length;
}
