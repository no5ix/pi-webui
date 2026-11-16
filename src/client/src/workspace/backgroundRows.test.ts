import { describe, expect, it } from "vitest";
import type { SessionActivity, SessionStatus } from "../api";
import { backgroundRows } from "./backgroundRows.js";

const status = (overrides: Partial<SessionStatus> = {}): SessionStatus => ({
  sessionId: "s1",
  isStreaming: false,
  isCompacting: false,
  isBashRunning: false,
  pendingMessageCount: 0,
  queuedMessages: [],
  tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  cost: 0,
  ...overrides,
});

const active = (overrides: Partial<SessionActivity> = {}): SessionActivity => ({
  sessionId: "s1",
  phase: "active",
  label: "Reading a file",
  at: "2026-04-15T12:00:00.000Z",
  ...overrides,
});

const ids = (rows: ReturnType<typeof backgroundRows>) => rows.map((row) => row.id);

describe("the background rail", () => {
  it("says nothing when the session has not answered, and leaves the caller to name that", () => {
    expect(backgroundRows({ status: undefined, activity: undefined })).toEqual([]);
  });

  it("shows nothing for a session that is holding still", () => {
    expect(backgroundRows({ status: status(), activity: undefined })).toEqual([]);
  });

  it("puts a dialog the session is blocked on first, and counts several", () => {
    const rows = backgroundRows({
      status: status({ pendingDialogs: [{ dialogId: "d1", kind: "confirm", title: "Approve the deploy?", askedAt: "2026-04-15T11:59:30.000Z", runScoped: false }] }),
      activity: undefined,
    });
    expect(rows[0]?.id).toBe("waiting");
    expect(rows[0]?.label).toBe("Waiting for an answer");
    expect(rows[0]?.detail).toBe("Approve the deploy?");
    expect(rows[0]?.state).toBe("waiting");
    const many = backgroundRows({
      status: status({ pendingDialogs: [{ dialogId: "d1", kind: "confirm", title: "Approve the deploy?", askedAt: "2026-04-15T11:59:30.000Z", runScoped: false }, { dialogId: "d2", kind: "confirm", title: "Push the tag?", askedAt: "2026-04-15T11:59:40.000Z", runScoped: false }] }),
      activity: undefined,
    });
    expect(many[0]?.label).toBe("Waiting for 2 answers");
  });

  it("counts the prompts that are queued, and quotes the one that waits at the front", () => {
    const rows = backgroundRows({
      status: status({ pendingMessageCount: 2, queuedMessages: [{ kind: "followUp", text: "Also update the docs" }] }),
      activity: undefined,
    });
    expect(ids(rows)).toContain("queued");
    const row = rows.find((entry) => entry.id === "queued");
    expect(row?.label).toBe("2 messages queued");
    expect(row?.detail).toBe("Also update the docs");
  });

  it("counts the runs that outlive the turn, and never names runs it has not read", () => {
    const rows = backgroundRows({ status: status({ backgroundRunCount: 3, lastRunDurationMs: 12_400 }), activity: undefined });
    const row = rows.find((entry) => entry.id === "background-runs");
    expect(row?.label).toBe("3 runs started by this session are still going");
    expect(row?.detail).toBe("last turn 12s");
    expect(row?.state).toBe("running");
  });

  it("reports the turn that is going, including a session that is opening", () => {
    expect(backgroundRows({ status: status({ isStreaming: true }), activity: active() }).some((row) => row.id === "activity")).toBe(true);
    const opening = backgroundRows({ status: status(), activity: active({ startup: true }) });
    expect(opening.find((row) => row.id === "activity")?.label).toBe("Opening this session");
  });

  it("says what is happening when the session is compacting or running a command", () => {
    expect(backgroundRows({ status: status({ isCompacting: true }), activity: undefined }).find((row) => row.id === "activity")?.detail).toBe("compacting");
    expect(backgroundRows({ status: status({ isBashRunning: true }), activity: undefined }).find((row) => row.id === "activity")?.detail).toBe("running a command");
  });

  it("reports a run that ended in an error as failed, and a stop as running", () => {
    const failed = backgroundRows({ status: status(), activity: active({ phase: "error", detail: "model unavailable" }) });
    expect(failed.find((row) => row.id === "error")?.state).toBe("failed");
    expect(failed.find((row) => row.id === "error")?.detail).toBe("model unavailable");
    expect(backgroundRows({ status: status({ isStopping: true }), activity: undefined }).some((row) => row.id === "stopping")).toBe(true);
  });
});
