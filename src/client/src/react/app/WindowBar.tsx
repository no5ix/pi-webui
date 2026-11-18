import { useEffect, useState, type ReactNode } from "react";
import { machinesApi } from "../../api/clients";
import type { Machine } from "../../../../shared/apiTypes";
import { useBoard } from "../state/board";
import { selectMachine, localMachineId } from "../state/selection";
import { IconButton, Icon } from "../components/common/icons";
import type { Subject } from "./AppShell";
import type { ShellLayout } from "./AppShell";

/**
 * The window bar: what this page is, which machine it is talking to, how live it
 * is, and the two entries every screen needs — the command palette and settings.
 *
 * The session title does not live here. The reference design puts the subject of
 * the page in the conversation header, where the transcript it names begins; the
 * bar stays the window's own chrome.
 */
export interface WindowBarProps {
  machineId: string;
  subject: Subject;
  layout: ShellLayout;
  onCommandPalette: () => void;
  onQuickSwitcher: () => void;
  onSettings: () => void;
}

export function WindowBar(props: WindowBarProps): ReactNode {
  const board = useBoard();
  const [machines, setMachines] = useState<readonly Machine[]>([]);

  useEffect(() => {
    let open = true;
    void machinesApi.machines().then(
      (list) => {
        if (open) setMachines(list);
      },
      () => {
        // An unanswered machine list leaves the local machine as the only choice.
      },
    );
    return () => {
      open = false;
    };
  }, []);

  const machine = machines.find((candidate) => candidate.id === props.machineId);
  const connection = board.connection;
  const phase = board.phase;

  return (
    <header className="piw-window-bar">
      <span className="piw-window-bar__title">
        pi-webui
        <span className="piw-window-bar__subtitle">{machine === undefined ? "local" : machine.name}</span>
      </span>
      <span className="piw-window-bar__spacer" />
      <span aria-label={`Connection: ${connectionWords(connection, phase)}`} className="piw-chip" title={connectionWords(connection, phase)}>
        <span className={dotClass(connection, phase)} />
        {connectionWords(connection, phase)}
      </span>
      {machines.length > 1 ? (
        <label className="piw-chip" title="Machine">
          <Icon name="wifi" size="small" />
          <select
            aria-label="Machine"
            className="piw-input"
            onChange={(event) => { selectMachine(event.currentTarget.value); }}
            value={props.machineId}
          >
            {machines.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <span className="piw-window-bar__actions">
        <IconButton icon="zap" label="Commands" onClick={props.onCommandPalette} testId="window-bar-commands" />
        <IconButton icon="gear" label="Settings" onClick={props.onSettings} testId="window-bar-settings" />
      </span>
    </header>
  );
}

function connectionWords(connection: string, phase: string): string {
  if (connection === "closed") return "Disconnected";
  if (phase === "failed") return "Not answering";
  if (phase === "refused") return "Sign-in needed";
  if (connection === "connecting") return "Connecting";
  if (phase === "partial") return "Partly loaded";
  return "Live";
}

function dotClass(connection: string, phase: string): string {
  if (phase === "failed" || phase === "refused") return "piw-dot piw-dot--error";
  if (connection === "open" && phase !== "partial") return "piw-dot piw-dot--working";
  return "piw-dot";
}

export { localMachineId };
