import { describe, expect, it, vi } from "vitest";
import {
  probeMcpServer,
  spawnNodeProbeChild,
  type McpProbeChild,
  type McpProbeFetch,
  type McpProbeSpawn,
} from "./mcpProbe";

/**
 * "Test Connection", tested without a server.
 *
 * A probe must leave nothing behind - no process, no long-lived connection - must call a server that
 * asks for a sign-in what it is, and must never repeat what a server said when that text carries a
 * value the configuration named. The probe's only process dependency is the six-verb `McpProbeChild`
 * port, so the fakes here are plain objects and every promise is checked against what the probe
 * itself wrote, answered, and killed.
 */

/** A stdio MCP server, answered by the port's verbs. Stdout is replayed to a listener that arrives late. */
class FakeChild implements McpProbeChild {
  readonly lines: string[] = [];
  readonly kills: string[] = [];

  private readonly stdoutChunks: string[] = [];
  private stdoutListener: ((chunk: string) => void) | undefined;
  private closeListener: ((code: number | null) => void) | undefined;
  private errorListener: ((reason: string) => void) | undefined;
  private running = true;

  constructor(
    private readonly options: { writeFails?: boolean; ignoresSigterm?: boolean } = {},
  ) {}

  onStdout: (listener: (chunk: string) => void) => void = (listener) => {
    this.stdoutListener = listener;
    for (const chunk of this.stdoutChunks) listener(chunk);
  };

  onClose: (listener: (code: number | null) => void) => void = (listener) => {
    this.closeListener = listener;
  };

  onError: (listener: (reason: string) => void) => void = (listener) => {
    this.errorListener = listener;
  };

  writeLine: (line: string, onWritten: (error: string | undefined) => void) => void = (line, onWritten) => {
    if (this.options.writeFails === true) {
      onWritten("EPIPE: broken pipe");
      return;
    }
    this.lines.push(line);
    onWritten(undefined);
  };

  isRunning: () => boolean = () => this.running;

  kill: (signal: "SIGTERM" | "SIGKILL") => void = (signal) => {
    this.kills.push(signal);
    if (signal === "SIGTERM" && this.options.ignoresSigterm === true) return;
    this.running = false;
    const close = this.closeListener;
    if (close !== undefined) setTimeout(() => { close(null); }, 0);
  };

  /** What the server prints on stdout, in order. */
  emitStdout(chunk: string): void {
    this.stdoutChunks.push(chunk);
    this.stdoutListener?.(chunk);
  }

  /** The process ended on its own. */
  closes(code: number | null): void {
    this.running = false;
    this.closeListener?.(code);
  }

  /** The process could not be started, or died while answering. */
  fails(reason: string): void {
    this.running = false;
    this.errorListener?.(reason);
  }
}

const stdioConfig = { command: "mcp-files", args: ["--root", "/srv"] };
const accepted = { result: { protocolVersion: "2025-06-18", serverInfo: { name: "files-server", version: "1.4.0" } } };

function handshakeLine(payload: unknown): string {
  return `${JSON.stringify(payload)}\n`;
}

function starts(child: McpProbeChild) {
  return vi.fn(() => child);
}

describe("probing an stdio server", () => {
  it("spawns the server, completes the handshake, and kills the process it started", async () => {
    const child = new FakeChild();
    child.emitStdout(handshakeLine(accepted));

    const probe = await probeMcpServer({ name: "files", config: stdioConfig, cwd: "/srv", timeoutMs: 2_000 }, { spawnChild: starts(child), env: {} });

    expect(probe).toMatchObject({ state: "reachable", serverName: "files-server", serverVersion: "1.4.0" });
    expect(probe.probedAt).toBeTypeOf("string");
    expect(child.kills).toEqual(["SIGTERM"]);
  });

  it("writes pi's initialize request, and nothing the configuration named", async () => {
    const child = new FakeChild();
    child.emitStdout(handshakeLine(accepted));

    await probeMcpServer(
      { name: "files", config: { ...stdioConfig, env: { TOKEN: "a-secret-value" } }, cwd: "/srv", timeoutMs: 2_000 },
      { spawnChild: starts(child), env: {} },
    );

    const written = child.lines.join("");
    expect(written).toContain('"method":"initialize"');
    expect(written).toContain('"name":"pi-web-mcp-probe"');
    expect(written).toContain("2025-06-18");
    expect(written).not.toContain("a-secret-value");
  });

  it("says so when the server never answers, and still kills it", async () => {
    const child = new FakeChild();

    const probe = await probeMcpServer({ name: "files", config: stdioConfig, cwd: "/srv", timeoutMs: 300 }, { spawnChild: starts(child), env: {} });

    expect(probe.state).toBe("unreachable");
    expect(probe.message).toContain("handshake");
    expect(child.kills).toEqual(["SIGTERM"]);
  });

  it("reports a server that exits during the handshake", async () => {
    const child = new FakeChild();
    setTimeout(() => { child.closes(1); }, 0);

    const probe = await probeMcpServer({ name: "files", config: stdioConfig, cwd: "/srv", timeoutMs: 2_000 }, { spawnChild: starts(child), env: {} });

    expect(probe.state).toBe("unreachable");
    expect(probe.message).toContain("exited");
  });

  it("reports a server whose stdin is gone before the handshake is written", async () => {
    const child = new FakeChild({ writeFails: true });

    const probe = await probeMcpServer({ name: "files", config: stdioConfig, cwd: "/srv", timeoutMs: 1_000 }, { spawnChild: starts(child), env: {} });

    expect(probe.state).toBe("unreachable");
    expect(probe.message).toContain("write");
    expect(child.kills).toEqual(["SIGTERM"]);
  });

  it("reports a command that cannot be started", async () => {
    const spawn: McpProbeSpawn = () => { throw new Error("ENOENT: no such file or directory"); };

    const probe = await probeMcpServer({ name: "files", config: stdioConfig, cwd: "/srv", timeoutMs: 1_000 }, { spawnChild: spawn, env: {} });

    expect(probe.state).toBe("unreachable");
    expect(probe.message).toContain("Could not start");
  });

  it("reports a process that dies while answering", async () => {
    const child = new FakeChild();
    setTimeout(() => { child.fails("EACCES: permission denied"); }, 0);

    const probe = await probeMcpServer({ name: "files", config: stdioConfig, cwd: "/srv", timeoutMs: 2_000 }, { spawnChild: starts(child), env: {} });

    expect(probe.state).toBe("unreachable");
    expect(probe.message).toContain("Could not start");
  });

  it("kills a server that ignores SIGTERM, so no process is left behind", async () => {
    const child = new FakeChild({ ignoresSigterm: true });

    const probe = await probeMcpServer({ name: "files", config: stdioConfig, cwd: "/srv", timeoutMs: 200 }, { spawnChild: starts(child), env: {} });

    expect(probe.state).toBe("unreachable");
    expect(child.kills).toEqual(["SIGTERM", "SIGKILL"]);
    expect(child.isRunning()).toBe(false);
  });

  it("refuses to probe a config that resolves a value by running a command, and does not run it", async () => {
    const spawn = vi.fn();

    const probe = await probeMcpServer(
      { name: "files", config: { command: "mcp-files", args: ["!op read op://x/secret"] }, cwd: "/srv", timeoutMs: 1_000 },
      { spawnChild: spawn, env: {} },
    );

    expect(probe.state).toBe("unreachable");
    expect(probe.message).toContain("Not probed");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("resolves a ${NAME} reference from the environment it is given, and never shows the value", async () => {
    const child = new FakeChild();
    child.emitStdout(handshakeLine(accepted));

    await probeMcpServer(
      { name: "files", config: { ...stdioConfig, env: { TOKEN: "${TOKEN}" } }, cwd: "/srv", timeoutMs: 2_000 },
      { spawnChild: starts(child), env: { TOKEN: "from-the-environment" } },
    );

    expect(child.lines.join("")).not.toContain("from-the-environment");
  });

  it("never repeats a secret a server echoed back", async () => {
    const child = new FakeChild();
    child.emitStdout(handshakeLine({ error: { code: -32001, message: "token env-secret-value rejected" } }));

    const probe = await probeMcpServer(
      { name: "files", config: { ...stdioConfig, env: { TOKEN: "env-secret-value" } }, cwd: "/srv", timeoutMs: 2_000 },
      { spawnChild: starts(child), env: {} },
    );

    expect(probe.state).toBe("unreachable");
    expect(probe.message).not.toContain("env-secret-value");
    expect(probe.message).toContain("[redacted]");
  });
});

describe("what a probe is allowed to repeat", () => {
  it("cuts a secret the configuration resolved from the environment, not only the name it wrote", async () => {
    const child = new FakeChild();
    child.emitStdout(handshakeLine({ error: { code: -32001, message: "token resolved-secret-value rejected" } }));

    const probe = await probeMcpServer(
      { name: "files", config: { command: "mcp-files", env: { TOKEN: "${TOKEN}" } }, cwd: "/srv", timeoutMs: 2_000 },
      { spawnChild: starts(child), env: { TOKEN: "resolved-secret-value" } },
    );

    expect(probe.state).toBe("unreachable");
    expect(probe.message).not.toContain("resolved-secret-value");
    expect(probe.message).toContain("[redacted]");
  });

  it("cuts a token a wrapper's arguments carried, which the server can echo back", async () => {
    const child = new FakeChild();
    child.emitStdout(handshakeLine({ error: { code: -32001, message: "https://mcp.example.test/mcp?token=arg-secret-value refused" } }));

    const probe = await probeMcpServer(
      { name: "remote", config: { command: "npx", args: ["mcp-remote", "https://mcp.example.test/mcp?token=arg-secret-value"] }, cwd: "/srv", timeoutMs: 2_000 },
      { spawnChild: starts(child), env: {} },
    );

    expect(probe.message).not.toContain("arg-secret-value");
  });

  it("cuts a secret out of the server's own name, and keeps a long one bounded", async () => {
    const child = new FakeChild();
    child.emitStdout(handshakeLine({
      result: {
        protocolVersion: "2025-06-18",
        serverInfo: { name: `files-server ${"noise ".repeat(200)}env-secret-value`, version: "1.0 env-secret-value" },
      },
    }));

    const probe = await probeMcpServer(
      { name: "files", config: { command: "mcp-files", env: { TOKEN: "env-secret-value" } }, cwd: "/srv", timeoutMs: 2_000 },
      { spawnChild: starts(child), env: {} },
    );

    expect(probe.serverName).not.toContain("env-secret-value");
    expect(probe.serverVersion).not.toContain("env-secret-value");
    expect((probe.serverName ?? "").length).toBeLessThanOrEqual(401);
  });
});

describe("the node process adapter", () => {
  const posixIt = process.platform === "win32" ? it.skip : it;

  posixIt("signals the whole process group, so a wrapper's server dies with the wrapper", async () => {
    const child = spawnNodeProbeChild({ command: "sh", args: ["-c", "sleep 300 & echo $!; wait"], cwd: process.cwd(), env: process.env });
    const grandchildPid = await new Promise<string>((resolve) => {
      let text = "";
      child.onStdout((chunk) => {
        text += chunk;
        const line = text.split("\n")[0] ?? "";
        if (line.trim() !== "") resolve(line.trim());
      });
    });
    expect(grandchildPid).toMatch(/^\d+$/);

    child.kill("SIGKILL");
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(processAlive(Number(grandchildPid))).toBe(false);
  });

  posixIt("does not signal a process that never started", async () => {
    const child = spawnNodeProbeChild({ command: "pi-web-not-a-command-anywhere", args: [], cwd: process.cwd(), env: process.env });
    await new Promise<number | null>((resolve) => { child.onClose(resolve); });

    expect(child.isRunning()).toBe(false);
    expect(() => { child.kill("SIGKILL"); }).not.toThrow();
  });
});

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("probing an HTTP server", () => {
  const urlConfig = { url: "https://example.test/mcp", headers: { Authorization: "Bearer header-secret-value" } };

  /** An HTTP server that answers once, and the requests it was sent. */
  function httpServer(answer: { status: number; ok: boolean; body: string }) {
    const asked: { url: string; init: Parameters<McpProbeFetch>[1] }[] = [];
    const fetch: McpProbeFetch = (url, init) => {
      asked.push({ url, init });
      return Promise.resolve({ status: answer.status, ok: answer.ok, text: () => Promise.resolve(answer.body) });
    };
    return { fetch, asked };
  }

  it("posts pi's initialize, with the config's own header, and reads the JSON answer", async () => {
    const { fetch, asked } = httpServer({ status: 200, ok: true, body: JSON.stringify(accepted) });

    const probe = await probeMcpServer({ name: "files", config: urlConfig, cwd: "/srv", timeoutMs: 2_000 }, { fetch, env: {} });

    expect(probe).toMatchObject({ state: "reachable", serverName: "files-server" });
    const request = asked[0];
    if (request === undefined) throw new Error("Expected the probe to ask the server");
    expect(request.url).toBe("https://example.test/mcp");
    expect(request.init.method).toBe("POST");
    expect(request.init.headers["accept"]).toContain("text/event-stream");
    expect(request.init.headers["Authorization"]).toBe("Bearer header-secret-value");
    expect(request.init.body).toContain('"method":"initialize"');
  });

  it("resolves a ${NAME} header reference from the environment it is given", async () => {
    const { fetch, asked } = httpServer({ status: 200, ok: true, body: JSON.stringify(accepted) });

    await probeMcpServer(
      { name: "files", config: { url: "https://example.test/mcp", headers: { Authorization: "Bearer ${FILES_TOKEN}" } }, cwd: "/srv", timeoutMs: 2_000 },
      { fetch, env: { FILES_TOKEN: "token-from-env" } },
    );

    const request = asked[0];
    if (request === undefined) throw new Error("Expected the probe to ask the server");
    expect(request.init.headers["Authorization"]).toBe("Bearer token-from-env");
  });

  it("reads a server that answers in server-sent events", async () => {
    const { fetch } = httpServer({ status: 200, ok: true, body: `event: message\ndata: ${JSON.stringify(accepted)}\n\n` });

    expect(await probeMcpServer({ name: "files", config: { url: "https://example.test/mcp" }, cwd: "/srv", timeoutMs: 2_000 }, { fetch, env: {} }))
      .toMatchObject({ state: "reachable" });
  });

  it("calls a server that asks for a sign-in what it is", async () => {
    const { fetch } = httpServer({ status: 401, ok: false, body: "" });

    const probe = await probeMcpServer({ name: "files", config: { url: "https://example.test/mcp" }, cwd: "/srv", timeoutMs: 2_000 }, { fetch, env: {} });

    expect(probe.state).toBe("needs-auth");
    expect(probe.message).toContain("401");
  });

  it("reports a transport failure without repeating a credential the server saw", async () => {
    const { fetch } = httpServer({ status: 500, ok: false, body: "Authorization: Bearer header-secret-value is invalid" });

    const probe = await probeMcpServer({ name: "files", config: urlConfig, cwd: "/srv", timeoutMs: 2_000 }, { fetch, env: {} });

    expect(probe.state).toBe("unreachable");
    expect(probe.message).not.toContain("header-secret-value");
  });

  it("gives up on a server that does not answer in time", async () => {
    const fetch: McpProbeFetch = (_url, init) => new Promise<never>((_resolve, reject) => {
      init.signal.addEventListener("abort", () => { reject(new Error("aborted")); });
    });

    const probe = await probeMcpServer({ name: "files", config: { url: "https://example.test/mcp" }, cwd: "/srv", timeoutMs: 200 }, { fetch, env: {} });

    expect(probe.state).toBe("unreachable");
    expect(probe.message).toContain("did not answer");
  });

  it("refuses to probe a config with no url", async () => {
    const probe = await probeMcpServer({ name: "files", config: { command: "", url: "" }, cwd: "/srv", timeoutMs: 500 });

    expect(probe.state).toBe("unreachable");
  });
});
