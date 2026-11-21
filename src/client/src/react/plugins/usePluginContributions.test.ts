// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { html } from "lit";
import { PluginRegistry } from "../../plugins/registry";
import type { PluginContributions } from "../../plugins/types";
import { usePluginContributions } from "./usePluginContributions";

const react = () => createElement("span", null, "contribution");
const lit = () => html`<span>contribution</span>`;

function snapshotOf(registry: PluginRegistry | undefined, machineId = "local") {
  let snapshot: ReturnType<typeof usePluginContributions> | undefined;
  function Probe() {
    snapshot = usePluginContributions(registry, machineId, 0);
    return null;
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => {
    root.render(createElement(Probe));
  });
  act(() => {
    root.unmount();
  });
  if (snapshot === undefined) throw new Error("the probe did not run");
  return snapshot;
}

function registryWith(contributions: PluginContributions, machineId?: string): PluginRegistry {
  const registry = new PluginRegistry({});
  registry.register({
    id: "probe",
    ...(machineId === undefined ? {} : { machineId }),
    plugin: {
      apiVersion: 2,
      name: "probe",
      activate: () => ({ contributions: contributions }),
    },
  });
  return registry;
}

const everyFamily = {
  settingsSections: [{ id: "settings", title: "Probe", render: lit, renderReact: react }],
  navSections: [{ id: "nav", render: lit, renderReact: react }],
  workspacePanels: [{ id: "panel", title: "Probe", render: lit, renderReact: react }],
  globalPanels: [{ id: "global", title: "Probe", scope: "machine" as const, render: lit, renderReact: react }],
  composer: [{ id: "composer", slot: "leading" as const, title: "Probe", run: () => undefined }],
  activityNotes: [{ id: "note", note: () => "probing" }],
  messageActions: [{ id: "action", title: "Probe", icon: lit(), roles: ["assistant" as const], run: () => undefined }],
  codeFenceRenderers: [{ id: "fence", language: "probe", render: () => document.createTextNode("probe"), renderReact: react }],
  toolRenderers: [{ id: "tool", toolName: "probe_tool", render: lit, renderReact: react }],
  messageRenderers: [{ id: "message", tag: "probe-card", render: lit, renderReact: react }],
  listLabels: [{ id: "label", list: "sessions" as const, render: lit, renderReact: react }],
  listSections: [{ id: "section", list: "sessions" as const, sections: () => [] }],
};

describe("the React contribution snapshot", () => {
  it("lists every family the machine contributes", () => {
    const snapshot = snapshotOf(registryWith(everyFamily));
    expect(snapshot.settingsSections.map((entry) => entry.id)).toContain("probe:settings");
    expect(snapshot.navSections.map((entry) => entry.id)).toContain("probe:nav");
    expect(snapshot.workspacePanels.map((entry) => entry.id)).toContain("probe:panel");
    expect(snapshot.globalPanels.map((entry) => entry.id)).toContain("probe:global");
    expect(snapshot.composer.map((entry) => entry.id)).toContain("probe:composer");
    expect(snapshot.activityNotes.map((entry) => entry.id)).toContain("probe:note");
    expect(snapshot.messageActions.map((entry) => entry.id)).toContain("probe:action");
    expect(snapshot.findCodeFenceRenderer("probe")?.id).toBe("probe:fence");
    expect(snapshot.findToolRenderer("probe_tool")?.id).toBe("probe:tool");
    expect(snapshot.findMessageRenderer("probe-card")?.id).toBe("probe:message");
    expect(snapshot.listLabels("sessions").map((entry) => entry.id)).toContain("probe:label");
    expect(snapshot.listSections("sessions").map((entry) => entry.id)).toContain("probe:section");
  });

  it("carries the React spelling of a contribution", () => {
    const snapshot = snapshotOf(registryWith(everyFamily));
    expect(snapshot.workspacePanels[0]?.renderReact).toBeTypeOf("function");
    expect(snapshot.settingsSections[0]?.renderReact).toBeTypeOf("function");
    expect(snapshot.findCodeFenceRenderer("probe")?.renderReact).toBeTypeOf("function");
  });

  it("omits a machine-scoped family contributed for another machine", () => {
    const registry = registryWith({
      settingsSections: [{ id: "settings", title: "Remote only", render: lit, renderReact: react }],
      composer: [{ id: "composer", slot: "leading", title: "Remote only", run: () => undefined }],
    }, "remote-1");
    expect(snapshotOf(registry, "local").settingsSections.map((entry) => entry.id)).not.toContain("probe:settings");
    expect(snapshotOf(registry, "local").composer.map((entry) => entry.id)).not.toContain("probe:composer");
    expect(snapshotOf(registry, "remote-1").settingsSections.map((entry) => entry.id)).toContain("probe:settings");
  });

  it("says nothing is contributed while a machine's plugins are loading", () => {
    const snapshot = snapshotOf(undefined);
    expect(snapshot.settingsSections).toEqual([]);
    expect(snapshot.findCodeFenceRenderer("probe")).toBeUndefined();
  });
});
