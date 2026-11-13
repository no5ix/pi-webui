import http from "node:http";
import { createConnection } from "node:net";
import { WebSocket } from "ws";
import { isHostAbsoluteAgentDir } from "../../../config.js";
import type { ActiveAgentProfileDescriptor } from "../../../shared/apiTypes.js";
import { parsePiWebRuntimeComponent } from "../../../shared/piWebStatusParsing.js";
import { sessiondHttpUrl, sessiondSocketPath } from "./config.js";
import { errorMessage } from "../../../shared/unknownValues.js";

export type SessionDaemonAgentProfileResult =
  | { status: "available"; profile: ActiveAgentProfileDescriptor }
  | { status: "unavailable"; error: string }
  | { status: "invalid"; error: string };

export interface SessionDaemonRequestOptions {
  signal?: AbortSignal;
  /**
   * Headers this process is adding, not the browser's.
   *
   * The daemon is a separate process and the browser's headers never reach it; a header listed here is
   * a fact the web process is asserting on the browser's behalf, such as the tailnet identity Tailscale
   * vouched for. That asymmetry is the point: a browser cannot put a header on a daemon request.
   */
  headers?: Record<string, string>;
}

export interface SessionDaemonRequestClient {
  request(
    method: string,
    path: string,
    body?: unknown,
    options?: SessionDaemonRequestOptions,
  ): Promise<{ statusCode: number; headers: Record<string, string>; body: string }>;
}

export class SessionDaemonClient {
  private readonly baseUrl = sessiondHttpUrl();
  private readonly socketPath = sessiondSocketPath();

  async request(
    method: string,
    path: string,
    body?: unknown,
    options: SessionDaemonRequestOptions = {},
  ): Promise<{ statusCode: number; headers: Record<string, string>; body: string }> {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    if (this.baseUrl !== undefined && this.baseUrl !== "") {
      return this.requestUrl(method, path, payload, options.signal, options.headers);
    }
    return this.requestSocket(method, path, payload, options.signal, options.headers);
  }

  getActiveAgentProfile(): Promise<SessionDaemonAgentProfileResult> {
    return getSessionDaemonActiveAgentProfile(this);
  }

  /**
   * Without a daemon URL the socket is reached through `createConnection`:
   * a `ws+unix:` URL cannot carry a socket path with a space or a Windows
   * named pipe, and `ws` discards a `socketPath` request option.
   */
  connectWebSocket(path: string): WebSocket {
    if (this.baseUrl !== undefined && this.baseUrl !== "") {
      const url = new URL(path, this.baseUrl);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      return new WebSocket(url);
    }
    const socketPath = this.socketPath;
    return new WebSocket(new URL(path, "ws://localhost"), { createConnection: () => createConnection(socketPath) });
  }

  private async requestUrl(method: string, path: string, payload?: string, signal?: AbortSignal, headers?: Record<string, string>) {
    const init: RequestInit = { method, ...(signal === undefined ? {} : { signal }) };
    const requestHeaders: Record<string, string> = { ...(headers ?? {}) };
    if (payload !== undefined && payload !== "") {
      requestHeaders["content-type"] = "application/json";
      init.body = payload;
    }
    if (Object.keys(requestHeaders).length > 0) init.headers = requestHeaders;
    const response = await fetch(new URL(path, this.baseUrl), init);
    return {
      statusCode: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: await response.text(),
    };
  }

  private requestSocket(method: string, path: string, payload?: string, signal?: AbortSignal, headers?: Record<string, string>): Promise<{ statusCode: number; headers: Record<string, string>; body: string }> {
    return new Promise((resolve, reject) => {
      const requestHeaders: Record<string, string | number> = { ...(headers ?? {}) };
      if (payload !== undefined && payload !== "") {
        requestHeaders["content-type"] = "application/json";
        requestHeaders["content-length"] = Buffer.byteLength(payload);
      }
      const request = http.request(
        {
          socketPath: this.socketPath,
          path,
          method,
          ...(signal === undefined ? {} : { signal }),
          ...(Object.keys(requestHeaders).length > 0 ? { headers: requestHeaders } : {}),
        },
        (response) => {
          response.on("error", reject);
          const chunks: Uint8Array[] = [];
          response.on("data", (chunk: Buffer | string) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });
          response.on("end", () => {
            resolve({
              statusCode: response.statusCode ?? 500,
              headers: Object.fromEntries(Object.entries(response.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(", ") : value ?? ""])),
              body: Buffer.concat(chunks).toString("utf8"),
            });
          });
        },
      );
      request.on("error", reject);
      if (payload !== undefined && payload !== "") request.write(payload);
      request.end();
    });
  }
}

export async function getSessionDaemonActiveAgentProfile(client: SessionDaemonRequestClient): Promise<SessionDaemonAgentProfileResult> {
  let response: Awaited<ReturnType<SessionDaemonRequestClient["request"]>>;
  try {
    response = await client.request("GET", "/runtime");
  } catch (error) {
    return { status: "unavailable", error: errorMessage(error) };
  }

  if (response.statusCode < 200 || response.statusCode >= 300) {
    return { status: "unavailable", error: `session daemon runtime request returned HTTP ${String(response.statusCode)}` };
  }

  let value: unknown;
  try {
    value = response.body === "" ? undefined : JSON.parse(response.body);
  } catch {
    return { status: "invalid", error: "session daemon runtime response was not valid JSON" };
  }

  const runtime = parsePiWebRuntimeComponent(value);
  if (runtime?.component !== "sessiond") {
    return { status: "invalid", error: "session daemon runtime response was invalid" };
  }
  if (runtime.activeAgentProfile === undefined) {
    return { status: "invalid", error: "session daemon runtime response did not include an active agent profile" };
  }
  if (!isHostAbsoluteAgentDir(runtime.activeAgentProfile.dir)) {
    return { status: "invalid", error: "session daemon active agent profile was not valid for this host" };
  }
  return { status: "available", profile: runtime.activeAgentProfile };
}
