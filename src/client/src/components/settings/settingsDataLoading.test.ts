import { describe, expect, it } from "vitest";
import type { PiMcpListResponse, PiPackagesResponse, PiSkillsResponse, PiWebConfigResponse, PiWebPluginsResponse } from "../../api";
import { loadGatewaySettingsData, loadPiMcpData, loadPiPackagesData, loadPiSkillsData } from "./settingsDataLoading";

const configResponse: PiWebConfigResponse = {
  path: "/home/test/.config/pi-web/config.json",
  exists: true,
  config: { host: "127.0.0.1" },
  effectiveConfig: { host: "127.0.0.1" },
  envOverrides: { host: false, port: false, allowedHosts: false },
};

const pluginsResponse: PiWebPluginsResponse = {
  lifecycleVersion: 1,
  plugins: [],
  diagnostics: [],
  serverRuntime: {
    status: "available",
    restartRequired: false,
    recovery: {
      showSafeStart: "pi-web plugins safe-start show",
      bundledOnly: "pi-web plugins safe-start set bundled-only --restart",
      noServerPlugins: "pi-web plugins safe-start set none --restart",
      clearSafeStart: "pi-web plugins safe-start clear --restart",
    },
  },
};
const packagesResponse: PiPackagesResponse = { packages: [{ source: "npm:@acme/tools", scope: "user", filtered: false, disabled: false, enabled: true }] };

const remoteTarget = { id: "remote-a", name: "Lab Mac", kind: "remote" } as const;

describe("settings data loading helpers", () => {
  it("loads gateway settings without depending on Pi package data", async () => {
    const result = await loadGatewaySettingsData({
      loadConfig: () => Promise.resolve(configResponse),
      loadPlugins: () => Promise.resolve(pluginsResponse),
    });

    expect(result).toEqual({ config: configResponse, plugins: pluginsResponse, error: "" });
  });

  it("keeps gateway settings errors scoped to gateway config and plugins", async () => {
    const result = await loadGatewaySettingsData({
      loadConfig: () => Promise.resolve(configResponse),
      loadPlugins: () => Promise.reject(new Error("plugin scan failed")),
    });

    expect(result.config).toBe(configResponse);
    expect(result.plugins).toBeUndefined();
    expect(result.error).toBe("Failed to load settings: PI WEB plugins: plugin scan failed · trying again…");
  });

  it("loads Pi packages for the selected target with package-scoped errors", async () => {
    const requestedTargets: string[] = [];
    const success = await loadPiPackagesData(remoteTarget, (targetId) => {
      requestedTargets.push(targetId);
      return Promise.resolve(packagesResponse);
    });
    const failure = await loadPiPackagesData(remoteTarget, (targetId) => {
      requestedTargets.push(targetId);
      return Promise.reject(new Error("Remote machine unavailable"));
    });

    expect(requestedTargets).toEqual(["remote-a", "remote-a"]);
    expect(success).toEqual({ packagesResponse, error: "" });
    expect(failure.packagesResponse).toBeUndefined();
    expect(failure.error).toBe("Failed to load Pi packages from Lab Mac (remote machine): Could not reach Lab Mac · trying again…");
  });
});

const skillsResponse: PiSkillsResponse = {
  skills: [{
    name: "pdf",
    description: "Work with PDF files",
    filePath: "/pi/skills/pdf/SKILL.md",
    baseDir: "/pi/skills/pdf",
    scope: "global",
    origin: "agent",
    source: "user",
    preference: "default",
    enabled: true,
    validation: "valid",
  }],
  diagnostics: [],
  scopes: [{ scope: "global", skillsDir: "/pi/skills", configPath: "/pi-web/config.json" }],
};

const mcpResponse: PiMcpListResponse = {
  servers: [{
    name: "files",
    scope: "global",
    transport: "stdio",
    configured: "enabled",
    configPath: "/pi/mcp.json",
    targets: [{ kind: "definition", scope: "global", configPath: "/pi/mcp.json" }],
    enabled: true,
    command: "mcp-files",
    probe: { state: "unprobed" },
  }],
  errors: [],
  globalConfigPath: "/pi/mcp.json",
  projectTrusted: false,
  projectScopeRead: false,
};

describe("loading skills and MCP servers for a selected target", () => {
  it("asks the machine that is selected, and hands back what that machine answered", async () => {
    const requestedTargets: string[] = [];

    const skills = await loadPiSkillsData(remoteTarget, (targetId) => {
      requestedTargets.push(targetId);
      return Promise.resolve(skillsResponse);
    });
    const mcp = await loadPiMcpData(remoteTarget, (targetId) => {
      requestedTargets.push(targetId);
      return Promise.resolve(mcpResponse);
    });

    expect(requestedTargets).toEqual(["remote-a", "remote-a"]);
    expect(skills).toEqual({ skillsResponse, error: "" });
    expect(mcp).toEqual({ mcpResponse, error: "" });
  });

  it("carries a failed read as an error naming the machine, and no rows to draw", async () => {
    const skills = await loadPiSkillsData(remoteTarget, () => Promise.reject(new Error("Remote machine unavailable")));
    const mcp = await loadPiMcpData(remoteTarget, () => Promise.reject(new Error("Remote machine unavailable")));

    expect(skills.skillsResponse).toBeUndefined();
    expect(mcp.mcpResponse).toBeUndefined();
    expect(skills.error).toBe("Failed to load skills from Lab Mac (remote machine): Could not reach Lab Mac · trying again…");
    expect(mcp.error).toBe("Failed to load MCP servers from Lab Mac (remote machine): Could not reach Lab Mac · trying again…");
  });
});
