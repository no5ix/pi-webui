import { describe, expect, it } from "vitest";
import { settledRunDurationMs } from "./piSessionService";

/** A session that has settled, with the transcript's two stamps, two minutes apart. */
function settled(over: Partial<Parameters<typeof settledRunDurationMs>[0]> = {}) {
  return {
    startedAt: "2026-03-01T10:00:00.000Z",
    endedAt: "2026-03-01T10:02:05.000Z",
    working: false,
    runOpen: false,
    queued: false,
    asking: false,
    backgroundRuns: false,
    ...over,
  };
}

describe("the task span the session daemon publishes", () => {
  it("measures the task from the prompt to the last entry", () => {
    expect(settledRunDurationMs(settled())).toBe(125_000);
  });

  it("publishes nothing while the session is still working", () => {
    // A span that is still growing is not an answer to "how long did that take", and the status line
    // would show a number that changes every frame.
    expect(settledRunDurationMs(settled({ working: true }))).toBeUndefined();
  });

  it("publishes nothing for a run the daemon still holds open", () => {
    expect(settledRunDurationMs(settled({ runOpen: true }))).toBeUndefined();
  });

  it("publishes nothing while a prompt waits in the queue", () => {
    // What the reader asked for has not finished; reporting the span of the part that did is how a
    // task that queued a follow-up reads as over.
    expect(settledRunDurationMs(settled({ queued: true }))).toBeUndefined();
  });

  it("publishes nothing while a question waits for the reader", () => {
    expect(settledRunDurationMs(settled({ asking: true }))).toBeUndefined();
  });

  it("publishes nothing while a background run outlives its turn", () => {
    expect(settledRunDurationMs(settled({ backgroundRuns: true }))).toBeUndefined();
  });

  it("publishes nothing when either stamp is missing", () => {
    expect(settledRunDurationMs(settled({ startedAt: undefined }))).toBeUndefined();
    expect(settledRunDurationMs(settled({ endedAt: undefined }))).toBeUndefined();
  });

  it("publishes nothing when the stamps are not in order", () => {
    // A branch rewritten under the session can put the end before the start; a negative duration in a
    // notification is worse than no duration.
    expect(settledRunDurationMs(settled({ endedAt: "2026-03-01T09:59:00.000Z" }))).toBeUndefined();
  });

  it("publishes nothing for stamps that are not timestamps", () => {
    expect(settledRunDurationMs(settled({ startedAt: "tomorrow" }))).toBeUndefined();
  });
});
