import { useEffect, useRef, useState } from "react";
import type { Machine } from "../api";
import { NATIVE_THEME_CHOICES, applyNativeThemeById, readStoredThemePreference, serializedThemePreference, writeStoredThemePreference } from "../theme";
import { CORE_BUILTIN_DARK_THEME_ID } from "../builtinDarkTheme";
import type { QualifiedContributionId } from "../plugins/types";
import type { PaintScope } from "../themePaint";
import { McpSettingsPanel } from "./McpSettingsPanel";
import { NotificationsSettingsPanel } from "./NotificationsSettingsPanel";
import { PackagesSettingsPanel } from "./settings/PiPackagesSettingsPanel";
import { SkillsSettingsPanel } from "./settings/SkillsSettingsPanel";
import type { SettingsProjectScope } from "./settings/SettingsKit";
import type { ReactWorkspaceData } from "./useReactWorkspaceData";

const pages = ["General", "Appearance", "Notifications", "Pi Packages", "MCP Servers", "Pi Web Plugins", "Machines", "Skills"] as const;
type Page = typeof pages[number];

const settingsIndex: Record<Page, readonly string[]> = {
  General: ["host", "port", "environment facts", "session prompts", "pi built-in extensions", "config"],
  Appearance: ["theme", "dark", "light", "system", "appearance"],
  Notifications: ["notification", "ntfy", "topic", "server", "test", "delivery", "sound"],
  "Pi Packages": ["package", "install", "update", "remove", "source", "scope", "registry", "enabled"],
  "MCP Servers": ["mcp", "server", "command", "url", "headers", "test", "project", "user", "tool"],
  "Pi Web Plugins": ["plugin", "extension", "enable", "disable", "restart", "failure", "manifest", "load"],
  Machines: ["machine", "add", "rename", "remove", "token", "base url", "select", "local", "remote"],
  Skills: ["skill", "enable", "scope", "origin", "validation", "package"],
};

function pagesMatching(query: string): readonly Page[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return pages;
  return pages.filter(page => page.toLowerCase().includes(needle) || settingsIndex[page].some(term => term.includes(needle)));
}

type SettingsData = Pick<ReactWorkspaceData,
  "selectedProject" | "settings" | "loadSettings" | "saveSettings" | "setPluginEnabled" | "installPackage" | "updatePackage" | "removePackage" | "setPackageEnabled" | "setSkillEnabled" | "setMcpEnabled" | "testMcp" | "removeMcp" | "saveMcp" | "selectMachine" | "addMachine" | "renameMachine" | "removeMachine"
  | "projects" | "settingsProjectId" | "setSettingsProject"
> & { readonly state: Pick<ReactWorkspaceData["state"], "selectedMachine" | "machines" | "error"> };

export interface ReactSettingsDialogProps {
  readonly data: SettingsData;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly pluginFailures?: readonly string[];
}

export function ReactSettingsDialog({ data, open, onClose, pluginFailures = [] }: ReactSettingsDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [page, setPage] = useState<Page>("General");
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [themePreference, setThemePreference] = useState(() => readStoredThemePreference() ?? { themeId: CORE_BUILTIN_DARK_THEME_ID, auto: false });
  const [machineName, setMachineName] = useState("");
  const [machineUrl, setMachineUrl] = useState("");
  const [machineToken, setMachineToken] = useState("");
  const [renameDraft, setRenameDraft] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
    if (!open) setQuery("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    void data.loadSettings();
  }, [open, data.loadSettings, data.state.selectedMachine?.id, data.selectedProject?.id]);

  useEffect(() => setRenameDraft(data.state.selectedMachine?.name ?? ""), [data.state.selectedMachine?.id, data.state.selectedMachine?.name]);

  const run = async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setNotice(undefined);
    try {
      return await action();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
      return undefined;
    } finally {
      setBusy(false);
    }
  };

  const saveConfig = (patch: Record<string, unknown>) => {
    if (data.settings.config === undefined) return;
    void run(async () => {
      await data.saveSettings(patch);
    });
  };

  const machineId = data.state.selectedMachine?.id ?? "local";
  const settingsScopeKey = JSON.stringify([machineId, data.settingsProjectId]);
  const settings: ReactSettingsDialogProps["data"]["settings"] = data.settings.scopeKey === settingsScopeKey
    ? data.settings
    : { loading: true, scopeKey: settingsScopeKey };
  const machineLabel = data.state.selectedMachine?.name ?? "Local machine";
  const projects = data.projects.map(entry => entry.project);
  const settingsProject = projects.find(project => project.id === data.settingsProjectId);
  const projectScope: SettingsProjectScope = { projects, projectId: data.settingsProjectId, onSelect: data.setSettingsProject };
  const pagesThatOwnNotices: readonly Page[] = ["Pi Packages", "MCP Servers", "Skills"];
  const statusMessage = notice ?? (pagesThatOwnNotices.includes(page) ? undefined : settings.notice) ?? settings.error;
  const machines = data.state.machines;
  const selectedMachine: Machine | undefined = data.state.selectedMachine;

  return <dialog ref={dialogRef} className="rw-settings-dialog" aria-labelledby="rw-settings-title" onClose={onClose}>
    <div className="rw-settings-window">
      <header className="rw-settings-titlebar">
        <div><h2 id="rw-settings-title">Settings</h2><small>{data.state.selectedMachine?.name ?? "Local machine"} · {data.selectedProject?.name ?? "Global scope"}</small></div>
        <button type="button" aria-label="Close settings" onClick={() => dialogRef.current?.close()}>×</button>
      </header>
      <div className="rw-settings-layout">
        <nav className="rw-settings-nav" aria-label="Settings pages">
          <input className="rw-settings-search" type="search" aria-label="Search settings" placeholder="Search settings" value={query} onChange={event => setQuery(event.target.value)}/>
          {pagesMatching(query).map(item => <button type="button" key={item} className={page === item ? "active" : ""} aria-current={page === item ? "page" : undefined} onClick={() => setPage(item)}>{item}</button>)}
          {pagesMatching(query).length === 0 && <p className="rw-settings-empty" role="status">No settings match “{query.trim()}”.</p>}
        </nav>
        <div className="rw-settings-content">
          <header className="rw-settings-page-heading"><h3>{page}</h3><button type="button" onClick={() => void data.loadSettings()} disabled={settings.loading}>Reload</button></header>
          {settings.loading && <p role="status">Loading settings…</p>}
          {statusMessage && <p className="rw-settings-notice" role="status">{statusMessage}</p>}
          {page === "General" && <section>
            {settings.config ? <>
              <label>Host<input defaultValue={settings.config.config.host ?? ""} key={`${settings.config.path}-host`} onBlur={event => saveConfig({ host: event.target.value })}/></label>
              <label>Port<input type="number" defaultValue={settings.config.config.port ?? 8505} key={`${settings.config.path}-port`} onBlur={event => saveConfig({ port: Number(event.target.value) })}/></label>
              <label className="rw-setting-check"><input type="checkbox" defaultChecked={settings.config.config.environmentFacts !== false} key={String(settings.config.config.environmentFacts)} onChange={event => saveConfig({ environmentFacts: event.target.checked })}/> Include environment facts in session prompts</label>
              <label className="rw-setting-check"><input type="checkbox" defaultChecked={settings.config.config.piBuiltInExtensions !== false} key={String(settings.config.config.piBuiltInExtensions)} onChange={event => saveConfig({ piBuiltInExtensions: event.target.checked })}/> Load Pi built-in extensions</label>
            </> : <p>Configuration is not available yet.</p>}
          </section>}
          {page === "Appearance" && <section>
            <label>Theme<select value={themePreference.themeId} onChange={event => {
              const preference = { themeId: event.target.value as QualifiedContributionId, auto: false };
              const serialized = serializedThemePreference(preference);
              if (applyNativeThemeById(preference.themeId, { preference: serialized, followsSystem: false } satisfies PaintScope)) {
                writeStoredThemePreference(preference);
                setThemePreference(preference);
              }
            }}>{NATIVE_THEME_CHOICES.map(theme => <option key={theme.id} value={theme.id}>{theme.name}</option>)}</select></label>
            <p>Theme changes are saved in this browser and applied immediately.</p>
          </section>}
          {page === "Notifications" && <NotificationsSettingsPanel busy={busy} run={run} />}
          {page === "Pi Packages" && <PackagesSettingsPanel
            packages={settings.packages}
            busy={settings.loading}
            machineLabel={machineLabel}
            projectName={settingsProject?.name ?? ""}
            busyMessage={busy ? "Working on a setting…" : undefined}
            onReload={() => void data.loadSettings(data.settingsProjectId)}
            install={data.installPackage}
            update={data.updatePackage}
            remove={data.removePackage}
            setEnabled={data.setPackageEnabled}
          />}
          {page === "MCP Servers" && <McpSettingsPanel
            data={{ ...data, selectedProject: settingsProject ?? data.selectedProject }}
            busy={busy}
            run={run}
            machineLabel={machineLabel}
            projectScope={projectScope}
            notice={settings.notice}
            error={settings.error}
          />}
          {page === "Pi Web Plugins" && <section>
            {pluginFailures.map((failure, index) => <p key={`${failure}-${index}`} className="rw-setting-error" role="status">Plugin failed to load: {failure}</p>)}
            {settings.plugins?.plugins.map(plugin => <label className="rw-setting-check" key={plugin.id}><input type="checkbox" checked={plugin.enabled} disabled={!plugin.discovered || busy} onChange={event => void run(() => data.setPluginEnabled(plugin.id, event.target.checked))}/><span><b>{plugin.id}</b><small>{plugin.source} · {plugin.scope} · {plugin.server?.state ?? "unknown"}{plugin.server?.restartRequired ? " · restart required" : ""}</small></span></label>)}
            {!settings.plugins?.plugins.length && !settings.loading && <p>No plugins were returned for this machine.</p>}
          </section>}
          {page === "Machines" && <section>
            <label>Selected machine<select value={machineId} onChange={event => { const machine = machines.find(candidate => candidate.id === event.target.value); if (machine) void data.selectMachine(machine); }}>
              {machines.map(machine => <option key={machine.id} value={machine.id}>{machine.name} · {machine.kind}</option>)}
            </select></label>
            {selectedMachine && <form onSubmit={event => { event.preventDefault(); void run(() => data.renameMachine(selectedMachine, renameDraft.trim())); }}><label>Machine name<input value={renameDraft} onChange={event => setRenameDraft(event.target.value)}/></label><button disabled={busy || !renameDraft.trim()}>Rename selected machine</button><button type="button" disabled={busy || selectedMachine.kind === "local"} onClick={() => { if (window.confirm(`Remove ${selectedMachine.name}?`)) void run(() => data.removeMachine(selectedMachine)); }}>Remove selected machine</button></form>}
            <form onSubmit={event => { event.preventDefault(); void run(async () => { await data.addMachine({ name: machineName, baseUrl: machineUrl, ...(machineToken ? { token: machineToken } : {}) }); setMachineName(""); setMachineUrl(""); setMachineToken(""); }); }}><h4>Add machine</h4><label>Name<input value={machineName} onChange={event => setMachineName(event.target.value)}/></label><label>Base URL<input type="url" value={machineUrl} onChange={event => setMachineUrl(event.target.value)}/></label><label>Access token<input type="password" autoComplete="new-password" value={machineToken} onChange={event => setMachineToken(event.target.value)}/></label><button disabled={busy || !machineName.trim() || !machineUrl.trim()}>Add machine</button></form>
          </section>}
          {page === "Skills" && <SkillsSettingsPanel
            skills={settings.skills}
            busy={settings.loading}
            projectScope={projectScope}
            projectName={settingsProject?.name ?? ""}
            machineLabel={machineLabel}
            busyMessage={busy ? "Working on a setting…" : undefined}
            onReload={() => void data.loadSettings(data.settingsProjectId)}
            setEnabled={data.setSkillEnabled}
          />}
        </div>
      </div>
    </div>
  </dialog>;
}
