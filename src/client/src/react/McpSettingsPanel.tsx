import { useState } from "react";
import type { PiMcpServerInfo, PiMcpWriteKind } from "../api";
import type { ReactWorkspaceData } from "./useReactWorkspaceData";
import { emptyMcpForm, mcpFormFromServer, mcpFormProblem, mcpSaveRequestFromForm, secretNamesLine, type McpFormState } from "./mcpForm";
import {
  piMcpBusyLabel,
  piMcpConfigLocationLines,
  piMcpDiagnostics,
  piMcpEmptyNote,
  piMcpNotLoadedNote,
  piMcpGlobalRows,
  piMcpMetaLines,
  piMcpGlobalSectionTitle,
  piMcpProjectSectionTitle,
  piMcpProjectSectionNote,
  piMcpProjectSectionState,
  piMcpScopeProjectName,
  piMcpProjectRows,
  piMcpRowTestId,
  piMcpScopeNote,
  piMcpScopeWriteNote,
  piMcpStatusLabel,
  piMcpStatusTone,
  piMcpTrustNote,
  piMcpSecurityLines,
} from "./settings/piMcpSettingsState";
import { NoticeList,
  SettingsButton,
  SettingsCard,
  SettingsConfirmAction,
  SettingsEmpty,
  SettingsNotice,
  SettingsProjectSelect,
  SettingsSection,
  SettingsToggle,
  type SettingsProjectScope,
  SettingsField,
} from "./settings/SettingsKit";

/**
 * The MCP Servers page: the rows pi's config files answer with, and the form that writes one.
 *
 * The page is a form over `mcp.json`, so it shows what those files say and nothing else. A row names
 * its file, its transport, its probe, and the *names* of any secrets; the form can prefill exactly
 * those, and a value PI WEB hides stays out of the request. That is the honest shape: pi owns the
 * secrets, and a save that did not see one must not delete it.
 *
 * The project selector chooses the project whose `mcp.json` the page reads, because the Settings dialog
 * covers the workspace where the project is normally chosen. The "Write to" choice is the part with the
 * consequence: the same name can live in the machine's global file, in the project's own file, and as
 * the project's override of a global server, and a press has to say which one it means - the machine
 * resolves a project's file only for a request that names a project, and a project's press is refused
 * when it would land on the global file. The scope and copy rules live in ./settings/piMcpSettingsState.
 */
type McpPanelData = Pick<ReactWorkspaceData, "settings" | "selectedProject" | "setMcpEnabled" | "testMcp" | "removeMcp" | "saveMcp">;

export interface McpSettingsPanelProps {
  readonly data: McpPanelData;
  readonly busy: boolean;
  readonly run: <T>(action: () => Promise<T>) => Promise<T | undefined>;
  readonly machineLabel: string;
  readonly projectScope?: SettingsProjectScope | undefined;
  readonly notice?: string | undefined;
  readonly error?: string | undefined;
}

interface WriteOption {
  readonly label: string;
  readonly target: PiMcpWriteKind;
  readonly projectScope: boolean;
}

export function McpSettingsPanel({ data, busy, run, machineLabel, projectScope, notice, error }: McpSettingsPanelProps) {
  const [form, setForm] = useState<McpFormState>();
  const [problem, setProblem] = useState<string>();
  const [busyLabel, setBusyLabel] = useState<string>();
  const mcp = data.settings.mcp;
  const servers = mcp?.servers ?? [];
  const projectRows = piMcpProjectRows(servers);
  const globalRows = piMcpGlobalRows(servers);
  const scopeProjectId = projectScope?.projectId ?? data.selectedProject?.id;
  const projectName = piMcpScopeProjectName(projectScope?.projects, data.selectedProject, scopeProjectId);
  const projectSectionState = piMcpProjectSectionState({ projectId: scopeProjectId, response: mcp, rowCount: projectRows.length });
  const locked = busy || data.settings.loading;
  const trustNote = mcp === undefined ? undefined : piMcpTrustNote(mcp, projectName);

  const act = async <T,>(label: string, action: () => Promise<T>): Promise<T | undefined> => {
    setBusyLabel(label);
    try {
      return await run(action);
    } finally {
      setBusyLabel(undefined);
    }
  };

  const openAdd = () => {
    setProblem(undefined);
    setForm({ ...emptyMcpForm(), projectScope: scopeProjectId === undefined ? false : true });
  };

  const openEdit = (server: PiMcpServerInfo) => {
    const target = server.targets.find((entry) => entry.kind === "definition") ?? server.targets[0];
    if (target === undefined) return;
    setProblem(undefined);
    setForm(mcpFormFromServer(server, target));
  };

  const save = () => {
    if (form === undefined) return;
    const invalid = mcpFormProblem(form);
    if (invalid !== undefined) {
      setProblem(invalid);
      return;
    }
    setProblem(undefined);
    void act(piMcpBusyLabel("save"), async () => {
      await data.saveMcp(mcpSaveRequestFromForm(form, scopeProjectId));
      setForm(undefined);
    });
  };

  const writeOptions = (editing: boolean): readonly WriteOption[] => [
    { label: "Global config (this machine's mcp.json)", target: "definition", projectScope: false },
    ...(scopeProjectId === undefined ? [] : [{ label: "This project's mcp.json", target: "definition" as PiMcpWriteKind, projectScope: true }]),
    ...(editing && scopeProjectId !== undefined ? [{ label: "This project's override of the global server", target: "override" as PiMcpWriteKind, projectScope: true }] : []),
  ];

  const setField = <K extends keyof McpFormState>(key: K, value: McpFormState[K]) => {
    setForm(current => (current === undefined ? current : { ...current, [key]: value }));
    setProblem(undefined);
  };

  const row = (server: PiMcpServerInfo) => <SettingsCard
    key={server.name}
    testId={piMcpRowTestId(server)}
    title={server.name}
    status={piMcpStatusLabel(server)}
    statusTone={piMcpStatusTone(server)}
    off={!server.enabled}
    meta={piMcpMetaLines(server)}
    diagnostics={piMcpDiagnostics(server)}
    actions={<>
      <SettingsToggle
        label="Enabled"
        checked={server.enabled}
        disabled={locked || server.targets.length === 0}
        title={server.targets.length === 0 ? "No config file at this scope can be written" : "Enable or disable this server"}
        onChange={enabled => void act(piMcpBusyLabel("enable", server), () => data.setMcpEnabled(server, enabled))}
      />
      <SettingsButton
        label="Test connection"
        disabled={locked}
        title="Probe the server without changing any config"
        onClick={() => void act(piMcpBusyLabel("test", server), () => data.testMcp(server))}
      />
      <SettingsButton
        label="Edit"
        disabled={locked || server.targets.length === 0}
        title={server.targets.length === 0 ? "No config file at this scope can be written" : "Edit this server's definition"}
        onClick={() => openEdit(server)}
      />
      <SettingsConfirmAction
        label="Remove"
        question={`Remove “${server.name}” from ${server.configPath}? A running session keeps its tools until it reloads.`}
        confirmLabel="Remove from this file"
        disabled={locked || server.targets.length === 0}
        title={server.targets.length === 0 ? "No config file at this scope can be written" : "Remove this entry from its config file"}
        onConfirm={() => void act(piMcpBusyLabel("remove", server), () => data.removeMcp(server))}
      />
    </>}
  />;

  return <section className="rw-mcp-panel">
    {mcp?.errors.map((entry, index) => <p className="rw-settings-notice" key={`error-${index}`}>{entry}</p>)}
    <NoticeList busy={busyLabel} notice={notice === undefined ? [] : [notice]} error={error === undefined ? [] : [error]}/>
    {projectScope === undefined ? null
      : <SettingsProjectSelect scope={projectScope} disabled={locked} note={piMcpScopeWriteNote(projectScope.projectId, machineLabel)}/>}
    <SettingsSection title="Configuration" note="pi reads these files when a session starts. The page shows what they say and writes them through pi.">
      <ul className="rw-settings-facts">
        {piMcpConfigLocationLines(mcp ?? { servers: [], errors: [], globalConfigPath: "unknown", projectTrusted: false, projectScopeRead: false }, machineLabel, data.selectedProject?.name)
          .map(line => <li key={line}>{line}</li>)}
      </ul>
      {mcp === undefined ? <SettingsNotice tone="info">No answer from this machine yet.</SettingsNotice> : null}
      {trustNote === undefined ? null : <SettingsNotice tone="warning">{trustNote}</SettingsNotice>}
      {piMcpSecurityLines().map(line => <SettingsNotice key={line} tone="security">{line}</SettingsNotice>)}
    </SettingsSection>
    <div className="rw-mcp-toolbar">
      <SettingsButton label="Add server" disabled={locked} title="Add a server to the scope chosen above" onClick={openAdd}/>
      <p>Servers connect when a session starts. Secrets stay in pi's config files: PI WEB shows their names, never their values.</p>
    </div>
    {mcp === undefined && data.settings.loading ? <p role="status">Loading the servers pi configured…</p> : null}
    <SettingsSection
      title={piMcpProjectSectionTitle(projectName, projectSectionState)}
      note={piMcpProjectSectionNote(projectSectionState, projectName, machineLabel)}
      actions={projectSectionState === "no-project" ? undefined : <SettingsButton label="Add project server" disabled={locked} title="Add a server to this project's mcp.json" onClick={openAdd}/>}
    >
      {projectSectionState === "rows"
        ? projectRows.map(row)
        : <SettingsEmpty>{piMcpProjectSectionNote(projectSectionState, projectName, machineLabel)}</SettingsEmpty>}
    </SettingsSection>
    <SettingsSection title="Global MCP servers" note={piMcpScopeNote("global", globalRows.length, projectName, machineLabel)}>
      {globalRows.length === 0
        ? <SettingsEmpty>{mcp === undefined ? piMcpNotLoadedNote() : piMcpEmptyNote("global")}</SettingsEmpty>
        : globalRows.map(row)}
    </SettingsSection>
    {form !== undefined && <form className="rw-mcp-form" onSubmit={event => { event.preventDefault(); save(); }}>
      <h4>{form.editing ? `Edit “${form.name}”` : "Add an MCP server"}</h4>
      {problem !== undefined && <p className="rw-settings-notice" role="alert">{problem}</p>}
      <p className="rw-mcp-form-wide">This write goes to {form.projectScope ? (form.target === "override" ? "this project's override of the global server" : `this project's mcp.json`) : `${machineLabel}'s global mcp.json`}.</p>
      <div className="rw-mcp-form-grid">
        <SettingsField label="Name"><input value={form.name} disabled={form.editing} onChange={event => setField("name", event.target.value)}/></SettingsField>
        {form.target === "override"
          ? <p className="rw-mcp-form-wide">An override changes only what this project says about a global server: its enabled switch and its exposure. The command, URL, and secrets stay in the global file.</p>
          : <>
            <SettingsField label="Transport"><select value={form.transport} onChange={event => setField("transport", event.target.value === "http" ? "http" : "stdio")}>
              <option value="stdio">stdio (a command pi runs)</option>
              <option value="http">streamable HTTP (a URL)</option>
            </select></SettingsField>
            <SettingsField label="Write to"><select value={`${form.target}:${form.projectScope}`} onChange={event => {
              const option = writeOptions(form.editing).find(candidate => `${candidate.target}:${candidate.projectScope}` === event.target.value);
              if (option !== undefined) setForm(current => (current === undefined ? current : { ...current, target: option.target, projectScope: option.projectScope }));
            }}>
              {writeOptions(form.editing).map(option => <option key={`${option.target}:${option.projectScope}`} value={`${option.target}:${option.projectScope}`}>{option.label}</option>)}
            </select></SettingsField>
            <SettingsField wide label="Description" note="pi's note about the server. It is written into the config file beside the rest of the definition."><input value={form.description} placeholder="What this server is for" onChange={event => setField("description", event.target.value)}/></SettingsField>
            {form.transport === "stdio"
              ? <>
                <SettingsField label="Command"><input value={form.command} placeholder="npx" onChange={event => setField("command", event.target.value)}/></SettingsField>
                <SettingsField label="Arguments" note={form.editing ? "Leave this empty to keep the arguments the file has; typing replaces the whole list." : "Separated by spaces; quote an argument that contains one."}><input value={form.args} placeholder="-y @modelcontextprotocol/server-filesystem /srv/data" onChange={event => setField("args", event.target.value)}/></SettingsField>
                <SettingsField label="Working directory"><input value={form.cwd} placeholder="/srv/data" onChange={event => setField("cwd", event.target.value)}/></SettingsField>
                <SettingsField wide label="Environment variables" note={form.editing && form.existingEnvNames.length > 0
                  ? `This server sets ${form.existingEnvNames.join(", ")}. Leave the field empty to keep those values; typing replaces the whole set.`
                  : "One NAME=value per line. Values go into pi's config file on this machine."}><textarea rows={3} value={form.env} placeholder="API_TOKEN=…" onChange={event => setField("env", event.target.value)}/></SettingsField>
              </>
              : <>
                <SettingsField wide label="URL"><input value={form.url} placeholder="https://mcp.example.com/mcp" onChange={event => setField("url", event.target.value)}/></SettingsField>
                <SettingsField wide label="Headers" note={form.editing && form.existingHeaderNames.length > 0
                  ? `This server sends ${form.existingHeaderNames.join(", ")}. Leave the field empty to keep those values; typing replaces the whole set.`
                  : "One Name: value per line. Values go into pi's config file on this machine."}><textarea rows={3} value={form.headers} placeholder="Authorization: Bearer …" onChange={event => setField("headers", event.target.value)}/></SettingsField>
              </>}
            <SettingsField label="Timeout (seconds)"><input value={form.timeout} inputMode="numeric" placeholder="pi's default" onChange={event => setField("timeout", event.target.value)}/></SettingsField>
        </>}
        <SettingsField label="Exposure"><select value={form.exposure} onChange={event => setField("exposure", event.target.value === "" ? "" : event.target.value as McpFormState["exposure"])}>
          <option value="">pi's default (codemode)</option>
          <option value="codemode">codemode</option>
          <option value="deferred">deferred</option>
          <option value="direct">direct</option>
          <option value="hidden">hidden</option>
        </select></SettingsField>
        <label className="rw-setting-check"><input type="checkbox" checked={form.enabled} onChange={event => setField("enabled", event.target.checked)}/>Enabled</label>
      </div>
      <div className="rw-mcp-form-actions">
        <button type="submit" disabled={busy}>Save</button>
        <button type="button" onClick={() => { setForm(undefined); setProblem(undefined); }} disabled={busy}>Cancel</button>
      </div>
      <p className="rw-mcp-form-wide">
        {form.existingHeaderNames.length + form.existingEnvNames.length === 0 ? "" : `Secret names already in the file: ${secretNamesLine([...form.existingHeaderNames, ...form.existingEnvNames])}.`}
      </p>
    </form>}
  </section>;
}
