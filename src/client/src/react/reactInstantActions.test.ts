import { afterEach, describe, expect, it, vi } from "vitest";
import type { InstantAction, InstantAnswer } from "../instantActions";
import type { Project, SessionInfo } from "../api";
import type { SessionBoard } from "../sync/sessionBoard";
import { createWorkspaceInstantActions, projectActionIsPending, projectCloseAdmission, sessionActionIsPending } from "./reactInstantActions";

const session: SessionInfo = {
  id: "session-1", cwd: "/workspace", path: "/workspace/session.jsonl", created: "2026-01-01T00:00:00Z",
  modified: "2026-01-01T00:00:00Z", messageCount: 1, firstMessage: "Hello",
};
const project: Project = { id: "project-1", name: "Project", path: "/workspace", createdAt: "2026-01-01T00:00:00Z" };

describe("React session instant actions", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("holds permanent deletion through the undo window and cancels it on undo", async () => {
    vi.useFakeTimers();
    const api = harness();
    const actions = createWorkspaceInstantActions(api.sessions, api.boards, api.projects, vi.fn(), vi.fn(), api.projectApi);

    actions.start({ kind: "delete-archived", machineId: "remote-1", machineName: "Remote", dock: "none", targets: [{ id: session.id, label: "Hello", projectId: "project-1", workspacePath: session.cwd }] });

    expect(api.sessions.deleteArchivedSessions).not.toHaveBeenCalled();
    expect(actions.undoLatest()).toBe(true);
    await vi.advanceTimersByTimeAsync(6_000);
    expect(api.sessions.deleteArchivedSessions).not.toHaveBeenCalled();
    actions.dispose();
  });

  it("sends held deletion after the undo window and applies the confirmed result", async () => {
    vi.useFakeTimers();
    const api = harness();
    const actions = createWorkspaceInstantActions(api.sessions, api.boards, api.projects, vi.fn(), vi.fn(), api.projectApi);

    actions.start({ kind: "delete-archived", machineId: "remote-1", machineName: "Remote", dock: "none", targets: [{ id: session.id, label: "Hello", projectId: "project-1", workspacePath: session.cwd }] });
    await vi.advanceTimersByTimeAsync(5_000);

    expect(api.sessions.deleteArchivedSessions).toHaveBeenCalledWith([{ id: session.id, cwd: session.cwd }], "remote-1", undefined);
    expect(api.sessions.applyDeletedSessions).toHaveBeenCalledWith([session.id], "remote-1");
    actions.dispose();
  });

  it("carries a confirmed archive into the board before a refresh can replace it", async () => {
    vi.useFakeTimers();
    const api = harness();
    const actions = createWorkspaceInstantActions(api.sessions, api.boards, api.projects, vi.fn(), vi.fn(), api.projectApi);

    actions.start({ kind: "archive", machineId: "remote-1", machineName: "Remote", dock: "none", targets: [{ id: session.id, label: "Hello", projectId: "project-1", workspacePath: session.cwd }] });
    await vi.advanceTimersByTimeAsync(0);

    expect(api.board().sessions[0]?.archived).toBe(true);
    expect(api.boards.update).toHaveBeenCalledOnce();
    expect(api.boards.read).toHaveBeenCalledWith("remote-1", { force: true });
    actions.dispose();
  });

  it("only treats the matching machine and session as pending", () => {
    const action: InstantAction = {
      id: 1,
      kind: "delete-archived",
      machineId: "remote-1",
      machineName: "Remote",
      dock: "none",
      targets: [{ id: session.id, label: "Hello", projectId: "project-1", workspacePath: session.cwd }],
      returned: [],
      phase: "held",
      pressedAt: "2026-01-01T00:00:00Z",
    };
    expect(sessionActionIsPending([action], "remote-1", session.id)).toBe(true);
    expect(sessionActionIsPending([action], "local", session.id)).toBe(false);
    expect(sessionActionIsPending([action], "remote-1", "another-session")).toBe(false);
  });

  it("holds project close for Undo, then uses the existing project API and controller", async () => {
    vi.useFakeTimers();
    const api = harness();
    const actions = createWorkspaceInstantActions(api.sessions, api.boards, api.projects, vi.fn(), vi.fn(), api.projectApi);
    actions.start({ kind: "close-project", machineId: "remote-1", machineName: "Remote", dock: "none", targets: [{ id: project.id, label: project.name, projectId: project.id, workspacePath: project.path }] });

    expect(api.projectApi.closeProject).not.toHaveBeenCalled();
    expect(projectActionIsPending(actions.list(), "remote-1", project.id)).toBe(true);
    expect(actions.undoLatest()).toBe(true);
    await vi.advanceTimersByTimeAsync(6_000);
    expect(api.projectApi.closeProject).not.toHaveBeenCalled();
    expect(api.projects.applyClosedProject).not.toHaveBeenCalled();
    actions.dispose();
  });

  it("applies a confirmed project close through ProjectController", async () => {
    vi.useFakeTimers();
    const api = harness();
    const actions = createWorkspaceInstantActions(api.sessions, api.boards, api.projects, vi.fn(), vi.fn(), api.projectApi);
    actions.start({ kind: "close-project", machineId: "remote-1", machineName: "Remote", dock: "none", targets: [{ id: project.id, label: project.name, projectId: project.id, workspacePath: project.path }] });
    await vi.advanceTimersByTimeAsync(5_000);

    expect(api.projectApi.closeProject).toHaveBeenCalledWith(project.id, "remote-1", undefined);
    expect(api.projects.applyClosedProject).toHaveBeenCalledWith(project.id, "remote-1");
    actions.dispose();
  });

  it("refuses a known offline machine but admits an unknown reachability state", () => {
    expect(projectCloseAdmission({ machineId: "remote-1", ok: false, checkedAt: "now", status: "offline" }).kind).toBe("refused");
    expect(projectCloseAdmission(undefined).kind).toBe("admitted");
  });
});

function harness() {
  const done: InstantAnswer = { doneIds: [session.id], refused: [], unansweredIds: [] };
  const sessions = {
    archiveSessions: vi.fn(() => Promise.resolve(done)),
    applyArchivedSessions: vi.fn(() => Promise.resolve()),
    restoreSessions: vi.fn(() => Promise.resolve(done)),
    applyRestoredSessions: vi.fn(() => Promise.resolve()),
    deleteArchivedSessions: vi.fn(() => Promise.resolve(done)),
    applyDeletedSessions: vi.fn(() => Promise.resolve()),
  };
  let board: SessionBoard = { sessions: [session], workspaces: [], unknownSources: [] };
  const boards = {
    readWhole: vi.fn(() => Promise.resolve(board)),
    read: vi.fn(() => Promise.resolve()),
    update: vi.fn((_machineId: string, change: (current: SessionBoard) => SessionBoard) => { board = change(board); }),
  };
  const projects = { applyClosedProject: vi.fn() };
  const projectApi = {
    closeProject: vi.fn(() => Promise.resolve({ closed: true as const })),
    projects: vi.fn(() => Promise.resolve([] satisfies Project[])),
  };
  return { sessions, boards, projects, projectApi, board: () => board };
}
