import type { ReadingAction, ReadingAnchor, ReadingSurface } from "../components/ReadingToolbar";
import { LongPressTracker } from "../longPress";
import { selectionTarget, sentenceAtPoint, wordAtPoint } from "./readingTarget";
import { writeClipboardText } from "../clipboard";

/**
 * The reading gestures over a transcript, and what they answer with.
 *
 * A userscript did this outside PI WEB, in a page it did not own, and stopped working here: the
 * transcript is rendered by a component, and a userscript's listeners cannot reach what a shadow
 * root draws. So the gestures live with the transcript.
 *
 * Two of them, because they answer two different questions:
 *
 * - **Double-click a word** - a pill of Copy / Search / Translate appears over it, for the reader
 *   who stopped on one word.
 * - **Hold a sentence** (mouse left button, or a finger) - its translation is written under the
 *   sentence, in the quiet grey of an annotation, for the reader who wants the sense of a passage
 *   without leaving it.
 *
 * The hold reuses the list's long-press state machine, so the same tolerance applies: 500 ms, and a
 * pointer that drifts more than ten pixels is a scroll. Scrolling, a new gesture, or Escape leaves
 * the surface: the answer is anchored in viewport coordinates, so a transcript that moves under it
 * makes the answer go rather than point at the wrong sentence.
 */
export interface ReadingToolsDeps {
  /** The element the gestures are watched on: the transcript scroller. */
  readonly scroller: HTMLElement;
  /** The tree the pointer falls in - the transcript's shadow root. */
  readonly root: ShadowRoot | Document;
  /** Presents a surface, and takes it away. Both are cheap: the host re-renders one element. */
  show: (surface: ReadingSurface) => void;
  hide: () => void;
  /** Asks for `text` in `to`; rejects with the sentence to show when no answer came. */
  translate: (text: string, to: string) => Promise<string>;
  /** The language to translate into; asked once per session, since a deployment sets it in config. */
  language: () => Promise<string>;
  /** Opens a web search for the text. */
  search: (text: string) => void;
}

export interface ReadingTools {
  /** Runs the pill's button, on the surface the button was drawn for. */
  perform(action: ReadingAction, surface: ReadingSurface): void;
  /** Takes the surface away, and abandons a translation still on its way. */
  close(): void;
  dispose(): void;
}

export function attachReadingTools(deps: ReadingToolsDeps): ReadingTools {
  const state: ReadingState = { surface: undefined, requestId: 0 };
  let lastPoint: { x: number; y: number } | undefined;

  const hold = new LongPressTracker({
    onLongPress: () => {
      const point = lastPoint;
      if (point === undefined) return;
      const target = sentenceAtPoint(deps.root, point.x, point.y);
      if (target === undefined) return;
      void presentTranslation(state, deps, target.text, target.rect);
    },
    setTimer: (callback, ms) => window.setTimeout(callback, ms),
    clearTimer: (handle) => { window.clearTimeout(handle); },
  });

  const onDoubleClick = (event: MouseEvent) => {
    const target = selectionTarget(deps.root, event.clientX, event.clientY) ?? wordAtPoint(deps.root, event.clientX, event.clientY);
    if (target === undefined) return;
    const surface: ReadingSurface = { mode: "toolbar", text: target.text, anchor: target.rect };
    state.surface = surface;
    deps.show(surface);
  };
  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    lastPoint = { x: event.clientX, y: event.clientY };
    close();
    hold.start({ clientX: event.clientX, clientY: event.clientY });
  };
  const onPointerMove = (event: PointerEvent) => { hold.move({ clientX: event.clientX, clientY: event.clientY }); };
  const onPointerUp = (event: PointerEvent) => {
    if (hold.consumeSuppressedClick()) event.preventDefault();
    hold.cancel();
  };
  const onScrollAway = () => { if (state.surface !== undefined) close(); };
  // The scroll is watched in the capture phase on the tree, not on the scroller element: the
  // template replaces that element when the page changes, and a scroll event does not bubble, so a
  // listener welded to one element stops answering the moment the transcript is re-rendered.
  const scrollOptions = { passive: true, capture: true } as const;
  // Escape is watched on the document: the scroller is not a focusable element, and a keydown
  // listener on an element that never takes focus answers nothing.
  const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape" && state.surface !== undefined) close(); };

  function close(): void {
    state.requestId += 1;
    state.surface = undefined;
    deps.hide();
  }

  function perform(action: ReadingAction, drawn: ReadingSurface): void {
    const surface = drawn;
    if (action === "copy") {
      void writeClipboardText(surface.text).then((written) => {
        if (written) return;
        const refused: ReadingSurface = { ...surface, translation: { state: "failed", message: "The browser would not let this page copy the text." } };
        if (state.surface?.mode !== surface.mode || state.surface.text !== surface.text) return;
        state.surface = refused;
        deps.show(refused);
      });
      return;
    }
    if (action === "search") {
      deps.search(surface.text);
      return;
    }
    void presentTranslation(state, deps, surface.text, surface.anchor);
  }

  deps.scroller.addEventListener("dblclick", onDoubleClick);
  deps.scroller.addEventListener("pointerdown", onPointerDown);
  deps.scroller.addEventListener("pointermove", onPointerMove);
  deps.scroller.addEventListener("pointerup", onPointerUp);
  deps.scroller.addEventListener("pointercancel", onPointerUp);
  scrollRoot(deps).addEventListener("scroll", onScrollAway, scrollOptions);
  deps.scroller.ownerDocument.addEventListener("keydown", onKeyDown, true);

  return { perform, close, dispose: () => {
    deps.scroller.removeEventListener("dblclick", onDoubleClick);
    deps.scroller.removeEventListener("pointerdown", onPointerDown);
    deps.scroller.removeEventListener("pointermove", onPointerMove);
    deps.scroller.removeEventListener("pointerup", onPointerUp);
    deps.scroller.removeEventListener("pointercancel", onPointerUp);
    scrollRoot(deps).removeEventListener("scroll", onScrollAway, scrollOptions);
    deps.scroller.ownerDocument.removeEventListener("keydown", onKeyDown, true);
    hold.cancel();
  } };
}

/** The tree the scroll is watched on: the transcript's scroller is replaced by the template. */
function scrollRoot(deps: ReadingToolsDeps): Node {
  return deps.scroller.getRootNode();
}

/** What the host is showing, and the request that may still be on its way. */
interface ReadingState {
  surface: ReadingSurface | undefined;
  requestId: number;
}

async function presentTranslation(state: ReadingState, deps: ReadingToolsDeps, text: string, anchor: ReadingAnchor): Promise<void> {
  state.requestId += 1;
  const requestId = state.requestId;
  const pending: ReadingSurface = { mode: "translation", text, anchor, translation: { state: "pending" } };
  state.surface = pending;
  deps.show(pending);
  const translation = await translateOnce(deps, text);
  if (state.requestId !== requestId) return;
  state.surface = { ...pending, translation };
  deps.show(state.surface);
}

async function translateOnce(deps: ReadingToolsDeps, text: string): Promise<NonNullable<ReadingSurface["translation"]>> {
  try {
    const language = await deps.language();
    return { state: "ready", text: await deps.translate(text, language) };
  } catch (error: unknown) {
    return { state: "failed", message: error instanceof Error && error.message !== "" ? error.message : "Translation did not answer." };
  }
}
