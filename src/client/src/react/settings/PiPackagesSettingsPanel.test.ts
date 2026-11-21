import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PiPackageInfo, PiPackageMutationResponse, PiPackagesResponse } from "../../api";
import type { PackagesSettingsPanelProps } from "./PiPackagesSettingsPanel";
import { PackagesSettingsPanel } from "./PiPackagesSettingsPanel";

// @vitest-environment happy-dom

function pkg(overrides: Partial<PiPackageInfo> = {}): PiPackageInfo {
  return {
    source: "npm:search-mcp",
    scope: "user",
    filtered: false,
    disabled: false,
    enabled: true,
    installedPath: "/home/dev/.pi/git/github.com/owner/search",
    ...overrides,
  };
}

function packagesResponse(overrides: Partial<PiPackagesResponse> = {}): PiPackagesResponse {
  return { packages: [pkg({})], ...overrides };
}

function mutation(overrides: Partial<PiPackageMutationResponse> = {}): PiPackageMutationResponse {
  return { packages: [], action: "update", ...overrides };
}

describe("React Pi Packages settings panel", () => {
  let container: HTMLDivElement;
  let root: Root;

  const render = async (props: Partial<PackagesSettingsPanelProps> = {}) => {
    await act(async () => {
      root.render(createElement(PackagesSettingsPanel, {
        packages: packagesResponse(),
        busy: false,
        machineLabel: "Workstation",
        projectName: "repo",
        onReload: vi.fn(),
        install: () => Promise.resolve(mutation({ action: "install", source: "npm:opencode-formatters", scope: "user", requiresReload: true })),
        update: () => Promise.resolve(mutation({ action: "update", requiresReload: true })),
        remove: () => Promise.resolve(mutation({ action: "remove", requiresReload: true })),
        setEnabled: () => Promise.resolve(mutation({ action: "set-enabled", enabled: false, requiresReload: true })),
        ...props,
      }));
      await Promise.resolve();
    });
  };

  const press = async (fn: () => void) => {
    await act(async () => {
      fn();
      await Promise.resolve();
    });
  };

  function type(input: HTMLInputElement, value: string): void {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function button(label: string): HTMLButtonElement {
    const found = [...container.querySelectorAll("button")].find(node => node.textContent.includes(label));
    if (found === undefined) throw new Error(`The "${label}" button did not render.`);
    return found;
  }

  const row = (testId: string) => {
    const found = container.querySelector<HTMLElement>(`[data-test-id="${testId}"]`);
    if (found === null) throw new Error(`The ${testId} row did not render.`);
    return found;
  };

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    document.body.replaceChildren();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    vi.restoreAllMocks();
  });

  it("lists the machine's packages and the project's in sections that name their scope", async () => {
    await render({ packages: packagesResponse({ packages: [pkg({}), pkg({ scope: "project", source: "git:project/tool" })] }) });
    const titles = [...container.querySelectorAll(".rw-settings-section h4")].map(node => node.textContent);
    expect(titles).toContain("Project packages");
    expect(titles).toContain("Global packages");
    expect(container.querySelector(".rw-settings-section")?.textContent).toContain("Workstation · 1 global · 1 project");
    const globalRow = row("react-packages-row-user-npm:search-mcp");
    expect(globalRow.textContent).toContain("scope: Global");
    expect(globalRow.textContent).toContain("installed: /home/dev/.pi/git/github.com/owner/search");
    expect(globalRow.textContent).toContain("On");
  });

  it("states that these are pi's own operations, on the machine pi runs on, and that a session needs /reload", async () => {
    await render();
    const help = [...container.querySelectorAll(".rw-settings-help")].map(node => node.textContent).join("\n");
    expect(help).toContain("pi's own package operations");
    expect(help).toContain("/reload in a running session");
    expect(help).toContain("written to the global settings on Workstation");
    expect(container.textContent).toContain("Packages are code pi loads");
  });

  it("installs the source the page typed, and answers with pi's own message", async () => {
    const install = vi.fn(() => Promise.resolve(mutation({ action: "install", source: "npm:opencode-formatters", scope: "user", requiresReload: true })));
    await render({ install });
    const field = container.querySelector<HTMLInputElement>('[aria-label="Package source"]');
    if (field === null) throw new Error("The package source field did not render.");
    await press(() => { type(field, "npm:opencode-formatters"); });
    await press(() => { button("Install").click(); });
    expect(install).toHaveBeenCalledWith({ source: "npm:opencode-formatters", scope: "user" });
    expect(container.textContent).toContain("Installed npm:opencode-formatters (Global). Reload running sessions to apply it.");
    expect(field.value).toBe("");
  });

  it("refuses an empty source before the machine sees it", async () => {
    const install = vi.fn(() => Promise.resolve(mutation()));
    await render({ install });
    await press(() => { button("Install").click(); });
    expect(install).not.toHaveBeenCalled();
    expect(container.querySelector(".rw-settings-notice.is-danger")?.textContent).toContain("Enter a package source");
  });

  it("updates one global package on the machine that answered", async () => {
    const update = vi.fn(() => Promise.resolve(mutation({ action: "update", source: "npm:search-mcp", scope: "user", requiresReload: true })));
    await render({ update });
    await press(() => { row("react-packages-row-user-npm:search-mcp").querySelector<HTMLButtonElement>('button[title*="Update npm:search-mcp"]')?.click(); });
    expect(update).toHaveBeenCalledWith({ source: "npm:search-mcp", scope: "user" });
    expect(container.textContent).toContain("Update completed for npm:search-mcp (Global).");
  });

  /**
   * pi advances a source it can fetch — npm with a range, git — in either scope, and leaves a folder
   * on disk alone. The control follows the source, so a project's git package is updatable and a
   * path source is not, and the disabled control says which of the two it is.
   */
  it("offers no update for a source pi cannot advance, in either scope, and says why", async () => {
    await render({ packages: packagesResponse({ packages: [pkg({ scope: "project", source: "git:project/tool" }), pkg({ source: "../local/tools", scope: "project" })], projectPath: "/repo", projectTrusted: true, projectScopeRead: true }) });
    const updatable = [...row("react-packages-row-project-git:project/tool").querySelectorAll("button")].find(node => node.textContent.includes("Update"));
    expect(updatable?.disabled).toBe(false);
    const card = row("react-packages-row-project-../local/tools");
    const update = [...card.querySelectorAll("button")].find(node => node.textContent.includes("Update"));
    if (update === undefined) throw new Error("The path row has no Update button.");
    expect(update.disabled).toBe(true);
    expect(update.title).toContain("folder on disk");
  });

  /**
   * The page chooses the install scope, and a project install is pi's local install into the project
   * the page is showing. With no project selected, the project choice is refused and says what to do.
   */
  it("installs into the scope the page chose, and refuses a project install with no project", async () => {
    const install = vi.fn(() => Promise.resolve(mutation({ action: "install", source: "npm:search-mcp", scope: "project", requiresReload: true })));
    await render({ install, packages: packagesResponse({ packages: [pkg({})], projectPath: "/repo", projectTrusted: true, projectScopeRead: true }) });
    const scope = container.querySelector<HTMLSelectElement>('[aria-label="Install scope"]');
    const field = container.querySelector<HTMLInputElement>('[aria-label="Package source"]');
    if (scope === null || field === null) throw new Error("The install form did not render.");
    expect(scope.querySelector<HTMLOptionElement>('option[value="project"]')?.disabled).toBe(false);
    await press(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(scope, "project");
      scope.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await press(() => { type(field, "npm:search-mcp"); });
    await press(() => { button("Install").click(); });
    expect(install).toHaveBeenCalledWith({ source: "npm:search-mcp", scope: "project" });
    expect(container.textContent).toContain("Installed npm:search-mcp (Project).");

    await render({ install: vi.fn() });
    const blocked = container.querySelector<HTMLSelectElement>('[aria-label="Install scope"]');
    if (blocked === null) throw new Error("The install form did not render.");
    expect(blocked.querySelector<HTMLOptionElement>('option[value="project"]')?.disabled).toBe(true);
  });

  it("names the project the project rows belong to, and says when that scope was not read", async () => {
    await render({ packages: packagesResponse({ packages: [pkg({ scope: "project", source: "git:owner/tools" })], projectId: "p-1", projectPath: "/repo", projectConfigPath: "/repo/.pi/settings.json", projectTrusted: true, projectScopeRead: true }) });
    expect(container.textContent).toContain("Project packages for repo: 1 package");

    await render({ packages: packagesResponse({ packages: [pkg({ scope: "project", source: "git:owner/tools" })], projectPath: "/repo", projectTrusted: false, projectScopeRead: false }) });
    expect(container.textContent).toContain("is not trusted on Workstation");
    expect(container.querySelector('[data-test-id="react-packages-row-project-git:owner/tools"]')).toBeNull();

    await render({ packages: packagesResponse({ packages: [] }) });
    expect(container.textContent).toContain("No project is selected");
  });

  it("runs pi's bulk update over the machine's packages, and offers it only when there are any", async () => {
    const update = vi.fn(() => Promise.resolve(mutation({ action: "update", packages: [pkg({}), pkg({ source: "npm:other" })], requiresReload: true })));
    await render({ update });
    await press(() => { button("Update All").click(); });
    expect(update).toHaveBeenCalledWith({});
    expect(container.textContent).toContain("2 packages in the global list.");

    await render({ packages: packagesResponse({ packages: [pkg({ scope: "project", source: "../local/tools" })] }) });
    expect(button("Update All").disabled).toBe(true);
  });

  it("switches the package in the scope its row carries", async () => {
    const setEnabled = vi.fn(() => Promise.resolve(mutation({ action: "set-enabled", source: "git:project/tool", scope: "project", enabled: true, requiresReload: true })));
    await render({ packages: packagesResponse({ packages: [pkg({ scope: "project", source: "git:project/tool", enabled: false, disabled: true })], projectPath: "/repo", projectTrusted: true, projectScopeRead: true }), setEnabled });
    const card = row("react-packages-row-project-git:project/tool");
    expect(card.textContent).toContain("Off");
    const input = card.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (input === null) throw new Error("The project row has no switch.");
    await press(() => { input.click(); });
    expect(setEnabled).toHaveBeenCalledWith({ source: "git:project/tool", scope: "project", enabled: true });
    expect(container.textContent).toContain("Enabled git:project/tool (Project).");
  });

  it("asks what a removal destroys, naming the settings and the path, before it presses", async () => {
    const remove = vi.fn(() => Promise.resolve(mutation({ action: "remove", source: "npm:search-mcp", scope: "user", requiresReload: true })));
    await render({ remove });
    const card = row("react-packages-row-user-npm:search-mcp");
    await press(() => { [...card.querySelectorAll("button")].find(node => node.textContent.includes("Remove"))?.click(); });
    expect(remove).not.toHaveBeenCalled();
    expect(card.textContent).toContain("the machine's global settings");
    expect(card.textContent).toContain("/home/dev/.pi/git/github.com/owner/search");
    await press(() => { button("Remove package").click(); });
    expect(remove).toHaveBeenCalledWith({ source: "npm:search-mcp", scope: "user" });
    expect(container.textContent).toContain("Removed npm:search-mcp (Global).");
  });

  it("notes a package pi's own filter switched off, and keeps it apart from a disabled one", async () => {
    await render({ packages: packagesResponse({ packages: [pkg({ filtered: true, enabled: false })] }) });
    const card = row("react-packages-row-user-npm:search-mcp");
    expect(card.querySelector(".rw-settings-card-status")?.textContent).toBe("Filtered off");
    expect(card.querySelector(".rw-settings-card-diagnostic")?.textContent).toContain("pi's package filter");
  });

  it("answers an empty machine and an empty project in their own words", async () => {
    await render({ packages: packagesResponse({ packages: [], projectPath: "/repo", projectTrusted: true, projectScopeRead: true }) });
    expect(container.textContent).toContain("No packages are installed on this machine.");
    expect(container.textContent).toContain("repo has no packages");
  });

  it("disables every control while one operation runs, and names the package it is working on", async () => {
    let release: () => void = () => { throw new Error("the install never started"); };
    const install = () => new Promise<PiPackageMutationResponse>(resolve => {
      release = () => { resolve(mutation({ action: "install", source: "npm:slow", scope: "user" })); };
    });
    await render({ install });
    const field = container.querySelector<HTMLInputElement>('[aria-label="Package source"]');
    if (field === null) throw new Error("The package source field did not render.");
    await press(() => { type(field, "npm:slow"); });
    await press(() => { button("Install").click(); });
    expect(container.textContent).toContain("Installing npm:slow — package controls are disabled while it runs");
    expect(button("Update All").disabled).toBe(true);
    expect(button("Reload").disabled).toBe(true);
    const card = row("react-packages-row-user-npm:search-mcp");
    expect([...card.querySelectorAll("button")].every(node => node.disabled)).toBe(true);
    await press(() => { release(); });
    expect(button("Reload").disabled).toBe(false);
  });

  it("keeps the list on screen and reports the machine's refusal", async () => {
    await render({ update: () => Promise.reject(new Error("git pull failed: no remote named origin")) });
    await press(() => { button("Update All").click(); });
    expect(container.querySelector(".rw-settings-notice.is-danger")?.textContent).toContain("no remote named origin");
    expect(rows()).toHaveLength(1);

    function rows() {
      return container.querySelectorAll(".rw-settings-card");
    }
  });

  it("reloads the page's answer when asked", async () => {
    const onReload = vi.fn();
    await render({ onReload });
    await press(() => { button("Reload").click(); });
    expect(onReload).toHaveBeenCalledTimes(1);
  });
});
