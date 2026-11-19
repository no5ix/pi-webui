import { useState } from "react";
import type { PiMcpServerInfo, PiMcpWriteKind } from "../api";
import type { ReactWorkspaceData } from "./useReactWorkspaceData";
import { emptyMcpForm, mcpFormFromServer, mcpFormProblem, mcpSaveRequestFromForm, secretNamesLine, type McpFormState } from "./mcpForm";

/**
 * The MCP Servers page: the rows pi's config files answer with, and the form that writes one.
 *
 * The page is a form over `mcp.json`, so it shows what those files say and nothing else. A row names
 * its file, its transport, its probe, and the *names* of any secrets; the form can prefill exactly
 * those, and a value PI WEB hides stays out of the request. That is the honest shape: pi owns the
 * secrets, and a save that did not see one must not delete it.
 *
 * The "Write to" choice is the part with the consequence. The same name can live in the machine's
 * global file, in the project's own file, and as the project's override of the global server, and a
 * press has to say which one it means - the machine resolves a project's file only for a request that
 * names a project, and a project's press is refused when it would land on the global file.
 */
type McpPanelData = Pick<ReactWorkspaceData, "settings" | "selectedProject" | "setMcpEnabled" | "testMcp" | "removeMcp" | "saveMcp">;

export interface McpSettingsPanelProps {
  readonly data: McpPanelData;
  readonly busy: boolean;
  readonly run: <T>(action: () => Promise<T>) => Promise<T | undefined>;
}

interface WriteOption {
  readonly label: string;
  readonly target: PiMcpWriteKind;
  readonly projectScope: boolean;
}

export function McpSettingsPanel({ data, busy, run }: McpSettingsPanelProps) {
  const [form, setForm] = useState<McpFormState>();
  const [problem, setProblem] = useState<string>();
  const projectId = data.selectedProject?.id;
  const servers = data.settings.mcp?.servers ?? [];

  const openAdd = () => {
    setProblem(undefined);
    setForm({ ...emptyMcpForm(), projectScope: projectId === undefined ? false : true });
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
    void run(async () => {
      await data.saveMcp(mcpSaveRequestFromForm(form, projectId));
      setForm(undefined);
    });
  };

  const writeOptions = (editing: boolean): readonly WriteOption[] => [
    { label: "Global config (this machine's mcp.json)", target: "definition", projectScope: false },
    ...(projectId === undefined ? [] : [{ label: "This project's mcp.json", target: "definition" as PiMcpWriteKind, projectScope: true }]),
    ...(editing && projectId !== undefined ? [{ label: "This project's override of the global server", target: "override" as PiMcpWriteKind, projectScope: true }] : []),
  ];

  const setField = <K extends keyof McpFormState>(key: K, value: McpFormState[K]) => {
    setForm(current => (current === undefined ? current : { ...current, [key]: value }));
    setProblem(undefined);
  };

  return <section>
    {data.settings.mcp?.errors.map((error, index) => <p className="rw-settings-notice" key={`error-${index}`}>{error}</p>)}
    <div className="rw-mcp-toolbar">
      <button type="button" onClick={openAdd} disabled={busy}>Add server</button>
      <p>Servers connect when a session starts. Secrets stay in pi's config files: PI WEB shows their names, never their values.</p>
    </div>
    {servers.length === 0 && !data.settings.loading && <p>No MCP servers were returned for this scope.</p>}
    {servers.map(server => <div className="rw-setting-row" key={server.name}>
      <span>
        <b>{server.name}</b>
        <small>
          {server.transport} · {server.scope}{server.overrideOnly ? " · overrides a global server" : ""} · {server.probe?.state ?? server.configured}
          {server.transport === "stdio" ? ` · ${server.command ?? "command hidden"}` : ` · ${server.url ?? "url hidden"}`}
          {server.exposure ? ` · ${server.exposure}` : ""}
          {server.usesSecrets ? ` · secrets: ${secretNamesLine([...(server.headerNames ?? []), ...(server.envNames ?? [])])}` : ""}
        </small>
        <small>{server.configPath}</small>
      </span>
      <button type="button" onClick={() => openEdit(server)} disabled={busy || server.targets.length === 0}>Edit</button>
      <button type="button" onClick={() => void run(() => data.testMcp(server))} disabled={busy}>Test</button>
      <button type="button" onClick={() => void run(() => data.removeMcp(server))} disabled={busy || server.targets.length === 0}>Remove</button>
      <label className="rw-setting-check"><input type="checkbox" checked={server.enabled} disabled={busy || server.targets.length === 0} onChange={event => void run(() => data.setMcpEnabled(server, event.target.checked))}/>Enabled</label>
    </div>)}
    {form !== undefined && <form className="rw-mcp-form" onSubmit={event => { event.preventDefault(); save(); }}>
      <h4>{form.editing ? `Edit "${form.name}"` : "Add an MCP server"}</h4>
      {problem !== undefined && <p className="rw-settings-notice" role="alert">{problem}</p>}
      <div className="rw-mcp-form-grid">
        <label>Name<input value={form.name} disabled={form.editing} onChange={event => setField("name", event.target.value)}/></label>
        {form.target === "override"
          ? <p className="rw-mcp-form-wide">An override changes only what this project says about a global server: its enabled switch and its exposure. The command, URL, and secrets stay in the global file.</p>
          : <>
        <label>Transport<select value={form.transport} onChange={event => setField("transport", event.target.value === "http" ? "http" : "stdio")}>
          <option value="stdio">stdio (a command pi runs)</option>
          <option value="http">streamable HTTP (a URL)</option>
        </select></label>
        <label>Write to<select value={`${form.target}:${form.projectScope}`} onChange={event => {
          const option = writeOptions(form.editing).find(candidate => `${candidate.target}:${candidate.projectScope}` === event.target.value);
          if (option !== undefined) setForm(current => (current === undefined ? current : { ...current, target: option.target, projectScope: option.projectScope }));
        }}>
          {writeOptions(form.editing).map(option => <option key={`${option.target}:${option.projectScope}`} value={`${option.target}:${option.projectScope}`}>{option.label}</option>)}
        </select></label>
        {form.transport === "stdio"
          ? <>
            <label>Command<input value={form.command} placeholder="npx" onChange={event => setField("command", event.target.value)}/></label>
            <label>Arguments<input value={form.args} placeholder="-y @modelcontextprotocol/server-filesystem /srv/data" onChange={event => setField("args", event.target.value)}/>
              <small>{form.editing ? "Leave this empty to keep the arguments the file has; typing replaces the whole list." : "Separated by spaces; quote an argument that contains one."}</small>
            </label>
            <label>Working directory<input value={form.cwd} placeholder="/srv/data" onChange={event => setField("cwd", event.target.value)}/></label>
            <label className="rw-mcp-form-wide">Environment variables<textarea rows={3} value={form.env} placeholder="API_TOKEN=…" onChange={event => setField("env", event.target.value)}/>
              <small>{form.editing && form.existingEnvNames.length > 0
                ? `This server sets ${form.existingEnvNames.join(", ")}. Leave the field empty to keep those values; typing replaces the whole set.`
                : "One NAME=value per line. Values go into pi's config file on this machine."}</small>
            </label>
          </>
          : <>
            <label className="rw-mcp-form-wide">URL<input value={form.url} placeholder="https://mcp.example.com/mcp" onChange={event => setField("url", event.target.value)}/></label>
            <label className="rw-mcp-form-wide">Headers<textarea rows={3} value={form.headers} placeholder="Authorization: Bearer …" onChange={event => setField("headers", event.target.value)}/>
              <small>{form.editing && form.existingHeaderNames.length > 0
                ? `This server sends ${form.existingHeaderNames.join(", ")}. Leave the field empty to keep those values; typing replaces the whole set.`
                : "One Name: value per line. Values go into pi's config file on this machine."}</small>
            </label>
          </>}
        <label>Timeout (seconds)<input value={form.timeout} inputMode="numeric" placeholder="pi's default" onChange={event => setField("timeout", event.target.value)}/></label>
        </>}
        <label>Exposure<select value={form.exposure} onChange={event => setField("exposure", event.target.value === "" ? "" : event.target.value as McpFormState["exposure"])}>
          <option value="">pi's default (codemode)</option>
          <option value="codemode">codemode</option>
          <option value="deferred">deferred</option>
          <option value="direct">direct</option>
          <option value="hidden">hidden</option>
        </select></label>
        <label className="rw-setting-check"><input type="checkbox" checked={form.enabled} onChange={event => setField("enabled", event.target.checked)}/>Enabled</label>
      </div>
      <div className="rw-mcp-form-actions">
        <button type="submit" disabled={busy}>Save</button>
        <button type="button" onClick={() => { setForm(undefined); setProblem(undefined); }} disabled={busy}>Cancel</button>
      </div>
    </form>}
  </section>;
}
