import { describe, expect, it } from "vitest";
import type { PiPackageInfo, PiPackageMutationResponse, PiPackageUpdateRequest, PiPackagesResponse } from "../api";
import {
  piPackageBusyMessage,
  piPackageCanUpdate,
  piPackageCanUpdateAll,
  piPackageEmptyNote,
  piPackageEnabledMessage,
  piPackageFilteredNote,
  piPackageGlobalEmptyStateNote,
  piPackageGlobalRows,
  piPackageInstallMessage,
  piPackageInstallPath,
  piPackageInstallProjectDisabledReason,
  piPackageInstallRequest,
  piPackageInstallTargetLabel,
  piPackageNotLoadedNote,
  piPackageListsEmpty,
  piPackageProjectRows,
  piPackageProjectScopeNote,
  piPackageProjectScopeState,
  piPackageRemoveMessage,
  piPackageRemoveQuestion,
  piPackageRemoveRequest,
  piPackageRowKey,
  piPackageRowPending,
  piPackageRowTestId,
  piPackageAnyPending,
  piPackageScopeCounts,
  piPackageScopeLabel,
  piPackageScopeNote,
  piPackageScopedRequest,
  piPackageSetEnabledRequest,
  piPackageSourceKind,
  piPackageStatus,
  piPackageUpdateAllMessage,
  piPackageUpdateDisabledReason,
  piPackageUpdateMessage,
  piPackageUpdateRequest,
} from "./settings/piPackageSettingsState";

function pkg(overrides: Partial<PiPackageInfo> = {}): PiPackageInfo {
  return {
    source: "npm:search-mcp",
    scope: "user",
    enabled: true,
    disabled: false,
    filtered: false,
    installedPath: "/home/dev/.pi/git/github.com/owner/search",
    ...overrides,
  };
}

function packagesResponse(overrides: Partial<PiPackagesResponse> = {}): PiPackagesResponse {
  return { packages: [], ...overrides };
}

function mutation(overrides: Partial<PiPackageMutationResponse> = {}): PiPackageMutationResponse {
  return { packages: [], action: "install", ...overrides };
}

describe("Pi Packages scope rules", () => {
  it("splits the machine's rows from the project's, and answers an empty list honestly", () => {
    const response = packagesResponse({ packages: [pkg({}), pkg({ scope: "project", source: "git:project/tool" })] });
    expect(piPackageGlobalRows(response).map(entry => entry.source)).toEqual(["npm:search-mcp"]);
    expect(piPackageProjectRows(response).map(entry => entry.source)).toEqual(["git:project/tool"]);
    expect(piPackageScopeCounts(response)).toEqual({ global: 1, project: 1 });
    expect(piPackageListsEmpty(response)).toBe(false);
    expect(piPackageListsEmpty(packagesResponse())).toBe(true);
    expect(piPackageListsEmpty(undefined)).toBe(true);
  });

  /**
   * pi's update advances npm sources with a range and git sources, in either scope, and skips a source
   * pinned to one version and a source that names a folder. The rule is about the source, not the scope:
   * a project's npm package updates, and a global path source does not.
   */
  it("offers an update for the sources pi can advance, and says why the others have none", () => {
    expect(piPackageCanUpdate("npm:search-mcp")).toBe(true);
    expect(piPackageCanUpdate("npm:search-mcp@^1.2.0")).toBe(true);
    expect(piPackageCanUpdate("git:https://github.com/owner/search")).toBe(true);
    expect(piPackageCanUpdate("github:owner/search")).toBe(true);
    expect(piPackageCanUpdate("https://github.com/owner/search")).toBe(true);
    expect(piPackageCanUpdate("npm:search-mcp@1.2.3")).toBe(false);
    expect(piPackageCanUpdate("npm:@acme/tools@2.0.0")).toBe(false);
    expect(piPackageCanUpdate("../local/tools")).toBe(false);
    expect(piPackageCanUpdate("/srv/tools")).toBe(false);
    expect(piPackageCanUpdate("tools")).toBe(false);
    expect(piPackageUpdateDisabledReason("npm:search-mcp@1.2.3")).toContain("pinned to one version");
    expect(piPackageUpdateDisabledReason("../local/tools")).toContain("folder on disk");
    expect(piPackageSourceKind("npm:search-mcp@1.2.3")).toBe("pinned");
    expect(piPackageSourceKind("github:owner/search")).toBe("git");
    expect(piPackageCanUpdateAll(packagesResponse({ packages: [pkg({})] }))).toBe(true);
    expect(piPackageCanUpdateAll(packagesResponse({ packages: [pkg({ source: "../local/tools" })] }))).toBe(false);
    expect(piPackageCanUpdateAll(packagesResponse({ packages: [pkg({ scope: "project", source: "git:owner/tools" })] }))).toBe(true);
  });

  /**
   * A project-scope write names the project the page is showing. A machine-wide request carries no
   * project: the server resolves an id to a directory, and a request that named a project it was not
   * writing would describe a file the reader is not looking at.
   */
  it("attaches the project only to a project-scope request", () => {
    const globalUpdate: PiPackageUpdateRequest = { source: "npm:x" };
    const globalScoped: PiPackageUpdateRequest = { source: "npm:x", scope: "user" };
    const projectScoped: PiPackageUpdateRequest = { source: "npm:x", scope: "project" };
    expect(piPackageScopedRequest(projectScoped, "p-1")).toEqual({ source: "npm:x", scope: "project", projectId: "p-1" });
    expect(piPackageScopedRequest(globalScoped, "p-1")).toEqual({ source: "npm:x", scope: "user" });
    expect(piPackageScopedRequest(globalUpdate, "p-1")).toEqual({ source: "npm:x" });
    expect(piPackageScopedRequest(projectScoped, undefined)).toEqual({ source: "npm:x", scope: "project" });
    expect(piPackageInstallRequest("npm:x", "project")).toEqual({ source: "npm:x", scope: "project" });
  });

  /**
   * An empty project section means different things when no project is selected, when the project is
   * untrusted, and when the scope was read and is empty. The page states which, and a project install
   * says what blocks it.
   */
  it("keeps an unread project scope apart from an empty one", () => {
    expect(piPackageProjectScopeState(undefined)).toBe("not-loaded");
    expect(piPackageProjectScopeState(packagesResponse({}))).toBe("no-project");
    expect(piPackageProjectScopeState(packagesResponse({ projectPath: "/repo", projectTrusted: false }))).toBe("untrusted");
    expect(piPackageProjectScopeState(packagesResponse({ projectPath: "/repo", projectTrusted: true }))).toBe("read");
    expect(piPackageProjectScopeNote("no-project", "repo", "Workstation")).toContain("No project is selected");
    expect(piPackageProjectScopeNote("untrusted", "repo", "Workstation")).toContain("not trusted");
    expect(piPackageProjectScopeNote("not-loaded", "repo", "Workstation")).toContain("not been read");
    expect(piPackageInstallProjectDisabledReason("no-project", "repo")).toContain("Choose a project first");
    expect(piPackageInstallProjectDisabledReason("untrusted", "repo")).toContain("repo is not trusted");
    expect(piPackageInstallProjectDisabledReason("read", "repo")).toBeUndefined();
  });

  it("addresses every write by the scope the row was read for", () => {
    expect(piPackageUpdateRequest(pkg({}))).toEqual({ source: "npm:search-mcp", scope: "user" });
    expect(piPackageRemoveRequest("npm:search-mcp", "project")).toEqual({ source: "npm:search-mcp", scope: "project" });
    expect(piPackageSetEnabledRequest("npm:search-mcp", "user", false)).toEqual({ source: "npm:search-mcp", scope: "user", enabled: false });
  });

  it("keys a row by scope and source, so the same source in two scopes keeps two pending states", () => {
    const globalRow = pkg({});
    const projectRow = pkg({ scope: "project" });
    expect(piPackageRowKey("user", "npm:search-mcp")).not.toBe(piPackageRowKey("project", "npm:search-mcp"));
    const busy = { [piPackageRowKey("project", "npm:search-mcp")]: "Removing npm:search-mcp" };
    expect(piPackageRowPending(busy, projectRow)).toBe(true);
    expect(piPackageRowPending(busy, globalRow)).toBe(false);
    expect(piPackageAnyPending(busy)).toBe(true);
    expect(piPackageBusyMessage(busy)).toContain("package controls are disabled while it runs");
    expect(piPackageBusyMessage({})).toBeUndefined();
    expect(piPackageRowTestId(globalRow)).toBe("react-packages-row-user-npm:search-mcp");
    expect(piPackageInstallPath(globalRow)).toBe("/home/dev/.pi/git/github.com/owner/search");
  });

  it("states a row's state, and keeps a filtered package apart from a disabled one", () => {
    expect(piPackageStatus(pkg({}))).toEqual({ label: "On", off: false });
    expect(piPackageStatus(pkg({ enabled: false }))).toEqual({ label: "Off", off: true });
    expect(piPackageStatus(pkg({ filtered: true }))).toEqual({ label: "Filtered off", off: true });
    expect(piPackageFilteredNote(pkg({ filtered: true }))).toContain("pi's package filter");
    expect(piPackageFilteredNote(pkg({}))).toBeUndefined();
    expect(piPackageScopeLabel("user")).toBe("Global");
    expect(piPackageScopeLabel("project")).toBe("Project");
  });

  it("names the file each section's answers live in", () => {
    expect(piPackageScopeNote("user", 1, "repo", "Workstation")).toContain("Global packages on Workstation: 1 package");
    expect(piPackageScopeNote("user", 2, "repo", "Workstation")).toContain("2 packages");
    expect(piPackageScopeNote("project", 0, "repo", "Workstation")).toContain(".pi/settings.json");
    expect(piPackageInstallTargetLabel("user", "Workstation", "repo")).toContain("written to the global settings on Workstation");
    expect(piPackageInstallTargetLabel("project", "Workstation", "repo")).toContain("repo/.pi/settings.json");
    expect(piPackageInstallTargetLabel("project", "Workstation", "repo")).toContain("that project alone");
    expect(piPackageEmptyNote("user", "repo")).toBe("No packages are installed on this machine.");
    expect(piPackageEmptyNote("project", "repo")).toContain("repo has no packages");
  });

  it("reports what a write did, in pi's own words, and carries its reload note", () => {
    expect(piPackageInstallMessage(mutation({ source: "npm:search-mcp", scope: "user", requiresReload: true })))
      .toBe("Installed npm:search-mcp (Global). Reload running sessions to apply it.");
    expect(piPackageUpdateMessage(mutation({ source: "npm:search-mcp", scope: "user", requiresReload: false })))
      .toBe("Update completed for npm:search-mcp (Global).");
    expect(piPackageRemoveMessage(mutation({ source: "git:project/tool", scope: "project" })))
      .toBe("Removed git:project/tool (Project).");
    expect(piPackageEnabledMessage(mutation({ source: "npm:search-mcp", scope: "user", enabled: false })))
      .toBe("Disabled npm:search-mcp (Global).");
    expect(piPackageEnabledMessage(mutation({ source: "npm:search-mcp", scope: "user", enabled: true, requiresReload: true })))
      .toContain("Enabled npm:search-mcp (Global). Reload");
    expect(piPackageUpdateAllMessage(mutation({ packages: [pkg({}), pkg({ source: "npm:other" })] })))
      .toContain("2 packages in the global list");
    expect(piPackageUpdateAllMessage(mutation({ packages: [pkg({})] }))).toContain("1 package in the global list");
    expect(piPackageUpdateAllMessage(mutation({ packages: [pkg({}), pkg({ scope: "project", source: "git:owner/tools" })] })))
      .toContain("1 global and 1 project package");
  });

  it("asks a removal question that names the settings the removal changes, and the path pi loaded from", () => {
    expect(piPackageRemoveQuestion(pkg({}))).toContain("the machine's global settings");
    expect(piPackageRemoveQuestion(pkg({}))).toContain("/home/dev/.pi/git/github.com/owner/search");
    const projectRow = pkg({ scope: "project", source: "git:project/tool" });
    delete projectRow.installedPath;
    expect(piPackageRemoveQuestion(projectRow)).toContain("the current project's settings");
    expect(piPackageRemoveQuestion(projectRow)).not.toContain("pi loaded it from");
  });
});

describe("package list presence", () => {
  it("names the unread list as unread, not as empty", () => {
    expect(piPackageNotLoadedNote()).toContain("not been read");
    expect(piPackageGlobalEmptyStateNote(undefined, "Site")).toBe(piPackageNotLoadedNote());
  });

  it("distinguishes an empty machine list from a list this page does not manage", () => {
    expect(piPackageGlobalEmptyStateNote(packagesResponse({ packages: [] }), "Site"))
      .toBe("No packages are installed on this machine.");
    expect(piPackageGlobalEmptyStateNote(packagesResponse({ packages: [pkg({ source: "npm:pi-web", scope: "project" })] }), "Site"))
      .toContain("none of them is in a scope this page manages");
  });
});
