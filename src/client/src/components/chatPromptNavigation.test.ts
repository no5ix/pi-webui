import { describe, expect, it } from "vitest";
import { promptStepTargets, showsPromptNavigation } from "./chatPromptNavigation";

const ANCHORS = [0, 400, 900, 1_600];
const viewport = (top: number, height = 600) => ({ top, bottom: top + height });

describe("stepping between prompts", () => {
  it("steps to the prompt before the one the reader is on", () => {
    expect(promptStepTargets(ANCHORS, viewport(900)).previous).toBe(400);
    // Mid-reply at 1200: the prompt the reader is reading the answer to is the one at 900, and the step
    // up goes to the prompt before it.
    expect(promptStepTargets(ANCHORS, viewport(1_200)).previous).toBe(400);
  });

  it("steps to the next prompt below", () => {
    expect(promptStepTargets(ANCHORS, viewport(0)).next).toBe(400);
    expect(promptStepTargets(ANCHORS, viewport(900)).next).toBe(1_600);
  });

  it("steps steadily down the list, the second press not sticking to the first", () => {
    // The view lands on the anchor, so the next press starts with that anchor on the top edge. Without
    // the tolerance the press would find the same anchor and go nowhere, and the control would read as
    // the transcript not answering.
    const first = promptStepTargets(ANCHORS, viewport(0)).next;
    const second = promptStepTargets(ANCHORS, viewport(first ?? 0)).next;
    expect(second).toBe(900);
  });

  it("has nothing above the first prompt", () => {
    // The reader is at the oldest prompt this transcript holds. Moving the view somewhere else would
    // read as a bug, so the boundary is a no-op.
    expect(promptStepTargets(ANCHORS, viewport(0)).previous).toBeUndefined();
    expect(promptStepTargets(ANCHORS, viewport(40)).previous).toBeUndefined();
  });

  it("has nothing below the last prompt, which is where the caller goes to the newest message", () => {
    expect(promptStepTargets(ANCHORS, viewport(1_600)).next).toBeUndefined();
    expect(promptStepTargets(ANCHORS, viewport(2_000)).next).toBeUndefined();
  });

  it("answers for a transcript with one prompt", () => {
    // Down from above the only prompt goes to it; there is nothing above it to go to.
    expect(promptStepTargets([120], viewport(0))).toEqual({ previous: undefined, next: 120 });
    expect(promptStepTargets([120], viewport(120))).toEqual({ previous: undefined, next: undefined });
  });

  it("answers for a transcript with no prompts", () => {
    expect(promptStepTargets([], viewport(0))).toEqual({ previous: undefined, next: undefined });
  });

  it("finds the first prompt when the reader is above every prompt", () => {
    expect(promptStepTargets([500, 900], viewport(0)).next).toBe(500);
  });
});

describe("when the steppers are worth drawing", () => {
  it("appears with two prompts, and not with one", () => {
    expect(showsPromptNavigation(0)).toBe(false);
    expect(showsPromptNavigation(1)).toBe(false);
    expect(showsPromptNavigation(2)).toBe(true);
  });
});
