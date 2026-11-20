import { describe, expect, it } from "vitest";
import { appendSettingsFailure, beginSettingsRead, isCurrentSettingsAnswer, SETTINGS_RESOURCES, settleSettingsResource, settingsScopeKey } from "./settingsScope";

const SCOPE = { machineId: "local", projectId: "prj-1" };

describe("settings scope", () => {
  it("names the scope a read belongs to by machine and project", () => {
    expect(settingsScopeKey(SCOPE)).toBe(JSON.stringify(["local", "prj-1"]));
    expect(settingsScopeKey({ machineId: "lab", projectId: undefined })).toBe(JSON.stringify(["lab", null]));
    expect(settingsScopeKey(SCOPE)).not.toBe(settingsScopeKey({ machineId: "lab", projectId: "prj-1" }));
  });

  it("waits for exactly the resources the pages answer from", () => {
    const read = beginSettingsRead(settingsScopeKey(SCOPE), 1);
    expect(read.pending).toBe(SETTINGS_RESOURCES.length);
    expect(SETTINGS_RESOURCES).toEqual(["config", "plugins", "packages", "skills", "mcp"]);
  });

  it("is finished only when every resource has answered", () => {
    const scopeKey = settingsScopeKey(SCOPE);
    let read = beginSettingsRead(scopeKey, 4);
    for (const resource of SETTINGS_RESOURCES.slice(0, -1)) {
      read = settleSettingsResource(read, scopeKey, 4);
      expect(read.pending, resource).toBeGreaterThan(0);
    }
    read = settleSettingsResource(read, scopeKey, 4);
    expect(read.pending).toBe(0);
  });

  it("drops an answer from a read the page stopped waiting for, so a late answer never finishes a newer read", () => {
    const scopeKey = settingsScopeKey(SCOPE);
    const current = beginSettingsRead(scopeKey, 7);
    expect(settleSettingsResource(current, scopeKey, 6)).toBe(current);
    expect(isCurrentSettingsAnswer(current, scopeKey, 6)).toBe(false);
    expect(isCurrentSettingsAnswer(current, scopeKey, 7)).toBe(true);
  });

  it("drops an answer read for a scope the page left", () => {
    const current = beginSettingsRead(settingsScopeKey(SCOPE), 8);
    const otherScope = settingsScopeKey({ machineId: "local", projectId: undefined });
    expect(settleSettingsResource(current, otherScope, 8)).toBe(current);
    expect(current.pending).toBe(SETTINGS_RESOURCES.length);
  });

  it("answers a resource whose request never started, so a scope cannot load forever", () => {
    const scopeKey = settingsScopeKey(SCOPE);
    let read = beginSettingsRead(scopeKey, 9);
    // A request that throws while it is built still answers its resource: the ledger drains to zero.
    SETTINGS_RESOURCES.forEach(() => { read = settleSettingsResource(read, scopeKey, 9); });
    expect(read.pending).toBe(0);
    expect(settleSettingsResource(read, scopeKey, 9).pending).toBe(0);
  });

  it("reports every failed read of a scope, not only the last", () => {
    expect(appendSettingsFailure(undefined, undefined)).toBeUndefined();
    expect(appendSettingsFailure("config failed", undefined)).toBe("config failed");
    expect(appendSettingsFailure(undefined, "skills failed")).toBe("skills failed");
    expect(appendSettingsFailure("config failed", "skills failed")).toBe("config failed\nskills failed");
  });
});
