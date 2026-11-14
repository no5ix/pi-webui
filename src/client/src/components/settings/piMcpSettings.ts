import type { PiMcpExposure, PiMcpListResponse, PiMcpMutationResponse, PiMcpProbeState, PiMcpRemoveRequest, PiMcpScope, PiMcpServerInfo, PiMcpSetEnabledRequest, PiMcpTestRequest, PiMcpTransport, PiMcpWriteKind, PiMcpWriteTarget } from "../../api";
import type { SettingsMachineTarget } from "./settingsMachineTarget";

/**
 * The MCP requests and the words the MCP panel shows.
 *
 * Two facts stay apart here: what a config file says (`configured`, `enabled`) and what a probe
 * answered (`probe`). A server that is switched on is not a server a running session has connected,
 * and every line the panel can state about one of them says which of the two it is talking about.
 */

/** The MCP operation the reader is waiting for, named by the row's own scope. */
export interface PiMcpOperationState {
  kind: PiMcpOperationKind;
  name: string;
  /** The entry the write is aimed at, so an in-flight override change does not grey out the definition's buttons. */
  target?: PiMcpWriteKind;
}

export type PiMcpOperationKind = "set-enabled" | "remove" | "test";

export function piMcpScopeLabel(scope: PiMcpScope): string {
  return PI_MCP_SCOPE_WORDS[scope];
}

const PI_MCP_SCOPE_WORDS: Readonly<Record<PiMcpScope, string>> = {
  global: "Global scope",
  project: "Project scope",
  extension: "Registered by an extension",
};

export function piMcpTransportLabel(transport: PiMcpTransport): string {
  return transport === "http" ? "HTTP" : "stdio command";
}

export function piMcpExposureLabel(exposure: PiMcpExposure): string {
  return PI_MCP_EXPOSURE_WORDS[exposure];
}

const PI_MCP_EXPOSURE_WORDS: Readonly<Record<PiMcpExposure, string>> = {
  codemode: "Exposed as code-mode tools",
  deferred: "Deferred until asked for",
  direct: "Exposed directly",
  hidden: "Hidden from the model",
};

/** The probe's state in the reader's words. `unprobed` is stated, never left as a blank. */
export function piMcpProbeLabel(state: PiMcpProbeState): string {
  return PI_MCP_PROBE_WORDS[state];
}

const PI_MCP_PROBE_WORDS: Readonly<Record<PiMcpProbeState, string>> = {
  unprobed: "Unprobed",
  reachable: "Reachable",
  unreachable: "Unreachable",
  "needs-auth": "Needs sign-in",
};

export function piMcpProbeTone(state: PiMcpProbeState): "success" | "warning" | "error" | "neutral" {
  return PI_MCP_PROBE_TONES[state];
}

const PI_MCP_PROBE_TONES: Readonly<Record<PiMcpProbeState, "success" | "warning" | "error" | "neutral">> = {
  unprobed: "neutral",
  reachable: "success",
  unreachable: "error",
  "needs-auth": "warning",
};

/** What the last probe answered, in one line: the state, then the probe's own redacted reason. */
export function piMcpProbeLine(server: Pick<PiMcpServerInfo, "probe">): string {
  const probe = server.probe;
  const label = piMcpProbeLabel(probe?.state ?? "unprobed");
  if (probe === undefined || probe.state === "unprobed") return `${label} - no probe has been run for this server.`;
  const detail = probe.message ?? (probe.serverName === undefined ? "" : `${probe.serverName}${probe.serverVersion === undefined ? "" : ` ${probe.serverVersion}`}`);
  return detail === "" ? label : `${label} - ${detail}`;
}

/** What the config file says, kept apart from what a probe answered. */
export function piMcpConfiguredLabel(server: Pick<PiMcpServerInfo, "configured">): string {
  return PI_MCP_CONFIGURED_WORDS[server.configured];
}

const PI_MCP_CONFIGURED_WORDS: Readonly<Record<PiMcpServerInfo["configured"], string>> = {
  enabled: "Config says enabled",
  disabled: "Config says disabled",
  invalid: "Config is invalid",
};

/** Where the server is defined, so a reader can open the file PI WEB did not copy out. */
export function piMcpConfigPathLine(server: Pick<PiMcpServerInfo, "configPath" | "overridePath">): string {
  const override = server.overridePath;
  return override === undefined ? server.configPath : `${server.configPath} (overridden by ${override})`;
}

/** The command or URL, as the config writes it. A header, env, or oauth value is never part of it. */
export function piMcpTargetLine(server: PiMcpServerInfo): string {
  if (server.transport === "http") return `url: ${server.url ?? "not reported"}`;
  return `command: ${server.command ?? ""}`.trim() || "not reported";
}

/** The names of the secrets a server sends. Names only: PI WEB never reads a value. */
export function piMcpSecretNameLines(server: PiMcpServerInfo): string[] {
  const lines: string[] = [];
  const envNames = server.envNames ?? [];
  const headerNames = server.headerNames ?? [];
  if (envNames.length > 0) lines.push(`Env names: ${envNames.join(", ")}`);
  if (headerNames.length > 0) lines.push(`Header names: ${headerNames.join(", ")}`);
  return lines;
}

export const PI_MCP_SECRETS_NEVER_SHOWN_NOTE = "Environment and header values are never shown here: PI WEB reads only their names, and a probe's message is redacted.";

/** Why a server cannot be switched or removed from Settings, when a rule says it cannot. */
export function piMcpWriteBlockedReason(server: Pick<PiMcpServerInfo, "scope">): string | undefined {
  if (server.scope !== "extension") return undefined;
  return "A server an extension registered is not editable here: pi's /mcp manager and the extension own it.";
}

/**
 * The reload sentence a config write needs.
 *
 * Writing the file does not open a connection: pi's own extension connects a server when a session
 * starts, so an enabled server that has never been in a session is not reachable until a reload.
 */
/**
 * What an empty server list means.
 *
 * A list that comes back with file failures attached is not a list of nothing: the files that
 * failed are the reason no server is known, and the sentence has to say so. The notices naming the
 * failures sit above; this line must not contradict them with a flat "none configured".
 */
export function piMcpEmptyListNote(response: PiMcpListResponse, targetLabel: string): string {
  const projectScope = response.projectScopeRead ? " and the project scope was read" : " and the project scope was not read";
  if (response.errors.length > 0) {
    const files = response.errors.length === 1 ? "config file was not read" : "config files were not read";
    return `No MCP server is listed on ${targetLabel}${projectScope}, and a ${files}: this list is not known.`;
  }
  return `No MCP server is configured on ${targetLabel}${projectScope}.`;
}

export function piMcpReloadNote(target: SettingsMachineTarget): string {
  const sessionScope = target.kind === "local" ? "each idle PI WEB session" : `each idle PI WEB session on ${target.name}`;
  return `Turning a server on writes ${target.kind === "local" ? "this machine's" : `${target.name}'s`} pi config. A running session keeps the connections it opened: type /reload in ${sessionScope} to start a server that is switched on.`;
}

/**
 * The project scope in words.
 *
 * `projectScopeRead` is the answer to "did the server open the project file at all". When it did
 * not, the panel says the project scope was not read; a list that never looked there is not evidence
 * that the project has no servers.
 */
export function piMcpProjectScopeNote(response: PiMcpListResponse): string {
  if (response.projectScopeRead) return `Project scope read from ${response.projectConfigPath ?? response.projectPath ?? "the selected project"}.`;
  const projectPath = response.projectPath;
  if (projectPath !== undefined && !response.projectTrusted) {
    return `Project scope not read: ${projectPath} is not trusted, so pi does not load its MCP servers.`;
  }
  return "Project scope not read: PI WEB Settings has no project selected, so only this machine's global MCP servers are listed.";
}

/**
 * The entry a row's switch writes.
 *
 * A row is not one thing to write. A global server that the selected project overrides has a
 * definition file and an override file, and "turn this server off" means the override while a project
 * is being managed - the global answer belongs to the machine, and the panel says which file a press
 * opens. With no project selected, the switch writes the definition, because that is the only answer
 * in view.
 */
export function piMcpSwitchTarget(server: Pick<PiMcpServerInfo, "targets">, projectSelected: boolean): PiMcpWriteTarget | undefined {
  const override = server.targets.find((target) => target.kind === "override");
  if (projectSelected && override !== undefined) return override;
  return server.targets.find((target) => target.kind === "definition");
}

/** The entry a row can be written to, by the kind of entry the reader chose. */
export function piMcpWriteTarget(server: Pick<PiMcpServerInfo, "targets">, kind: PiMcpWriteKind): PiMcpWriteTarget | undefined {
  return server.targets.find((target) => target.kind === kind);
}

export function piMcpSetEnabledRequest(server: Pick<PiMcpServerInfo, "name">, target: PiMcpWriteTarget, enabled: boolean, projectId?: string): PiMcpSetEnabledRequest {
  return { name: server.name, target: target.kind, scope: target.scope, enabled, ...projectIdPart(projectId) };
}

export function piMcpRemoveRequest(server: Pick<PiMcpServerInfo, "name">, target: PiMcpWriteTarget, projectId?: string): PiMcpRemoveRequest {
  return { name: server.name, target: target.kind, scope: target.scope, ...projectIdPart(projectId) };
}

export function piMcpTestRequest(server: Pick<PiMcpServerInfo, "name">, projectId?: string): PiMcpTestRequest {
  return { name: server.name, ...projectIdPart(projectId) };
}

/** Where the server's own definition lives. */
export function piMcpDefinitionLine(server: PiMcpServerInfo): string {
  const target = piMcpWriteTarget(server, "definition");
  const scopeLabel = server.scope === "project" ? "Project definition" : server.scope === "extension" ? "Extension registration" : "Global definition";
  return `${scopeLabel}: ${target?.configPath ?? server.configPath}`;
}

/**
 * The project's override, in words.
 *
 * A row that carries an override says so with the file, because that is the entry the project's switch
 * writes. A row without one, in a project context, says the project follows the global answer: an
 * absence in the project file is a fact about the project, not a missing value.
 */
export function piMcpOverrideLine(server: PiMcpServerInfo, projectSelected: boolean): string | undefined {
  const overridePath = server.overridePath;
  if (overridePath !== undefined) return `Overridden for this project: ${overridePath}`;
  if (!projectSelected || server.scope !== "global") return undefined;
  const override = piMcpWriteTarget(server, "override");
  return override === undefined ? undefined : `No project override: this project follows the global answer, and a change here writes ${override.configPath}.`;
}

/** Which file the switch on this row opens, said before the press rather than after it. */
export function piMcpSwitchTargetLine(target: PiMcpWriteTarget | undefined): string | undefined {
  if (target === undefined) return undefined;
  return target.kind === "override"
    ? `This switch writes the project's override in ${target.configPath}.`
    : `This switch writes the ${target.scope === "project" ? "project" : "global"} definition in ${target.configPath}.`;
}

/** The switch's target in the few words an accessible name carries. */
export function piMcpSwitchTargetNote(server: Pick<PiMcpServerInfo, "targets">, projectSelected: boolean): string {
  const target = piMcpSwitchTarget(server, projectSelected);
  if (target === undefined) return "no entry PI WEB may write";
  return target.kind === "override" ? "writes this project's override" : `writes the ${target.scope} definition`;
}

/**
 * The project chooser's own line.
 *
 * A list that has not arrived is not a machine with no projects, and a machine with no projects is not
 * a list that failed: the chooser says which of the two it is, because the choice decides which file
 * every switch on the page writes.
 */
export function piMcpProjectChooserNote(projectsLoading: boolean, projectCount: number, selection: string | undefined, projectsError = ""): string {
  if (projectsError !== "") return projectsError;
  if (projectsLoading) return "Loading this machine's projects…";
  if (projectCount === 0) return "This machine has no projects, so only its global servers are managed here.";
  return selection === undefined
    ? "No project selected: the switches write the machine's global config, and a project's own file is not read."
    : "A project selected: the switches write that project's override, and its own servers are listed beside the global ones.";
}

export function piMcpRemovalLabel(kind: PiMcpWriteKind): string {
  return kind === "override" ? "Remove project override" : "Remove definition";
}

export function piMcpRemovalQuestion(name: string, target: PiMcpWriteTarget): string {
  const what = target.kind === "override" ? "project override" : "definition";
  return `Remove the ${what} of ${name} from ${target.configPath}?`;
}

function projectIdPart(projectId: string | undefined): { projectId?: string } {
  return projectId === undefined || projectId === "" ? {} : { projectId };
}

export function isPiMcpOperationPending(operation: PiMcpOperationState | undefined, kind: PiMcpOperationKind, server: Pick<PiMcpServerInfo, "name">, target?: PiMcpWriteKind): boolean {
  return operation?.kind === kind && operation.name === server.name && operation.target === target;
}

/**
 * What a mutation answered.
 *
 * The response carries the whole list again, so the panel's rows are the machine's answer, and the
 * message says what the machine did - a removal that removed nothing is reported as that.
 */
export function piMcpMutationMessage(response: PiMcpMutationResponse, target: SettingsMachineTarget): string {
  const targetSuffix = target.kind === "local" ? "" : ` on ${target.name}`;
  const sessionScope = target.kind === "local" ? "each idle PI WEB session" : `each idle PI WEB session on ${target.name}`;
  if (response.action === "remove") {
    return response.removed === true
      ? `MCP server ${response.name} was removed${targetSuffix}. Type /reload in ${sessionScope} to drop its tools.`
      : `MCP server ${response.name} was not removed: it is no longer in the config PI WEB just read${targetSuffix}.`;
  }
  if (response.action === "test") {
    return `Probe of ${response.name}: ${piMcpProbeLabel(response.probe?.state ?? "unprobed")}.`;
  }
  return `MCP server ${response.name} ${response.enabled === false ? "turned off" : "turned on"}${targetSuffix}. Type /reload in ${sessionScope} to connect it.`;
}
