import { useEffect, useRef, useState, type ReactNode } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { terminalSocket } from "../../../api/sockets";
import { Icon, IconButton } from "../common/icons";
import { registerShellCommands } from "../../state/shellCommands";
import { closeAllTerminals, closeTerminal, readTerminals, renameTerminal, setActiveTerminal, startTerminal, useTerminals, type TerminalScope } from "../../state/terminalRuntime";
import "@xterm/xterm/css/xterm.css";

/**
 * The Terminal tab.
 *
 * One xterm, one socket, and the socket belongs to the terminal on screen: it is
 * opened when a terminal is shown and closed when it is not, so a workspace is
 * never holding a shell open that the reader cannot see. Resize is the fit
 * addon's measurement, sent on the socket the machine reads.
 */
export interface TerminalPanelProps {
  scope: TerminalScope | undefined;
}

export function TerminalPanel(props: TerminalPanelProps): ReactNode {
  const terminals = useTerminals();
  const scope = props.scope;
  const host = useRef<HTMLDivElement | null>(null);
  const [connection, setConnection] = useState<"idle" | "opening" | "open" | "closed" | "failed">("idle");
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState("");

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
        run: () => { void startTerminal(scope, { cols: 80, rows: 24 }); },
      },
      {
        id: "terminal.close",
        title: "Close the shown terminal",
        group: "Terminal",
        disabled: terminals.activeId === undefined ? "No terminal is shown" : undefined,
        run: () => {
          if (terminals.activeId !== undefined) void closeTerminal(scope, terminals.activeId);
        },
      },
      { id: "terminal.closeAll", title: "Close every terminal here", group: "Terminal", run: () => { void closeAllTerminals(scope); }},
      {
        id: "terminal.rename",
        title: "Rename the shown terminal",
        group: "Terminal",
        disabled: terminals.activeId === undefined ? "No terminal is shown" : undefined,
        run: () => { setRenaming(true); },
      },
    ]);
    return unsubscribe;
  }, [scope, terminals.activeId]);

  useEffect(() => {
    const element = host.current;
    const terminalId = terminals.activeId;
    if (element === null || scope === undefined || terminalId === undefined) {
      setConnection("idle");
      return;
    }
    setConnection("opening");
    const term = new Terminal({ convertEol: true, fontFamily: "var(--pi-font-mono, ui-monospace, monospace)", fontSize: 13, scrollback: 5000, theme: { background: "transparent" } });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(element);
    fit.fit();
    const socket = terminalSocket(scope.projectId, scope.workspaceId, terminalId, { cols: term.cols, rows: term.rows }, scope.machineId);
    socket.addEventListener("open", () => { setConnection("open"); });
    socket.addEventListener("close", () => { setConnection("closed"); });
    socket.addEventListener("error", () => { setConnection("failed"); });
    socket.binaryType = "arraybuffer";
    socket.addEventListener("message", (event) => {
      if (event.data instanceof ArrayBuffer) {
        term.write(new Uint8Array(event.data));
        return;
      }
      if (typeof event.data === "string") term.write(event.data);
    });
    const input = term.onData((data) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(new TextEncoder().encode(data));
    });
    const resize = term.onResize(({ cols, rows }) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(new TextEncoder().encode(`\u001b[?${String(rows)};${String(cols)}H`));
    });
    const observer = new ResizeObserver(() => { fit.fit(); });
    observer.observe(element);
    return () => {
      observer.disconnect();
      input.dispose();
      resize.dispose();
      term.dispose();
      socket.close();
    };
  }, [scope?.machineId, scope?.projectId, scope?.workspaceId, terminals.activeId]);

  if (scope === undefined) return <p className="piw-empty">No workspace is chosen, so there is no terminal to open.</p>;

  const active = terminals.read.value?.find((terminal) => terminal.id === terminals.activeId);

  return (
    <div className="piw-terminal" data-testid="terminal-panel">
      <div className="piw-terminal__strip">
        {(terminals.read.value ?? []).map((terminal) => (
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
      </div>

      {renaming && active !== undefined ? (
        <div className="piw-terminal__rename">
          <label className="piw-field">
            <span className="piw-label">Terminal name</span>
            <input className="piw-input" onChange={(event) => { setName(event.target.value); }} value={name === "" ? terminalName(active) : name} />
          </label>
          <button
            className="piw-button piw-button--primary"
            onClick={() => {
              const target = name === "" ? terminalName(active) : name;
              void renameTerminal(scope, active.id, target).then(() => { setRenaming(false); });
            }}
            type="button"
          >
            Rename
          </button>
        </div>
      ) : null}

      {terminals.read.phase === "loading" ? <p className="piw-empty">Reading this workspace's terminals…</p> : null}
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
      <div className="piw-terminal__status">
        <Icon label="" name={connection === "open" ? "check" : connection === "failed" ? "rescue" : "wifi"} size="small" />
        <span>{connectionWords(connection)}</span>
      </div>
    </div>
  );
}

function connectionWords(connection: string): string {
  if (connection === "open") return "Connected";
  if (connection === "opening") return "Connecting…";
  if (connection === "closed") return "Closed — the shell exited or the machine closed it";
  if (connection === "failed") return "The terminal socket failed";
  return "No terminal shown";
}

function terminalName(terminal: { name?: string; id: string }): string {
  return terminal.name === undefined || terminal.name === "" ? terminal.id.slice(0, 8) : terminal.name;
}
