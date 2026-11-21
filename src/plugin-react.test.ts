import { afterEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import {
  installPiWebReactRuntime,
  piWebReactMember,
  piWebReactRuntime,
  piWebReactRuntimeIsInstalled,
  PiWebReactRuntimeError,
  resetPiWebReactRuntime,
} from "./plugin-react";
import { pluginReactRuntimeMembers, publishReactRuntimeForPlugins } from "./client/src/react/pluginReactRuntime";

afterEach(() => {
  resetPiWebReactRuntime();
  vi.restoreAllMocks();
});

describe("the plugin React runtime", () => {
  it("refuses to hand out React before the workspace published it", () => {
    expect(piWebReactRuntimeIsInstalled()).toBe(false);
    expect(() => piWebReactRuntime()).toThrow(PiWebReactRuntimeError);
    expect(() => piWebReactRuntime()).toThrow(/workspace publishes/);
  });

  it("hands out the members the workspace published", () => {
    installPiWebReactRuntime({ version: "test-1", members: pluginReactRuntimeMembers });
    expect(piWebReactRuntimeIsInstalled()).toBe(true);
    expect(piWebReactRuntime().version).toBe("test-1");
    expect(piWebReactMember("useId")).toBe(pluginReactRuntimeMembers.useId);
  });

  it("keeps the React that published first and reports the one that came after", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    installPiWebReactRuntime({ version: "first", members: pluginReactRuntimeMembers });
    const second = installPiWebReactRuntime({ version: "second", members: pluginReactRuntimeMembers });
    expect(second).toEqual({ accepted: false, existingVersion: "first" });
    expect(piWebReactRuntime().version).toBe("first");
    expect(warn.mock.calls.map((call) => String(call[0])).join("\n")).toContain("refusing second");
  });

  it("hands a plugin the React that renders the page", () => {
    publishReactRuntimeForPlugins();
    expect(piWebReactRuntime().version).toBe(React.version);
    expect(piWebReactMember("useState")).toBe(React.useState);
    expect(piWebReactMember("Fragment")).toBe(React.Fragment);
    expect(piWebReactMember("jsx")).toBeTypeOf("function");
  });

  it("loads a plugin's hooks module against the published React, not a bundled copy", async () => {
    publishReactRuntimeForPlugins();
    vi.resetModules();
    const hooks = await import("./plugin-react-hooks");
    expect(hooks.useId).toBe(React.useId);
    expect(hooks.useState).toBe(React.useState);
    expect(hooks.memo).toBe(React.memo);
  });

  it("refuses a plugin's hooks module when no React is published", async () => {
    vi.resetModules();
    // The message, not the class: a re-evaluated module carries its own copy of the error class, and a
    // plugin's import failing with a report that names the missing host is the contract.
    await expect(import("./plugin-react-hooks")).rejects.toThrow(/No React runtime is published/);
  });
});
