// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { StatusBar, runTimeOf, type RunTime } from "./StatusBar";
import type { SessionStatus } from "../api";
import type { FinishedTurn } from "../turnRunClock";

function status(over: Partial<SessionStatus> = {}): SessionStatus {
  return {
    sessionId: "s",
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    pendingMessageCount: 0,
    queuedMessages: [],
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
    ...over,
  };
}

const deviceTurn: FinishedTurn = { finishedAt: 126_000, durationMs: 125_000, partial: false };

afterEach(() => { document.body.replaceChildren(); });

describe("the duration the status line shows", () => {
  it("prefers the server's span of the whole task over what this browser watched", () => {
    // The daemon measures from the prompt the reader sent to the last entry; a device can only measure
    // what it was open for, and a page that joined a two-hour task late must not report two minutes.
    const runTime = runTimeOf(status({ lastRunDurationMs: 7_200_000 }), deviceTurn);
    expect(runTime).toEqual({ source: "server", durationMs: 7_200_000 });
  });

  it("falls back to this device's clock for a daemon that publishes no span", () => {
    expect(runTimeOf(status(), deviceTurn)).toEqual({ source: "device", durationMs: 125_000 });
  });

  it("says nothing when neither side has a number", () => {
    expect(runTimeOf(status(), undefined)).toBeUndefined();
  });

  it("ignores a span that is not a number", () => {
    expect(runTimeOf(status({ lastRunDurationMs: Number.NaN }), deviceTurn)).toEqual({ source: "device", durationMs: 125_000 });
    expect(runTimeOf(status({ lastRunDurationMs: -1 }), deviceTurn)).toEqual({ source: "device", durationMs: 125_000 });
  });

  it("keeps a partial watch marked as partial", () => {
    const runTime = runTimeOf(status(), { ...deviceTurn, partial: true });
    expect(runTime?.partial).toBe(true);
  });});

describe("the status line at a narrow width", () => {
  // The bar carries facts - tokens, context, branch, duration, extensions, cost - and a bar that clips
  // one of them leaves the reader with a number whose meaning got cut. It grows to more lines instead.
  async function render(statusValue: SessionStatus): Promise<HTMLElement> {
    const bar = new StatusBar();
    bar.status = statusValue;
    bar.lastRun = deviceTurn;
    document.body.append(bar);
    await bar.updateComplete;
    const row = bar.renderRoot.querySelector<HTMLElement>(".bar");
    if (row === null) throw new Error("the status bar rendered no row");
    return row;
  }

  /** The row that carries the duration, with the sentence about where the number came from. */
  function timeRow(bar: HTMLElement): HTMLElement {
    const row = bar.querySelector<HTMLElement>(".run-time");
    if (row === null) throw new Error("the status bar rendered no duration");
    return row;
  }

  it("keeps every value in the bar, and lets them wrap", async () => {
    const bar = await render(status({
      gitBranch: "feature/a-very-long-branch-name-for-a-task",
      lastRunDurationMs: 7_200_000,
      contextUsage: { contextWindow: 262_144, percent: 29.3, tokens: 76_800 },
      extensionUi: { statuses: [{ key: "review", text: "review 3/9" }] },
    }));
    const values = bar.textContent.replace(/\s+/gu, " ");
    expect(values).toContain("ctx 29.3% of 262k");
    expect(values).toContain("feature/a-very-long-branch-name-for-a-task");
    expect(values).toContain("took 2h 0m");
    expect(values).toContain("review 3/9");
    expect(values).toContain("0 tok");
  });

  it("says where a number came from, in the words the reader can check", async () => {
    const bar = await render(status({ lastRunDurationMs: 7_200_000 }));
    const title = timeRow(bar).title;
    expect(title).toContain("2h 0m");
    expect(title).toContain("measured by the server");
  });

  it("names the device when the number is the device's own", async () => {
    const bar = await render(status());
    expect(timeRow(bar).title).toContain("this device");
  });

  it("says a watched span is only part of the task", async () => {
    const bar = new StatusBar();
    bar.status = status();
    bar.lastRun = { ...deviceTurn, partial: true };
    document.body.append(bar);
    await bar.updateComplete;
    const row = bar.renderRoot.querySelector<HTMLElement>(".bar");
    if (row === null) throw new Error("the status bar rendered no row");
    expect(timeRow(row).title).toContain("watched");
    expect(timeRow(row).title).toContain("already running");
  });

  it("has no ellipsis anywhere in the bar's styles", () => {
    // The rule the owner set: wrap, do not cut. A `text-overflow: ellipsis` in this component is the
    // regression returning.
    const css = String(StatusBar.styles);
    expect(css).not.toContain("text-overflow");
    expect(css).toContain("flex-wrap: wrap");
  });
});

/** A `RunTime` is what the bar renders; the type is asserted here so a change to its shape is visible. */
describe("the shape of a run time", () => {
  it("names its source", () => {
    const runTime: RunTime = { source: "server", durationMs: 1 };
    expect(runTime.source).toBe("server");
  });
});
