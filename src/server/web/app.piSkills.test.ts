import { describe, expect, it } from "vitest";
import type { Project } from "../../shared/apiTypes.js";
import { appTestContext, registerAppTestHooks } from "./app.testSupport.js";

registerAppTestHooks();

/**
 * The Skills routes as the built app serves them.
 *
 * The route module's own tests pin the statuses; what is pinned here is the wiring a browser
 * depends on: the route exists on the application path and on the local-machine alias, it answers
 * with the selected machine's own list, a project is named by id (never by a path the client
 * invents), and a request the panel would not send is refused before the service is asked.
 */
describe("buildApp Pi skills routes", () => {
  it("lists the skills of the machine the app serves", async () => {
    const response = await appTestContext.app.inject({ method: "GET", url: "/api/pi-skills" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ skills: [expect.objectContaining({ name: "pdf", enabled: true })] });
    expect(appTestContext.piSkillsRequests).toEqual([{ action: "list" }]);
  });

  it("serves the same list through the local machine alias", async () => {
    const response = await appTestContext.app.inject({ method: "GET", url: "/api/machines/local/pi-skills" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ skills: [expect.objectContaining({ name: "pdf" })] });
  });

  it("turns a skill off for the global scope and reports the reload it needs", async () => {
    const response = await appTestContext.app.inject({
      method: "POST",
      url: "/api/pi-skills/set-enabled",
      payload: { name: "pdf", scope: "global", enabled: false },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ requiresReload: true });
    expect(appTestContext.piSkillsRequests).toEqual([{ action: "set-enabled", name: "pdf", scope: "global", enabled: false }]);
  });

  it("carries a project scope as the project id the client sent", async () => {
    const added = await appTestContext.app.inject({ method: "POST", url: "/api/projects", payload: { name: "Project", path: appTestContext.projectDir, create: true } });
    const projectId = added.json<Project>().id;

    const response = await appTestContext.app.inject({
      method: "POST",
      url: "/api/machines/local/pi-skills/set-enabled",
      payload: { name: "pdf", scope: "project", enabled: false, projectId },
    });

    expect(response.statusCode).toBe(200);
    expect(appTestContext.piSkillsRequests.at(-1)).toEqual({ action: "set-enabled", name: "pdf", scope: "project", enabled: false, projectId });
  });

  it("refuses a request that names no skill, before the service is asked", async () => {
    const response = await appTestContext.app.inject({ method: "POST", url: "/api/pi-skills/set-enabled", payload: { scope: "global", enabled: false } });

    expect(response.statusCode).toBe(400);
    expect(appTestContext.piSkillsRequests).toEqual([]);
  });
});
