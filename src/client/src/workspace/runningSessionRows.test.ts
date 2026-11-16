import { describe, expect, it } from "vitest";
import type { SessionActivity, SessionInfo, SessionStatus } from "../api";
import { runningSessionRows } from "./runningSessionRows.js";

const NOW = Date.parse("2026-04-15T12:00:00.000Z");
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

const session = (id: string, overrides: Partial<SessionInfo> = {}): SessionInfo => ({
  id,
  cwd: "/repo/app",
  path: `/repo/app/${id}.jsonl`,
  created: iso(3_600_000),
  modified: iso(120_000),
  messageCount: 3,
  firstMessage: `first message of ${id}`,
  ...overrides,
});

const status = (sessionId: string, overrides: Partial<SessionStatus> = {}): SessionStatus => ({
  sessionId,
  isStreaming: false,
  isCompacting: false,
  isBashRunning: false,
  pendingMessageCount: 0,
  queuedMessages: [],
  tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  cost: 0,
  ...overrides,
});

const active = (sessionId: string, overrides: Partial<SessionActivity> = {}): SessionActivity => ({
  sessionId,
  phase: "active",
  label: "Working",
  at: iso(90_000),
  ...overrides,
});

function rows(input: Partial<Parameters<typeof runningSessionRows>[0]>) {
  return runningSessionRows({ sessions: [], statuses: {}, activities: {}, now: NOW, ...input });
}

describe("the running sessions list", () => {
  it("lists only sessions the app's own classifier calls running", () => {
    const answer = rows({
      sessions: [session("idle"), session("streaming"), session("activity")],
      statuses: { idle: status("idle"), streaming: status("streaming", { isStreaming: true }) },
      activities: { activity: active("activity") },
    });
    expect(answer.map((row) => row.id).sort()).toEqual(["activity", "streaming"]);
  });

  it("does not claim a session it has no news about", () => {
    expect(rows({ sessions: [session("quiet")] })).toEqual([]);
  });

  it("leaves an archived session out, even while its status says it is working", () => {
    const answer = rows({
      sessions: [session("archived", { archived: true })],
      statuses: { archived: status("archived", { isStreaming: true }) },
    });
    expect(answer).toEqual([]);
  });

  it("clocks the turn from the daemon's own start, and says nothing when it has not", () => {
    const answer = rows({
      sessions: [session("streaming")],
      statuses: { streaming: status("streaming", { isStreaming: true, turnStartedAt: iso(125_000) }) },
    });
    expect(answer[0]?.elapsed).toBe("2m");
    const quiet = rows({
      sessions: [session("idle-run")],
      statuses: { "idle-run": status("idle-run", { backgroundRunCount: 1 }) },
    });
    expect(quiet[0]?.elapsed).toBeUndefined();
  });

  it("orders the list by the session that moved last", () => {
    const answer = rows({
      sessions: [session("older"), session("newer")],
      statuses: {
        older: status("older", { isStreaming: true, lastActivityAt: iso(600_000) }),
        newer: status("newer", { isStreaming: true, lastActivityAt: iso(30_000) }),
      },
    });
    expect(answer.map((row) => row.id)).toEqual(["newer", "older"]);
  });

  it("borrows the app's own state categories, and says unknown before a status answers", () => {
    const answer = rows({
      sessions: [session("asking")],
      statuses: { asking: status("asking", { isStreaming: true, pendingDialogs: [{ dialogId: "d1", kind: "confirm", title: "Approve the deploy?", askedAt: "2026-04-15T11:59:30.000Z", runScoped: false }] }) },
    });
    expect(answer[0]?.state).toBe("asking");
  });
});
