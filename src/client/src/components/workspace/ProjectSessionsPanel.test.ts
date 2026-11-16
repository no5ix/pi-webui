// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { ProjectSessionsPanel } from "./ProjectSessionsPanel";
import { projectSessionModel } from "../../workspace/projectSessionModel";
import type { SessionInfo } from "../../api";

afterEach(() => { document.body.replaceChildren(); });

const NOW = Date.parse("2026-04-15T12:00:00.000Z");
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

const session = (id: string, cwd: string, overrides: Partial<SessionInfo> = {}): SessionInfo => ({
  id,
  cwd,
  path: `${cwd}/${id}.jsonl`,
  created: iso(3_600_000),
  modified: iso(60_000),
  messageCount: 2,
  firstMessage: `first message of ${id}`,
  ...overrides,
});

const PROJECTS = [{ id: "app", name: "app", path: "/repo/app" }];

function model(input: Partial<Parameters<typeof projectSessionModel>[0]>) {
  return projectSessionModel({
    projects: PROJECTS,
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

async function mount(overrides: Partial<ProjectSessionsPanel> = {}): Promise<ProjectSessionsPanel> {
  const panel = new ProjectSessionsPanel();
  Object.assign(panel, overrides);
  document.body.append(panel);
  await panel.updateComplete;
  return panel;
}

const q = (panel: ProjectSessionsPanel, selector: string) => panel.renderRoot.querySelector(selector);

describe("the sidebar's project tree", () => {
  it("names each project and how many sessions it holds", async () => {
    const panel = await mount({ model: model({ sessions: [session("s1", "/repo/app")] }), projectCount: 1 });
    expect(q(panel, ".project-name")?.textContent.trim()).toBe("app");
    expect(q(panel, ".project-count")?.textContent.trim()).toBe("1");
  });

  it("keeps a folded project's sessions out of the tree, and says how many it holds", async () => {
    const opened: string[] = [];
    const sessions = Array.from({ length: 7 }, (_, index) => session(`s${String(index)}`, "/repo/app"));
    const panel = await mount({ model: model({ sessions }), onToggleProject: (id) => { opened.push(id); } });
    expect(panel.renderRoot.querySelectorAll(".session")).toHaveLength(0);
    expect(q(panel, ".project-count")?.textContent.trim()).toBe("7");
    const project = q(panel, ".project");
    if (!(project instanceof HTMLElement)) throw new Error("the project row is missing");
    project.dispatchEvent(new Event("click", { bubbles: true, composed: true }));
    expect(opened).toEqual(["app"]);
  });

  it("folds an opened project's list at the sidebar's limit and names the rest", async () => {
    const opened: string[] = [];
    const sessions = Array.from({ length: 7 }, (_, index) => session(`s${String(index)}`, "/repo/app"));
    const panel = await mount({ model: model({ sessions, expandedProjectIds: new Set(["app"]) }), onToggleProject: (id) => { opened.push(id); } });
    expect(panel.renderRoot.querySelectorAll(".session")).toHaveLength(5);
    const show = q(panel, ".show-more");
    expect(show?.textContent.trim()).toBe("Show 2 more");
    show?.dispatchEvent(new Event("click", { bubbles: true, composed: true }));
    expect(opened).toEqual(["app"]);
  });

  it("lists a project's sessions when it is opened, and marks the one on screen", async () => {
    const panel = await mount({ model: model({ sessions: [session("open", "/repo/app")], selectedProjectId: "app", selectedSessionId: "open" }) });
    const row = q(panel, ".session");
    expect(row?.textContent).toContain("open");
    expect(row?.getAttribute("data-selected")).toBe("true");
  });

  it("sends a chosen session to the app, with its id", async () => {
    const opened: string[] = [];
    const panel = await mount({
      model: model({ sessions: [session("open", "/repo/app")], expandedProjectIds: new Set(["app"]) }),
      onSelectSession: (id) => { opened.push(id); },
    });
    q(panel, ".session")?.dispatchEvent(new Event("click", { bubbles: true, composed: true }));
    expect(opened).toEqual(["open"]);
  });

  it("passes what the reader types straight to the search", async () => {
    const queries: string[] = [];
    const panel = await mount({ onQueryChange: (query) => { queries.push(query); } });
    const field = q(panel, ".search-input");
    if (!(field instanceof HTMLInputElement)) throw new Error("the search field is missing");
    field.value = "deploy";
    field.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    expect(queries).toEqual(["deploy"]);
  });

  it("says a search matched nothing, and says the tree is empty when there are no projects", async () => {
    const filtering = await mount({ model: model({ query: "deploy" }) });
    expect(q(filtering, ".empty")?.textContent).toContain("No sessions match this search.");
    const none = await mount({ model: model({ projects: [] }) });
    expect(q(none, ".empty")?.textContent).toContain("No projects are listed on this machine.");
  });

  it("says why the tree is short when a server refused the list, and that it is still loading", async () => {
    const panel = await mount({ problem: "The machine refused the project list.", loading: true });
    expect(q(panel, ".note.problem")?.textContent).toContain("refused the project list");
    expect(q(panel, ".note")?.textContent).toContain("Loading projects");
  });
});
