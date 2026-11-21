import { MUTATION_DEADLINE_MS } from "./settingsMutation";
import type { PiMcpListResponse, PiMcpServerInfo } from "../../api";

/**
 * The rules behind the MCP Servers page, away from the page.
 *
 * A server's scope is the `mcp.json` that defines it. A definition in the machine's global file runs on
 * every project on that machine; a definition in a project's file belongs to that project; and a project
 * entry that names no command and no url is not a server of its own — it is that project's say about a
 * global server, and only its enabled switch and exposure are its own. The page lists rows by the file
 * they came from because a write to one file never touches the other, and it names the file on every row
 * so a person sees which one a press opens.
 *
 * Secrets never cross this boundary. pi keeps header values, environment values, and command references
 * in its own files, and the list answer carries only their *names* — so every line here is built from
 * names, and a value PI WEB cannot see is described as hidden rather than sent back empty. A save that
 * did not see a secret must not delete it, which is why the form says what it is keeping.
 */
export type PiMcpSection = "project" | "global";

/** The two section headings, named in one place so the reader always sees which scope is which. */
export function piMcpProjectSectionTitle(projectName: string, state: PiMcpProjectSectionState): string {
  if (state === "no-project" || state === "unread") return "Project MCP servers";
  return projectName.trim().length === 0 ? "Project MCP servers" : `Project MCP servers — ${projectName}`;
}

export function piMcpGlobalSectionTitle(): string {
  return "Global MCP servers";
}

/** The name of the project the page's scope names, from the list the shell was given. */
export function piMcpScopeProjectName(
  projects: readonly { id: string; name: string }[] | undefined,
  selectedProject: { id: string; name: string } | undefined,
  projectId: string | undefined,
): string {
  if (projectId === undefined) return "";
  const match = projects?.find((project) => project.id === projectId) ?? (selectedProject?.id === projectId ? selectedProject : undefined);
  return match?.name ?? "";
}

/** What the project section can answer with, named once so the page renders one branch per state. */
export type PiMcpProjectSectionState = "no-project" | "unread" | "not-read" | "empty" | "rows";

export function piMcpProjectSectionState(input: {
  readonly projectId: string | undefined;
  readonly response: PiMcpListResponse | undefined;
  readonly rowCount: number;
}): PiMcpProjectSectionState {
  if (input.projectId === undefined) return "no-project";
  if (input.response === undefined) return "unread";
  if (!input.response.projectScopeRead) return "not-read";
  return input.rowCount === 0 ? "empty" : "rows";
}

export function piMcpProjectRows(servers: readonly PiMcpServerInfo[]): PiMcpServerInfo[] {
  return servers.filter(server => server.scope === "project");
}

export function piMcpGlobalRows(servers: readonly PiMcpServerInfo[]): PiMcpServerInfo[] {
  return servers.filter(server => server.scope !== "project");
}

export function piMcpRowTestId(server: PiMcpServerInfo): string {
  return `mcp-row-${server.scope}-${server.name}`;
}

/** The row's state as pi wrote it: a disabled server and a broken definition are different answers. */
export function piMcpStatusLabel(server: PiMcpServerInfo): string {
  if (server.configured === "invalid") return "invalid definition";
  return server.enabled ? "enabled" : "disabled";
}

export function piMcpStatusTone(server: PiMcpServerInfo): "on" | "off" | "warning" {
  if (server.configured === "invalid") return "warning";
  return server.enabled ? "on" : "off";
}

/** The names of every secret the row references, in the order pi's file lists them. */
export function piMcpSecretNames(server: PiMcpServerInfo): string[] {
  return [...(server.headerNames ?? []), ...(server.envNames ?? [])];
}

export function piMcpMetaLines(server: PiMcpServerInfo): string[] {
  const transport = server.transport === "stdio"
    ? `command: ${server.command ?? "hidden"}`
    : `url: ${server.url ?? "hidden"}`;
  return [
    server.description,
    transport,
    server.cwd === undefined ? undefined : `cwd: ${server.cwd}`,
    server.exposure === undefined ? undefined : `exposure: ${server.exposure}`,
    server.timeout === undefined ? undefined : `timeout: ${String(server.timeout)}s`,
    server.authProvider === undefined ? undefined : `uses the ${server.authProvider} provider credential`,
    server.oauthConfigured === true ? "OAuth configured" : undefined,
    piMcpSecretsLine(server),
    `file: ${server.configPath}`,
    piMcpOverrideLine(server),
  ].filter((line): line is string => line !== undefined);
}

export function piMcpSecretsLine(server: PiMcpServerInfo): string | undefined {
  const names = piMcpSecretNames(server);
  if (names.length === 0) return server.usesSecrets === true ? "secrets: values hidden" : undefined;
  return `secrets: ${names.join(", ")} — values hidden`;
}

/** What a project's file says about a global server, and where that override is saved. */
export function piMcpOverrideLine(server: PiMcpServerInfo): string | undefined {
  if (server.overrideOnly === true) {
    return `overrides a global server${server.overridePath === undefined ? "" : ` (${server.overridePath})`}`;
  }
  return server.overridePath === undefined ? undefined : `this project overrides it (${server.overridePath})`;
}

/** pi's own answer about a connection attempt, redacted by pi. Never a secret. */
export function piMcpDiagnostics(server: PiMcpServerInfo): string[] {
  const lines: string[] = [];
  if (server.configured === "invalid") lines.push("pi read this entry and refused it: it needs either a command or a url.");
  const probe = server.probe;
  if (probe === undefined) return lines;
  const label = piMcpProbeLabel(probe.state);
  const detail = [
    label,
    probe.message,
    probe.serverName === undefined ? undefined : `${probe.serverName} ${probe.serverVersion ?? ""}`.trim(),
    probe.probedAt === undefined ? undefined : `probed ${probe.probedAt}`,
  ].filter((entry): entry is string => entry !== undefined && entry !== "");
  lines.push(detail.join(" · "));
  if (probe.state === "needs-auth") lines.push("The server asks for a credential PI WEB does not have: connect it in pi's own config.");
  return lines;
}

export function piMcpProbeLabel(state: NonNullable<PiMcpServerInfo["probe"]>["state"]): string {
  if (state === "unprobed") return "not tested";
  if (state === "reachable") return "reachable";
  if (state === "unreachable") return "not reachable";
  return "needs authentication";
}

/** Where the page's answers came from, so the scope a press writes to is visible before it is pressed. */
export function piMcpConfigLocationLines(response: PiMcpListResponse, machineLabel: string, projectName?: string): string[] {
  return [
    `Machine: ${machineLabel}`,
    `Global config: ${response.globalConfigPath}`,
    ...(response.projectScopeRead
      ? [`Project config: ${response.projectConfigPath ?? "this project has no mcp.json yet"}`]
      : ["Project config: not read"]),
    ...(projectName === undefined ? [] : [`Project: ${projectName}`]),
  ];
}

export function piMcpTrustNote(response: PiMcpListResponse, projectName?: string): string | undefined {
  if (projectName === undefined || !response.projectScopeRead) return undefined;
  return response.projectTrusted
    ? `${projectName} is trusted, so pi loads its MCP servers.`
    : `${projectName} is not trusted: pi reads its MCP config and keeps its servers off.`;
}

export function piMcpSecurityLines(): string[] {
  return [
    "Secrets stay in pi's config files. PI WEB shows the names of a server's headers and environment variables and never their values, and a save that did not see a value keeps it.",
    "A server connects when a session starts. Testing a connection here starts a probe and changes nothing in the config.",
    "A project's file may define its own servers and override a global server's enabled switch and exposure; it cannot ask for a machine credential, and it never changes the global file.",
  ];
}

export function piMcpScopeWriteNote(projectId: string | undefined, machineLabel: string): string {
  return projectId === undefined
    ? `No project selected: every row here is ${machineLabel}'s global config, and a write goes to that file.`
    : `A new server goes to this project's file; the global section is the machine's file. A row names the file it came from.`;
}

export function piMcpScopeNote(section: PiMcpSection, count: number, projectName: string, machineLabel: string): string {
  if (section === "project") {
    return count === 0
      ? `No project servers: ${projectName} defines none in its own mcp.json.`
      : `${String(count)} server${count === 1 ? "" : "s"} defined by ${projectName}. A write here opens the project's file.`;
  }
  return count === 0
    ? `No global servers: ${machineLabel}'s global mcp.json defines none.`
    : `${String(count)} server${count === 1 ? "" : "s"} from ${machineLabel}'s global mcp.json, available to every project on it.`;
}

/** The sentence a project section with no rows answers with, by the reason it has no rows. */
export function piMcpProjectSectionNote(state: PiMcpProjectSectionState, projectName: string, machineLabel: string): string {
  if (state === "no-project") return "No project selected: this page answers for the machine's global config only. Choose a project to read its mcp.json.";
  if (state === "not-read") return `The machine did not read ${projectName}'s mcp.json for this answer, so its absence here is not an empty file.`;
  if (state === "unread") return `Choose the project to read, and ${machineLabel} will answer for its mcp.json.`;
  const name = projectName.trim().length === 0 ? "The selected project" : projectName;
  if (state === "empty") return `${name} defines no MCP servers in its own mcp.json.`;
  return `${name}'s servers, from its own mcp.json.`;
}

export function piMcpEmptyNote(section: PiMcpSection, projectName?: string): string {
  if (section === "project") return `No MCP servers in this project's file${projectName === undefined ? "" : ` (${projectName})`}.`;
  return "No MCP servers in the machine's global file.";
}

/** The note shown while the machine has not answered for the MCP page yet: an empty section here is an unloaded one. */
export function piMcpNotLoadedNote(): string {
  return "The config files have not been read yet. Reload asks the machine to read them again.";
}

export function piMcpBusyLabel(action: "save" | "test" | "remove" | "enable" | "reload", server?: PiMcpServerInfo): string {
  const who = server === undefined ? "the servers" : `“${server.name}”`;
  if (action === "save") return `Saving ${who}`;
  if (action === "test") return `Testing ${who}`;
  if (action === "remove") return `Removing ${who}`;
  if (action === "enable") return `Updating ${who}`;
  return "Loading the servers pi configured";
}

export function piMcpMutationMessage(action: "save" | "test" | "remove" | "enable", server: PiMcpServerInfo, enabled?: boolean): string {
  const who = `“${server.name}”`;
  if (action === "test") return `Tested ${who}: ${server.probe === undefined ? "no answer" : piMcpProbeLabel(server.probe.state)}.`;
  if (action === "remove") return `${who} is gone from ${server.configPath}. A running session keeps its tools until it reloads.`;
  if (action === "enable") return `${who} is ${enabled === true ? "enabled" : "disabled"}. A running session keeps the servers it loaded until it reloads.`;
  return `${who} is saved in ${server.configPath}. A running session picks it up when it reloads.`;
}

/**
 * A page mutation that answers within a bound, or says it gave up.
 *
 * The MCP page asks the machine to do things that reach outside it: a connection test starts the
 * server's own process and waits for a handshake, and a write goes through the machine's file layer.
 * A command that never answers used to leave the page's busy line set forever, and the page locks its
 * controls while a mutation runs - so one hung server took the whole page's controls with it, with no
 * stated deadline and no way to retry.
 *
 * The bound is one number, in one place. A mutation that answers settles the state; a mutation that
 * passes the deadline answers with the truth this page can claim: the machine did not reply, what the
 * action could and could not have changed, and how to try again. The controls are unlocked on the
 * give-up, because a page that cannot be pressed again is a page that cannot recover.
 */


export type McpMutationAction = "save" | "test" | "remove" | "enable";

export interface McpMutationRunning {
  readonly kind: "running";
  readonly action: McpMutationAction;
  readonly label: string;
  readonly deadlineAt: number;
}

export interface McpMutationGaveUp {
  readonly kind: "gaveUp";
  readonly action: McpMutationAction;
  readonly label: string;
  readonly waitedMs: number;
}

export type McpMutationState = { readonly kind: "idle" } | McpMutationRunning | McpMutationGaveUp;

export function startMcpMutation(action: McpMutationAction, label: string, now: number = Date.now()): McpMutationRunning {
  return { kind: "running", action, label, deadlineAt: now + MUTATION_DEADLINE_MS };
}

export function idleMcpMutation(): McpMutationState {
  return { kind: "idle" };
}

/** Whether the running mutation has passed the page's bound and should be reported as given up. */
export function mcpMutationDeadlinePassed(state: McpMutationState, now: number = Date.now()): state is McpMutationRunning {
  return state.kind === "running" && now >= state.deadlineAt;
}

/** The controls are locked only while a mutation is inside its bound. */
export function mcpMutationLocks(state: McpMutationState): boolean {
  return state.kind === "running";
}

/** What the page says when a mutation passed the bound, in the action's own terms. */
export function mcpMutationGaveUpNotice(state: McpMutationGaveUp): string {
  const seconds = Math.max(1, Math.round(state.waitedMs / 1000));
  const who = state.label;
  if (state.action === "test") {
    return `${who} did not answer within ${String(seconds)} seconds, so the page stopped waiting. `
      + "A connection test changes nothing, so the server stays as it was. Press Test connection again to try once more.";
  }
  const written = state.action === "save" ? "saved" : state.action === "remove" ? "removed" : "changed";
  return `${who} did not answer within ${String(seconds)} seconds, so the page stopped waiting. `
    + `The machine may have ${written} the entry anyway - Reload reads the config files again, and the control works now.`;
}
