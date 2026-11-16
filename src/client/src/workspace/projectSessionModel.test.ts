import { describe, expect, it } from "vitest";
import type { SessionInfo } from "../api";
import { projectOf, projectSessionModel, SIDEBAR_SESSIONS_BEFORE_FOLD } from "./projectSessionModel.js";

const NOW = Date.parse("2026-04-15T12:00:00.000Z");
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

const session = (id: string, cwd: string, overrides: Partial<SessionInfo> = {}): SessionInfo => ({
  id,
  cwd,
  path: `${cwd}/${id}.jsonl`,
  created: iso(60_000),
  modified: iso(60_000),
  messageCount: 2,
  firstMessage: `first message of ${id}`,
  ...overrides,
});

const projects = [
  { id: "proj-app", name: "app", path: "/repo/app" },
  { id: "proj-lib", name: "lib", path: "/repo/lib" },
];

function model(input: Partial<Parameters<typeof projectSessionModel>[0]>) {
  return projectSessionModel({
    projects,
    workspaces: [],
    sessions: [],
    sessionStates: new Map(),
    expandedProjectIds: new Set(),
    selectedProjectId: undefined,
    selectedSessionId: undefined,
    query: "",
    now: NOW,
    ...input,
  });
}

describe("the sidebar's project tree", () => {
  it("joins a session to a project by the folder its workspace lists", () => {
    const answer = model({
      workspaces: [{ id: "ws-1", path: "/repo/app/worktrees/task", projectId: "proj-app" }],
      sessions: [session("s1", "/repo/app/worktrees/task")],
      expandedProjectIds: new Set(["proj-app"]),
    });
    expect(answer.groups.find((group) => group.projectId === "proj-app")?.rows.map((row) => row.id)).toEqual(["s1"]);
  });

  it("falls back to the longest project path that contains the session's folder", () => {
    expect(projectOf("/repo/app/src", projects, new Map())).toBe("proj-app");
    expect(projectOf("/repo/application", projects, new Map())).toBeUndefined();
  });

  it("leaves out a session no project owns, and never invents a group for it", () => {
    const answer = model({ sessions: [session("s1", "/somewhere/else")] });
    expect(answer.groups.map((group) => group.projectId)).toEqual(["proj-app", "proj-lib"]);
    expect(answer.groups.every((group) => group.rows.length === 0)).toBe(true);
    expect(answer.sessionTotal).toBe(0);
  });

  it("leaves archived sessions out of the tree", () => {
    const answer = model({
      sessions: [session("s1", "/repo/app", { archived: true })],
      expandedProjectIds: new Set(["proj-app"]),
    });
    expect(answer.groups.find((group) => group.projectId === "proj-app")?.total).toBe(0);
  });

  it("orders a project's sessions by the one that moved last", () => {
    const answer = model({
      sessions: [
        session("old", "/repo/app", { modified: iso(86_400_000) }),
        session("new", "/repo/app", { modified: iso(60_000) }),
      ],
      expandedProjectIds: new Set(["proj-app"]),
    });
    expect(answer.groups.find((group) => group.projectId === "proj-app")?.rows.map((row) => row.id)).toEqual(["new", "old"]);
  });

  it("keeps a folded project's rows out of the tree and counts them", () => {
    const sessions = Array.from({ length: 8 }, (_, index) => session(`s${String(index)}`, "/repo/app"));
    const answer = model({ sessions });
    const group = answer.groups.find((entry) => entry.projectId === "proj-app");
    expect(group?.expanded).toBe(false);
    expect(group?.rows).toHaveLength(0);
    expect(group?.total).toBe(8);
    expect(group?.hiddenCount).toBe(8);
  });

  it("folds the list of an opened project at the sidebar's limit and names the rest", () => {
    const sessions = Array.from({ length: 8 }, (_, index) => session(`s${String(index)}`, "/repo/app"));
    const answer = model({ sessions, expandedProjectIds: new Set(["proj-app"]) });
    const group = answer.groups.find((entry) => entry.projectId === "proj-app");
    expect(group?.rows).toHaveLength(SIDEBAR_SESSIONS_BEFORE_FOLD);
    expect(group?.hiddenCount).toBe(8 - SIDEBAR_SESSIONS_BEFORE_FOLD);
  });

  it("opens the project of the session on screen, and marks that row", () => {
    const answer = model({
      sessions: [session("open", "/repo/app")],
      selectedProjectId: "proj-app",
      selectedSessionId: "open",
    });
    const group = answer.groups.find((entry) => entry.projectId === "proj-app");
    expect(group?.expanded).toBe(true);
    expect(group?.rows[0]?.selected).toBe(true);
  });

  it("searches across projects, expands what it matches, and drops what it does not", () => {
    const answer = model({
      sessions: [session("a", "/repo/app", { name: "Deploy the release" }), session("b", "/repo/lib")],
      query: "deploy",
    });
    expect(answer.filtering).toBe(true);
    expect(answer.groups.map((group) => group.projectId)).toEqual(["proj-app"]);
    expect(answer.groups[0]?.expanded).toBe(true);
    expect(answer.sessionTotal).toBe(1);
  });

  it("searches the first message too, so a session with no name is findable", () => {
    const answer = model({ sessions: [session("a", "/repo/app")], query: "first message of a" });
    expect(answer.sessionTotal).toBe(1);
  });

  it("says unknown for a session no status has answered for, and unopenable for a folder that is gone", () => {
    const answer = model({
      sessions: [session("a", "/repo/app", { cwdMissing: true })],
      selectedProjectId: "proj-app",
    });
    const row = answer.groups.find((group) => group.projectId === "proj-app")?.rows[0];
    expect(row?.state).toBe("unknown");
    expect(row?.unopenable).toBe(true);
  });
});
