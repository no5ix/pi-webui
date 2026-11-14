// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { PiPackageInfo, PiPackageScope } from "../../api";
import { SettingsPackagesPanel } from "./SettingsPackagesPanel";
import type { SettingsMachineTarget } from "./settingsMachineTarget";

/**
 * The package switch, tested where it is pressed.
 *
 * Turning a Pi package off is not uninstalling it: pi keeps the package installed and configured,
 * and supplies none of its resources. The panel has to say that in the same breath as the switch,
 * and a disabled package has to read as a package that is off, not as a package that is missing.
 */

const remoteTarget: SettingsMachineTarget = { id: "lab-mac", name: "Lab Mac", kind: "remote" };

afterEach(() => {
  document.body.replaceChildren();
});

function pkg(source: string, overrides: Partial<PiPackageInfo> = {}): PiPackageInfo {
  return {
    source,
    scope: "user",
    filtered: false,
    disabled: false,
    enabled: true,
    installedPath: "/pi/packages/acme-tools",
    ...overrides,
  };
}

async function mount(configure: (panel: SettingsPackagesPanel) => void = () => undefined): Promise<SettingsPackagesPanel> {
  const panel = new SettingsPackagesPanel();
  configure(panel);
  document.body.append(panel);
  await panel.updateComplete;
  return panel;
}

function panelText(panel: SettingsPackagesPanel): string {
  const parts: string[] = [];
  visit(panel.shadowRoot);
  return parts.join(" ");

  function visit(root: ShadowRoot | null): void {
    if (root === null) return;
    parts.push(root.textContent);
    for (const child of Array.from(root.querySelectorAll<HTMLElement>("*"))) visit(child.shadowRoot);
  }
}

function switches(panel: SettingsPackagesPanel): HTMLInputElement[] {
  return Array.from(panel.shadowRoot?.querySelectorAll<HTMLInputElement>(".toggle input") ?? []);
}

function flip(input: HTMLInputElement, checked: boolean): void {
  input.checked = checked;
  input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
}

describe("the Pi package enable switch", () => {
  it("switches the package the row names, with the scope the row was read from", async () => {
    const onTogglePackage = vi.fn<(source: string, scope: PiPackageScope, enabled: boolean) => void>();
    const panel = await mount((element) => {
      element.packagesResponse = { packages: [pkg("npm:@acme/tools"), pkg("../project-tools", { scope: "project", installedPath: "/work/project/.pi/packages/tools" })] };
      element.onTogglePackage = onTogglePackage;
    });

    const projectSwitch = switches(panel)[1];
    if (projectSwitch === undefined) throw new Error("Expected a switch on the second package row");
    flip(projectSwitch, false);

    expect(onTogglePackage).toHaveBeenCalledWith("../project-tools", "project", false);
  });

  it("shows a package that is off as off, and says it stays installed", async () => {
    const panel = await mount((element) => {
      element.packagesResponse = { packages: [pkg("npm:@acme/tools", { enabled: false, disabled: true })] };
    });

    const text = panelText(panel);
    expect(text).toContain("Turned off in Pi package settings");
    expect(text).toContain("It stays installed and stays configured.");
    expect(text).toContain("Off");
    expect(switches(panel)[0]?.checked).toBe(false);
  });

  it("switches a package that is off back on", async () => {
    const onTogglePackage = vi.fn<(source: string, scope: PiPackageScope, enabled: boolean) => void>();
    const panel = await mount((element) => {
      element.packagesResponse = { packages: [pkg("npm:@acme/tools", { enabled: false, disabled: true })] };
      element.onTogglePackage = onTogglePackage;
    });

    const offSwitch = switches(panel)[0];
    if (offSwitch === undefined) throw new Error("Expected a switch on the turned-off package row");
    flip(offSwitch, true);

    expect(onTogglePackage).toHaveBeenCalledWith("npm:@acme/tools", "user", true);
  });

  it("locks every switch while one write is in flight, and marks the row that is saving", async () => {
    const panel = await mount((element) => {
      element.packagesResponse = { packages: [pkg("npm:@acme/tools"), pkg("npm:@acme/other")] };
      element.operation = { kind: "set-enabled", source: "npm:@acme/tools" };
    });

    expect(switches(panel).every((input) => input.disabled)).toBe(true);
    expect(panelText(panel)).toContain("Saving…");
  });

  it("names the machine the switch writes to, on a remote one", async () => {
    const panel = await mount((element) => {
      element.targetMachine = remoteTarget;
      element.packagesResponse = { packages: [pkg("npm:@acme/tools")] };
      element.operationMessage = "Pi package npm:@acme/tools enabled or disabled on Lab Mac. Reload each idle PI WEB session on Lab Mac to apply it.";
    });

    const text = panelText(panel);
    expect(text).toContain("Lab Mac");
    expect(text).toContain("enabled or disabled on Lab Mac");
  });

  it("keeps install, update, and remove beside the switch, unchanged", async () => {
    const panel = await mount((element) => {
      element.packagesResponse = { packages: [pkg("npm:@acme/tools")] };
    });

    const labels = Array.from(panel.shadowRoot?.querySelectorAll("button") ?? []).map((button) => button.textContent.trim());
    expect(labels).toContain("Update");
    expect(labels).toContain("Remove");
    expect(panel.shadowRoot?.querySelector("#package-source")).not.toBeNull();
  });
});
