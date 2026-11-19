import "./terminal.css";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { terminalSocket } from "../../../api/sockets";
import { Icon, IconButton } from "../common/icons";
import { registerShellCommands } from "../../state/shellCommands";
import {
  clearTerminalOpenRequest,
  closeAllTerminals,
  closeTerminal,
  parseTerminalServerFrame,
  readTerminals,
  renameTerminal,
  setActiveTerminal,
  startTerminal,
  terminalInputFrame,
  terminalResizeFrame,
  useTerminals,
  type TerminalScope,
} from "../../state/terminalRuntime";
import "@xterm/xterm/css/xterm.css";

/**
 * The Terminal tab.
 *
 * One xterm, one socket, and the socket belongs to the terminal on screen: it is
 * opened when a terminal is shown and closed when it is not, so a workspace is
 * never holding a shell open that the reader cannot see. The socket is the
 * daemon's framed protocol, not a raw pty pipe, so every keystroke leaves as an
 * `input` frame and every machine frame arrives parsed; the fit addon's
 * measurement is sent as a `resize` frame the machine applies to the shell.
 *
 * A coarse pointer gets the keys a phone keyboard cannot type, and full height
 * gives the shell the panel's whole body when the reader wants to work in it.
 */
export interface TerminalPanelProps {
  scope: TerminalScope | undefined;
}

type ConnectionState = "idle" | "opening" | "open" | "closed" | "failed";

interface SoftKey {
  label: string;
  bytes: string;
}

const softKeys: readonly SoftKey[] = [
  { label: "Escape", bytes: "\u001b" },
  { label: "Control C", bytes: "\u0003" },
  { label: "Control D", bytes: "\u0004" },
  { label: "Tab", bytes: "\t" },
  { label: "Up arrow", bytes: "\u001b[A" },
  { label: "Down arrow", bytes: "\u001b[B" },
  { label: "Right arrow", bytes: "\u001b[C" },
  { label: "Left arrow", bytes: "\u001b[D" },
  { label: "Page up", bytes: "\u001b[5~" },
  { label: "Page down", bytes: "\u001b[6~" },
  { label: "Return", bytes: "\r" },
];

export function TerminalPanel(props: TerminalPanelProps): ReactNode {
  const terminals = useTerminals();
  const scope = props.scope;
  const host = useRef<HTMLDivElement | null>(null);
  const send = useRef<((frame: string) => void) | undefined>(undefined);
  const [connection, setConnection] = useState<ConnectionState>("idle");
  const [machineWords, setMachineWords] = useState<string | undefined>(undefined);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [attachKey, setAttachKey] = useState(0);

  useEffect(() => {
    const request = terminals.openRequested;
    if (request === undefined) return;
    if (request.terminalId === undefined) {
      if (scope !== undefined) void startTerminal(scope, { cols: 80, rows: 24 });
    } else {
      setActiveTerminal(request.terminalId);
    }
    clearTerminalOpenRequest();
  }, [terminals.openRequested, scope]);

  useEffect(() => {
    if (scope === undefined) return;
    void readTerminals(scope);
  }, [scope?.machineId, scope?.projectId, scope?.workspaceId]);

  useEffect(() => {
    if (scope === undefined) return;
    const unsubscribe = registerShellCommands([
      {
        id: "terminal.new",
        title: "New terminal",
        group: "Terminal",
        keywords: ["shell", "console"],
        run: () => { void startTerminal(scope, { cols: 80, rows: 24 }); },
      },
      {
        id: "terminal.close",
        title: "Close the shown terminal",
        group: "Terminal",
        keywords: ["kill", "exit"],
        disabled: terminals.activeId === undefined ? "No terminal is shown" : undefined,
        run: () => {
          if (terminals.activeId !== undefined) void closeTerminal(scope, terminals.activeId);
        },
      },
      { id: "terminal.closeAll", title: "Close every terminal here", group: "Terminal", keywords: ["kill all"], run: () => { void closeAllTerminals(scope); } },
      {
        id: "terminal.rename",
        title: "Rename the shown terminal",
        group: "Terminal",
        disabled: terminals.activeId === undefined ? "No terminal is shown" : undefined,
        run: () => { setRenaming(true); },
      },
      {
        id: "terminal.reconnect",
        title: "Reconnect the shown terminal",
        group: "Terminal",
        keywords: ["reconnect", "attach"],
        disabled: terminals.activeId === undefined ? "No terminal is shown" : undefined,
        run: () => { setAttachKey((current) => current + 1); },
      },
    ]);
    return unsubscribe;
  }, [scope, terminals.activeId]);

  useEffect(() => {
    const element = host.current;
    const terminalId = terminals.activeId;
    if (element === null || scope === undefined || terminalId === undefined) {
      send.current = undefined;
      setConnection("idle");
      return;
    }
    setConnection("opening");
    setMachineWords(undefined);
    const term = new Terminal({ convertEol: true, fontFamily: "ui-monospace, monospace", fontSize: 13, scrollback: 5000, theme: { background: "transparent" } });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(element);
    fit.fit();
    const socket = terminalSocket(scope.projectId, scope.workspaceId, terminalId, { cols: term.cols, rows: term.rows }, scope.machineId);
    socket.binaryType = "arraybuffer";
    const writeFrame = (frame: string): void => {
      if (socket.readyState === WebSocket.OPEN) socket.send(frame);
    };
    send.current = writeFrame;
    socket.addEventListener("open", () => {
      setConnection("open");
      socket.send(terminalResizeFrame(term.cols, term.rows));
    });
    socket.addEventListener("close", () => {
      setConnection((current) => (current === "failed" ? current : "closed"));
    });
    socket.addEventListener("error", () => { setConnection("failed"); });
    socket.addEventListener("message", (event) => {
      const frame = parseTerminalServerFrame(event.data);
      if (frame === undefined) return;
      if (frame.type === "output") {
        term.write(frame.data);
        return;
      }
      if (frame.type === "exit") {
        setConnection("closed");
        setMachineWords(frame.exitCode === undefined ? "The shell exited" : `The shell exited with code ${String(frame.exitCode)}`);
        return;
      }
      setConnection("failed");
      setMachineWords(frame.message);
    });
    const input = term.onData((data) => { socket.send(terminalInputFrame(data)); });
    const resize = term.onResize(({ cols, rows }) => { socket.send(terminalResizeFrame(cols, rows)); });
    const observer = new ResizeObserver(() => { fit.fit(); });
    observer.observe(element);
    return () => {
      observer.disconnect();
      input.dispose();
      resize.dispose();
      send.current = undefined;
      term.dispose();
      socket.close();
    };
  }, [scope?.machineId, scope?.projectId, scope?.workspaceId, terminals.activeId, attachKey]);

  if (scope === undefined) return <p className="piw-empty">No workspace is chosen, so there is no terminal to open.</p>;

  const active = terminals.read.value?.find((terminal) => terminal.id === terminals.activeId);
  const list = terminals.read.value ?? [];

  return (
    <div className={expanded ? "piw-terminal piw-terminal--expanded" : "piw-terminal"} data-testid="terminal-panel">
      {expanded ? null : (
        <div className="piw-terminal__strip">
          {list.map((terminal) => (
            <button
              className={terminal.id === terminals.activeId ? "piw-tab piw-tab--selected" : "piw-tab"}
              key={terminal.id}
              onClick={() => { setActiveTerminal(terminal.id); }}
              type="button"
            >
              {terminalName(terminal)}
            </button>
          ))}
          <span className="piw-workbench__toolbar-spacer" />
          <IconButton disabled={terminals.starting} icon="plus" label="New terminal" onClick={() => { void startTerminal(scope, { cols: 80, rows: 24 }); }} />
          {active === undefined ? null : (
            <>
              <IconButton icon="edit" label="Rename this terminal" onClick={() => { setRenaming(true); }} />
              <IconButton icon="close" label="Close this terminal" onClick={() => { void closeTerminal(scope, active.id); }} />
            </>
          )}
          <IconButton icon="chevronDown" label="Give the terminal the full height" onClick={() => { setExpanded(true); }} />
        </div>
      )}

      {renaming && active !== undefined ? (
        <div className="piw-terminal__rename">
          <label className="piw-field">
            <span className="piw-label">Terminal name</span>
            <input
              className="piw-input"
              onChange={(event) => { setName(event.currentTarget.value); }}
              value={name === "" ? terminalName(active) : name}
            />
          </label>
          <button
            className="piw-button piw-button--primary"
            onClick={() => {
              const target = name === "" ? terminalName(active) : name;
              void renameTerminal(scope, active.id, target).then(() => {
                setRenaming(false);
                setName("");
              });
            }}
            type="button"
          >
            Rename
          </button>
          <button className="piw-button" onClick={() => { setRenaming(false); setName(""); }} type="button">
            Cancel
          </button>
        </div>
      ) : null}

      {terminals.read.phase === "loading" && list.length === 0 ? <p className="piw-empty">Reading this workspace's terminals…</p> : null}
      {terminals.read.phase === "failed" ? <p className="piw-empty">{`Terminals did not answer: ${terminals.read.error ?? "no reason given"}`}</p> : null}
      {terminals.activeId === undefined && terminals.read.phase === "ready" ? (
        <p className="piw-empty">
          {"No terminal is open in this workspace. "}
          <button className="piw-link" onClick={() => { void startTerminal(scope, { cols: 80, rows: 24 }); }} type="button">
            Open one
          </button>
        </p>
      ) : null}

      <div className="piw-terminal__host" ref={host} />

      {terminals.activeId === undefined ? null : (
        <div aria-label="Terminal keys" className="piw-terminal__keys" role="group">
          {softKeys.map((key) => (
            <button
              className="piw-terminal__key"
              key={key.label}
              onClick={() => { send.current?.(terminalInputFrame(key.bytes)); }}
              type="button"
            >
              {keyLabel(key.label)}
            </button>
          ))}
        </div>
      )}

      <div className="piw-terminal__status">
        <Icon label="" name={connection === "open" ? "check" : connection === "failed" ? "rescue" : "wifi"} size="small" />
        <span>{machineWords ?? connectionWords(connection)}</span>
        {connection === "closed" || connection === "failed" ? (
          <button className="piw-link" onClick={() => { setAttachKey((current) => current + 1); }} type="button">
            Reconnect
          </button>
        ) : null}
        {expanded ? (
          <button className="piw-link" onClick={() => { setExpanded(false); }} type="button">
            Restore the terminal list
          </button>
        ) : null}
      </div>
    </div>
  );
}

function keyLabel(label: string): string {
  if (label === "Control C") return "^C";
  if (label === "Control D") return "^D";
  if (label === "Escape") return "Esc";
  if (label === "Up arrow") return "↑";
  if (label === "Down arrow") return "↓";
  if (label === "Right arrow") return "→";
  if (label === "Left arrow") return "←";
  if (label === "Page up") return "PgUp";
  if (label === "Page down") return "PgDn";
  if (label === "Return") return "⏎";
  return label;
}

function connectionWords(connection: ConnectionState): string {
  if (connection === "open") return "Connected";
  if (connection === "opening") return "Connecting…";
  if (connection === "closed") return "Closed — the shell exited, the machine closed it, or the socket dropped";
  if (connection === "failed") return "The terminal socket failed";
  return "No terminal shown";
}

function terminalName(terminal: { name?: string; id: string }): string {
  return terminal.name === undefined || terminal.name === "" ? terminal.id.slice(0, 8) : terminal.name;
}
