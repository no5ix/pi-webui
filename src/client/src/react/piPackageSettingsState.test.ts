import { describe, expect, it } from "vitest";
import type { PiPackageInfo, PiPackageMutationResponse, PiPackagesResponse } from "../api";
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
  piPackageInstallTargetLabel,
  piPackageNotLoadedNote,
  piPackageListsEmpty,
  piPackageProjectRows,
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
  piPackageSetEnabledRequest,
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

  it("offers an update only where pi has an update command, and says why the other row has none", () => {
    expect(piPackageCanUpdate("user")).toBe(true);
    expect(piPackageCanUpdate("project")).toBe(false);
    expect(piPackageUpdateDisabledReason("project")).toContain("project's settings");
    expect(piPackageCanUpdateAll(packagesResponse({ packages: [pkg({})] }))).toBe(true);
    expect(piPackageCanUpdateAll(packagesResponse({ packages: [pkg({ scope: "project" })] }))).toBe(false);
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
    expect(piPackageInstallTargetLabel("Workstation")).toContain("written to the global settings on Workstation");
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
      .toContain("All global packages updated — 2 packages in the list.");
    expect(piPackageUpdateAllMessage(mutation({ packages: [pkg({})] }))).toContain("1 package in the list");
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
