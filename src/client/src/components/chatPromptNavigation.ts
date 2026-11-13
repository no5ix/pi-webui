/**
 * Stepping between the prompts the reader sent.
 *
 * A long task is a long column, and the reader's own prompts are the places worth returning to: the
 * question they asked, the correction they gave. The jump-to-bottom control answers "where is the
 * newest", and nothing answered "the last thing I asked" - so the transcript gets the two edges of
 * that list, up and down.
 *
 * The decision is a pure function over the anchors' offsets and where the window sits, so the boundary
 * rules are testable and the component stays a dumb executor: it reads the offsets, asks which anchor
 * the step lands on, and scrolls.
 *
 * The boundaries are honest, not clever. At the first prompt, up goes nowhere; the reader is already at
 * the oldest prompt this transcript has, and sliding the view somewhere else would read as a bug. Past
 * the last prompt, down goes to the newest message, because that is what "further" means there.
 */
export interface PromptViewport {
  /** The scroller's offset from the top of the transcript. */
  readonly top: number;
  /** The scroller's offset at its bottom edge. */
  readonly bottom: number;
}

export interface PromptStepTargets {
  /** The anchor above the current one, or `undefined` at the oldest prompt. */
  readonly previous: number | undefined;
  /** The anchor below the current one, or `undefined` past the newest prompt - where the caller goes to the bottom. */
  readonly next: number | undefined;
}

/**
 * The two anchors a step can land on.
 *
 * The anchor the reader is on is the last prompt that starts at or above the top of the window, so a
 * step up from the middle of a long reply lands on the prompt that asked for it, and a second step up
 * lands on the prompt before that. `tolerance` keeps a prompt sitting exactly on the top edge from
 * counting as the next one when stepping down, which is what makes repeated presses page steadily
 * instead of sticking.
 */
export function promptStepTargets(anchors: readonly number[], viewport: PromptViewport, tolerance = 8): PromptStepTargets {
  if (anchors.length === 0) return { previous: undefined, next: undefined };
  const edge = viewport.top + tolerance;
  let current = -1;
  for (let index = 0; index < anchors.length; index += 1) {
    const anchor = anchors[index] ?? Number.NaN;
    if (anchor <= edge) current = index;
    else break;
  }
  return {
    previous: current > 0 ? anchors[current - 1] : undefined,
    next: current + 1 < anchors.length ? anchors[current + 1] : undefined,
  };
}

/** Two prompts are worth a control; one prompt has nowhere to step. */
export function showsPromptNavigation(promptCount: number): boolean {
  return promptCount >= 2;
}
