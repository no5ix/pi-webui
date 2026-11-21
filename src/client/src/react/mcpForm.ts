import type { PiMcpExposure, PiMcpSaveRequest, PiMcpServerDraft, PiMcpServerInfo, PiMcpWriteKind, PiMcpWriteTarget } from "../api";

/**
 * The MCP add/edit form's state, as one plain record.
 *
 * The panel is a form over pi's `mcp.json`, and the shape it can honestly show is the shape the server
 * answers: names of environment variables and headers, never their values. So the form carries two
 * kinds of field. A typed field (a command, a URL, a timeout) is sent as the value the person typed. A
 * secret field is sent as lines only when the person wrote lines: an empty field sends nothing, and a
 * save over an existing server keeps the values that file already has. Typing replaces the whole set,
 * because pi reads `env` and `headers` as plain objects and a partial merge of a map has no meaning.
 *
 * Keeping this outside the component is what makes the rules testable: what is a draft, what is a
 * problem to report before a request, and what an existing row turns into when Edit is pressed.
 */
export interface McpFormState {
  name: string;
  transport: "stdio" | "http";
  /** pi shows this beside the server in its own listings; it is free text, never a secret. */
  description: string;
  command: string;
  /** Space or newline separated, as a shell would read it. */
  args: string;
  cwd: string;
  url: string;
  /** `NAME=value`, one per line. Empty sends nothing. */
  env: string;
  /** `Name: value`, one per line. Empty sends nothing. */
  headers: string;
  enabled: boolean;
  /** Seconds; empty leaves pi's own default in place. */
  timeout: string;
  exposure: "" | PiMcpExposure;
  /** The entry the save writes: a definition, or this project's override of a global server. */
  target: PiMcpWriteKind;
  /**
   * Whether a definition is aimed at the project's own `mcp.json`. A definition without it is the
   * machine's global one, and the machine resolves a project's file only for a request that names the
   * project, so the form has to say which file it means.
   */
  projectScope: boolean;
  /** True when the server already exists, so the panel can say what an empty secret field keeps. */
  editing: boolean;
  /** The names the file has, shown beside a secret field whose values PI WEB does not read. */
  existingEnvNames: readonly string[];
  existingHeaderNames: readonly string[];
}

export function emptyMcpForm(): McpFormState {
  return {
    name: "",
    transport: "stdio",
    description: "",
    command: "",
    args: "",
    cwd: "",
    url: "",
    env: "",
    headers: "",
    enabled: true,
    timeout: "",
    exposure: "",
    target: "definition",
    projectScope: false,
    editing: false,
    existingEnvNames: [],
    existingHeaderNames: [],
  };
}

/**
 * The form an Edit press opens, aimed at one of the entries the row offers.
 *
 * Only the values a row carries are prefilled. A row carries a command, a URL, a timeout, an exposure
 * and the *names* of its secrets, so those are what the form starts with; a value PI WEB hides starts
 * empty and stays unsent, which is the whole point of the merge rule. A row carries no arguments and no
 * secret values, so an edit that leaves those fields empty sends nothing and the file keeps them.
 *
 * The target carries the scope, and the scope is the part that decides which file the save opens: a
 * project's own definition and a project's override both need the request to name the project, and a
 * global definition must not. Deriving it from the entry the press chose is what keeps a press on a
 * project-defined row from being answered as a write to the machine's global file.
 */
export function mcpFormFromServer(server: PiMcpServerInfo, target: PiMcpWriteTarget): McpFormState {
  return {
    name: server.name,
    transport: server.transport,
    description: server.description ?? "",
    command: server.command ?? "",
    args: "",
    cwd: server.cwd ?? "",
    url: server.url ?? "",
    env: "",
    headers: "",
    enabled: server.enabled,
    timeout: server.timeout === undefined ? "" : String(server.timeout),
    exposure: server.exposure ?? "",
    target: target.kind,
    projectScope: target.scope === "project",
    editing: true,
    existingEnvNames: server.envNames ?? [],
    existingHeaderNames: server.headerNames ?? [],
  };
}

/** Splits `NAME=value` lines. A line without `=` is dropped, not guessed at. */
export function parseEnvLines(text: string): Record<string, string> {
  return splitLines(text, "=");
}

/** Splits `Name: value` header lines, the way a header block is written. */
export function parseHeaderLines(text: string): Record<string, string> {
  return splitLines(text, ":");
}

/** The secret lines a saved map would look like in the form; used to show what a row already sets. */
export function secretNamesLine(names: readonly string[]): string {
  return names.length === 0 ? "" : names.join(", ");
}

function splitLines(text: string, separator: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const at = line.indexOf(separator);
    if (at <= 0) continue;
    const key = line.slice(0, at).trim();
    const value = line.slice(at + separator.length).trim();
    if (key === "") continue;
    values[key] = value;
  }
  return values;
}

/** Splits a command line into arguments, honouring simple quotes, the way a shell would. */
export function parseArgumentLine(text: string): string[] {
  const args: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\\.|[^\s]+)/gu;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const value = match[1] ?? match[2] ?? match[3] ?? "";
    const unescaped = value.replace(/\\(.)/gu, "$1");
    if (unescaped !== "") args.push(unescaped);
  }
  return args;
}

/**
 * The draft a form sends.
 *
 * A field the person left alone is not sent, so the machine keeps what the file had. A secret field is
 * sent only when lines were written, and then it is the whole set.
 *
 * An override is a different shape. pi reads a project's `mcp.json` entry as the keys that override a
 * global server - `enabled`, `exposure`, `toolExposure` - and a file that puts a command in one is
 * reported as broken, so an override draft carries only the keys an override may set.
 */
export function mcpDraftFromForm(form: McpFormState): PiMcpServerDraft {
  if (form.target === "override") {
    const override: PiMcpServerDraft = { enabled: form.enabled };
    if (form.exposure !== "") override.exposure = form.exposure;
    return override;
  }
  const draft: PiMcpServerDraft = { enabled: form.enabled };
  const description = form.description.trim();
  if (description !== "") draft.description = description;
  if (form.transport === "stdio") {
    draft.type = "stdio";
    draft.command = form.command.trim();
    const args = parseArgumentLine(form.args);
    if (args.length > 0) draft.args = args;
    if (form.cwd.trim() !== "") draft.cwd = form.cwd.trim();
    const env = parseEnvLines(form.env);
    if (Object.keys(env).length > 0) draft.env = env;
  } else {
    draft.type = "http";
    draft.url = form.url.trim();
    const headers = parseHeaderLines(form.headers);
    if (Object.keys(headers).length > 0) draft.headers = headers;
  }
  const timeout = form.timeout.trim();
  if (timeout !== "") draft.timeout = Number(timeout);
  if (form.exposure !== "") draft.exposure = form.exposure;
  return draft;
}

/**
 * What the form must refuse to send, in the person's words.
 *
 * The machine validates with pi's own rules and answers in pi's words; these are the checks a form can
 * make before a request, so a missing command is reported while the field is still in focus.
 */
export function mcpFormProblem(form: McpFormState): string | undefined {
  if (form.name.trim() === "") return "A server needs a name.";
  if (!/^[A-Za-z0-9_-]+$/.test(form.name.trim())) return "A server name may use only letters, digits, \"_\" and \"-\".";
  if (form.target === "override") return undefined;
  if (form.transport === "stdio" && form.command.trim() === "") return "A stdio server needs a command.";
  if (form.transport === "http" && form.url.trim() === "") return "An HTTP server needs a URL.";
  if (form.transport === "http" && form.url.trim() !== "" && !/^https?:\/\//iu.test(form.url.trim())) return "An HTTP server URL must start with http:// or https://.";
  const timeout = form.timeout.trim();
  if (timeout !== "" && !(Number(timeout) > 0)) return "A timeout must be a positive number of seconds.";
  return undefined;
}

/** The request a form turns into, with the project the panel is answering for. */
export function mcpSaveRequestFromForm(form: McpFormState, projectId: string | undefined): PiMcpSaveRequest {
  const namesProject = projectId !== undefined && (form.target === "override" || form.projectScope);
  return {
    name: form.name.trim(),
    config: mcpDraftFromForm(form),
    target: form.target,
    ...(namesProject ? { projectId } : {}),
  };
}
