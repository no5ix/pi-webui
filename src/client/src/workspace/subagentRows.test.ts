import { describe, expect, it } from "vitest";
import type { SessionInfo, SessionSubsessionInfo } from "../api";
import { folderName, subagentRows } from "./subagentRows.js";

const child = (sessionId: string, cwd: string, status: SessionSubsessionInfo["status"] = "working"): SessionSubsessionInfo => ({
  sessionId,
  cwd,
  status,
});

const listed = (id: string, cwd: string, overrides: Partial<SessionInfo> = {}): SessionInfo => ({
  id,
  cwd,
  path: `${cwd}/${id}.jsonl`,
  created: "2026-04-15T11:00:00.000Z",
  modified: "2026-04-15T12:00:00.000Z",
  messageCount: 4,
  firstMessage: "child work",
  name: `child ${id}`,
  ...overrides,
});

describe("the subagents rail", () => {
  it("names a child the browser has listed, and falls back to its folder when it has not", () => {
    const rows = subagentRows([child("c1", "/repo/app"), child("c2", "/repo/lib")], new Map([["c1", listed("c1", "/repo/app")]]));
    expect(rows.find((row) => row.id === "c1")?.label).toBe("child c1");
    const unknown = rows.find((row) => row.id === "c2");
    expect(unknown?.label).toBeUndefined();
    expect(unknown?.folder).toBe("lib");
  });

  it("puts the children that are working first, then the ones that stopped on an error", () => {
    const rows = subagentRows(
      [child("idle", "/repo/a", "idle"), child("working", "/repo/b"), child("broken", "/repo/c", "error"), child("mystery", "/repo/d", "unknown")],
      new Map(),
    );
    expect(rows.map((row) => row.state)).toEqual(["working", "error", "idle", "unknown"]);
  });

  it("refuses to open a child whose folder is gone, and opens one the browser can reach", () => {
    const rows = subagentRows([child("gone", "/repo/a"), child("here", "/repo/b")], new Map([
      ["gone", listed("gone", "/repo/a", { cwdMissing: true })],
      ["here", listed("here", "/repo/b")],
    ]));
    expect(rows.find((row) => row.id === "gone")?.openable).toBe(false);
    expect(rows.find((row) => row.id === "here")?.openable).toBe(true);
  });

  it("names a folder the way a sidebar names a project", () => {
    expect(folderName("/repo/app/worktrees/task")).toBe("task");
    expect(folderName("/repo/app/")).toBe("app");
    expect(folderName("/")).toBe("/");
    expect(folderName("")).toBe("unknown folder");
  });
});
