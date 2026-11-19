import { useEffect, useRef, useState } from "react";
import type { Machine } from "../api";
import { NATIVE_THEME_CHOICES, applyNativeThemeById, readStoredThemePreference, serializedThemePreference, writeStoredThemePreference } from "../theme";
import { CORE_BUILTIN_DARK_THEME_ID } from "../builtinDarkTheme";
import type { QualifiedContributionId } from "../plugins/types";
import type { PaintScope } from "../themePaint";
import { McpSettingsPanel } from "./McpSettingsPanel";
import { NotificationsSettingsPanel } from "./NotificationsSettingsPanel";
import type { ReactWorkspaceData } from "./useReactWorkspaceData";

const pages = ["General", "Appearance", "Notifications", "Pi Packages", "MCP Servers", "Pi Web Plugins", "Machines", "Skills"] as const;
type Page = typeof pages[number];

type SettingsData = Pick<ReactWorkspaceData,
  "selectedProject" | "settings" | "loadSettings" | "saveSettings" | "setPluginEnabled" | "installPackage" | "updatePackage" | "removePackage" | "setSkillEnabled" | "setMcpEnabled" | "testMcp" | "removeMcp" | "saveMcp" | "selectMachine" | "addMachine" | "renameMachine" | "removeMachine"
> & { readonly state: Pick<ReactWorkspaceData["state"], "selectedMachine" | "machines" | "error"> };

export interface ReactSettingsDialogProps {
  readonly data: SettingsData;
  readonly open: boolean;
  readonly onClose: () => void;
}

export function ReactSettingsDialog({ data, open, onClose }: ReactSettingsDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [page, setPage] = useState<Page>("General");
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [packageSource, setPackageSource] = useState("");
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
  const statusMessage = notice ?? data.settings.notice ?? data.settings.error;
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
          {pages.map(item => <button type="button" key={item} className={page === item ? "active" : ""} aria-current={page === item ? "page" : undefined} onClick={() => setPage(item)}>{item}</button>)}
        </nav>
        <div className="rw-settings-content">
          <header className="rw-settings-page-heading"><h3>{page}</h3><button type="button" onClick={() => void data.loadSettings()} disabled={data.settings.loading}>Reload</button></header>
          {data.settings.loading && <p role="status">Loading settings…</p>}
          {statusMessage && <p className="rw-settings-notice" role="status">{statusMessage}</p>}
          {page === "General" && <section>
            {data.settings.config ? <>
              <label>Host<input defaultValue={data.settings.config.config.host ?? ""} key={`${data.settings.config.path}-host`} onBlur={event => saveConfig({ host: event.target.value })}/></label>
              <label>Port<input type="number" defaultValue={data.settings.config.config.port ?? 8505} key={`${data.settings.config.path}-port`} onBlur={event => saveConfig({ port: Number(event.target.value) })}/></label>
              <label className="rw-setting-check"><input type="checkbox" defaultChecked={data.settings.config.config.environmentFacts !== false} key={String(data.settings.config.config.environmentFacts)} onChange={event => saveConfig({ environmentFacts: event.target.checked })}/> Include environment facts in session prompts</label>
              <label className="rw-setting-check"><input type="checkbox" defaultChecked={data.settings.config.config.piBuiltInExtensions !== false} key={String(data.settings.config.config.piBuiltInExtensions)} onChange={event => saveConfig({ piBuiltInExtensions: event.target.checked })}/> Load Pi built-in extensions</label>
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
          {page === "Pi Packages" && <section>
            <form onSubmit={event => { event.preventDefault(); void run(async () => { await data.installPackage(packageSource); setPackageSource(""); }); }}><input aria-label="Package source" placeholder="Package source (URL or registry)" value={packageSource} onChange={event => setPackageSource(event.target.value)}/><button disabled={!packageSource.trim() || busy}>Install</button><button type="button" onClick={() => void run(() => data.updatePackage())} disabled={busy}>Update all</button></form>
            {data.settings.packages?.packages.map(pkg => <div className="rw-setting-row" key={pkg.source}><span><b>{pkg.source}</b><small>{pkg.scope} · {pkg.enabled ? "enabled" : "disabled"}</small></span><button type="button" onClick={() => void run(() => data.removePackage(pkg.source, pkg.scope))} disabled={busy}>Remove</button></div>)}
          </section>}
          {page === "MCP Servers" && <McpSettingsPanel data={data} busy={busy} run={run} />}
          {page === "Pi Web Plugins" && <section>
            {data.settings.plugins?.plugins.map(plugin => <label className="rw-setting-check" key={plugin.id}><input type="checkbox" checked={plugin.enabled} disabled={!plugin.discovered || busy} onChange={event => void run(() => data.setPluginEnabled(plugin.id, event.target.checked))}/><span><b>{plugin.id}</b><small>{plugin.source} · {plugin.scope} · {plugin.server?.state ?? "unknown"}{plugin.server?.restartRequired ? " · restart required" : ""}</small></span></label>)}
            {!data.settings.plugins?.plugins.length && !data.settings.loading && <p>No plugins were returned for this machine.</p>}
          </section>}
          {page === "Machines" && <section>
            <label>Selected machine<select value={machineId} onChange={event => { const machine = machines.find(candidate => candidate.id === event.target.value); if (machine) void data.selectMachine(machine); }}>
              {machines.map(machine => <option key={machine.id} value={machine.id}>{machine.name} · {machine.kind}</option>)}
            </select></label>
            {selectedMachine && <form onSubmit={event => { event.preventDefault(); void run(() => data.renameMachine(selectedMachine, renameDraft.trim())); }}><label>Machine name<input value={renameDraft} onChange={event => setRenameDraft(event.target.value)}/></label><button disabled={busy || !renameDraft.trim()}>Rename selected machine</button><button type="button" disabled={busy || selectedMachine.kind === "local"} onClick={() => { if (window.confirm(`Remove ${selectedMachine.name}?`)) void run(() => data.removeMachine(selectedMachine)); }}>Remove selected machine</button></form>}
            <form onSubmit={event => { event.preventDefault(); void run(async () => { await data.addMachine({ name: machineName, baseUrl: machineUrl, ...(machineToken ? { token: machineToken } : {}) }); setMachineName(""); setMachineUrl(""); setMachineToken(""); }); }}><h4>Add machine</h4><label>Name<input value={machineName} onChange={event => setMachineName(event.target.value)}/></label><label>Base URL<input type="url" value={machineUrl} onChange={event => setMachineUrl(event.target.value)}/></label><label>Access token<input type="password" autoComplete="new-password" value={machineToken} onChange={event => setMachineToken(event.target.value)}/></label><button disabled={busy || !machineName.trim() || !machineUrl.trim()}>Add machine</button></form>
          </section>}
          {page === "Skills" && <section>
            {data.settings.skills?.skills.map(skill => <label className="rw-setting-check" key={skill.id}><input type="checkbox" checked={skill.enabled} disabled={busy || skill.ownerPackageDisabled === true} onChange={event => void run(() => data.setSkillEnabled(skill, event.target.checked))}/><span><b>{skill.name}</b><small>{skill.scope} · {skill.origin} · {skill.validation}{skill.validationMessage ? ` · ${skill.validationMessage}` : ""}</small></span></label>)}
            {!data.settings.skills?.skills.length && !data.settings.loading && <p>No skills were returned for this scope.</p>}
          </section>}
        </div>
      </div>
    </div>
  </dialog>;
}
