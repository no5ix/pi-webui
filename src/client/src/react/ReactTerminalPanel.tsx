import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { TerminalInfo, Workspace } from "../api";
import { workspaceTerminalSessions } from "../plugins/workspaceTerminalSessions";

interface Props {
  workspace: Workspace;
  machineId: string;
}

function messageText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function terminalFrameText(data: unknown): Promise<string> {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (data instanceof Blob) return data.text();
  return String(data);
}

export function ReactTerminalPanel({ workspace, machineId }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const inputRef = useRef<{ dispose(): void } | null>(null);
  const [terminals, setTerminals] = useState<TerminalInfo[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const selectedIdRef = useRef<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const sessions = useMemo(() => workspaceTerminalSessions(workspace, machineId), [workspace.id, workspace.projectId, machineId]);

  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);

  const refresh = useCallback(async (preferId?: string) => {
    setLoading(true);
    setError(undefined);
    try {
      const result = await sessions.list();
      setTerminals(result);
      const currentId = selectedIdRef.current;
      const nextId = preferId && result.some(item => item.id === preferId)
        ? preferId
        : currentId && result.some(item => item.id === currentId)
          ? currentId
          : result.find(item => !item.exited)?.id ?? result[0]?.id;
      selectedIdRef.current = nextId;
      setSelectedId(nextId);
    } catch (cause) {
      setError(messageText(cause));
    } finally {
      setLoading(false);
    }
  }, [sessions]);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null || terminalRef.current !== null) return;
    const terminal = new XTerm({
      cursorBlink: true,
      convertEol: true,
      fontFamily: "var(--rw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
      fontSize: 12,
      theme: {
        background: "#111318",
        foreground: "#d9dce5",
        cursor: "#d9dce5",
        selectionBackground: "#4b5268",
      },
      scrollback: 5000,
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    fit.fit();
    terminalRef.current = terminal;
    fitRef.current = fit;
    const observer = new ResizeObserver(() => {
      fit.fit();
      const size = fit.proposeDimensions();
      if (size && socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({ type: "resize", cols: size.cols, rows: size.rows }));
      }
    });
    observer.observe(host);
    inputRef.current = terminal.onData(data => {
      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "input", data }));
    });
    void refresh();
    return () => {
      observer.disconnect();
      inputRef.current?.dispose();
      socketRef.current?.close();
      socketRef.current = null;
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
    };
  }, [refresh]);

  const connect = useCallback((terminal: TerminalInfo) => {
    const output = terminalRef.current;
    const fit = fitRef.current;
    if (output === null || fit === null) return;
    socketRef.current?.close();
    socketRef.current = null;
    output.reset();
    output.writeln("\x1b[90mConnecting to " + terminal.name + "…\x1b[0m");
    const size = fit.proposeDimensions();
    const socket = sessions.connect(terminal.id, size ? { cols: size.cols, rows: size.rows } : undefined);
    socket.binaryType = "arraybuffer";
    socketRef.current = socket;
    socket.addEventListener("open", () => {
      output.writeln("\x1b[90mConnected.\x1b[0m");
    });
    socket.addEventListener("message", event => {
      void handleTerminalFrame(event.data, output, terminal, refresh);
    });
    socket.addEventListener("close", () => {
      if (socketRef.current === socket) output.writeln("\r\n\x1b[90mTerminal connection closed.\x1b[0m");
    });
    socket.addEventListener("error", () => {
      output.writeln("\r\n\x1b[31mTerminal connection error.\x1b[0m");
    });
  }, [sessions, refresh]);

  const handleTerminalFrame = async (data: unknown, output: XTerm, terminal: TerminalInfo, refreshList: (preferId?: string) => Promise<void>) => {
      try {
        const frame: unknown = JSON.parse(await terminalFrameText(data));
        if (typeof frame !== "object" || frame === null) return;
        const type = Reflect.get(frame, "type");
        if (type === "output" && typeof Reflect.get(frame, "data") === "string") {
          output.write(String(Reflect.get(frame, "data")));
        } else if (type === "exit") {
          const code = Reflect.get(frame, "exitCode");
          output.writeln("\r\n\x1b[90mProcess exited" + (typeof code === "number" ? " (" + code + ")" : "") + ".\x1b[0m");
          void refreshList(terminal.id);
        } else if (type === "error" && typeof Reflect.get(frame, "message") === "string") {
          output.writeln("\r\n\x1b[31m" + String(Reflect.get(frame, "message")) + "\x1b[0m");
        }
      } catch {
        output.writeln("\r\n\x1b[31mReceived an invalid terminal frame.\x1b[0m");
      }
  };


  useEffect(() => {
    const selected = terminals.find(item => item.id === selectedId);
    if (selected !== undefined) connect(selected);
    else {
      socketRef.current?.close();
      socketRef.current = null;
      terminalRef.current?.reset();
    }
  }, [selectedId, terminals, connect]);

  const createTerminal = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const size = fitRef.current?.proposeDimensions();
      const created = await sessions.start(size ? { cols: size.cols, rows: size.rows } : undefined);
      await refresh(created.id);
    } catch (cause) {
      setError(messageText(cause));
    } finally {
      setBusy(false);
    }
  };

  const closeTerminal = async () => {
    if (selectedId === undefined) return;
    const closing = selectedId;
    setBusy(true);
    setError(undefined);
    try {
      await sessions.close(closing);
      socketRef.current?.close();
      await refresh();
    } catch (cause) {
      setError(messageText(cause));
    } finally {
      setBusy(false);
    }
  };

  const continueTerminal = async () => {
    if (selectedId === undefined) return;
    setBusy(true);
    setError(undefined);
    try {
      const continued = await sessions.continue(selectedId);
      await refresh(continued.id);
    } catch (cause) {
      setError(messageText(cause));
    } finally {
      setBusy(false);
    }
  };

  return <div className="rw-terminal-panel">
    <div className="rw-terminal-toolbar">
      <div className="rw-terminal-select-wrap">
        <select aria-label="Terminal session" value={selectedId ?? ""} onChange={event => setSelectedId(event.target.value || undefined)} disabled={loading || terminals.length === 0}>
          {terminals.length === 0 && <option value="">{loading ? "Loading terminals…" : "No terminal sessions"}</option>}
          {terminals.map(terminal => <option value={terminal.id} key={terminal.id}>{terminal.name}{terminal.exited ? " (exited)" : ""}</option>)}
        </select>
      </div>
      <button onClick={() => void refresh(selectedId)} title="Refresh terminal list" disabled={busy || loading}>Refresh</button>
      <button onClick={() => void createTerminal()} disabled={busy || loading}>New terminal</button>
      {terminals.find(item => item.id === selectedId)?.exited && <button onClick={() => void continueTerminal()} disabled={busy}>Continue</button>}
      <button onClick={() => void closeTerminal()} disabled={busy || selectedId === undefined}>Close</button>
    </div>
    {error && <div className="rw-data-error">{error}</div>}
    <div className="rw-terminal-screen" ref={hostRef}/>
  </div>;
}
