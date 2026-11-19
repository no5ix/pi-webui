import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Dialog } from "./Dialog";
import { Icon, type IconName } from "./icons";
import { closeLayer, useLayerKey } from "../../state/panels";
import { matchedCommands, runShellCommand, shellCommandGroups, useShellCommands, type ShellCommand } from "../../state/shellCommands";

/**
 * The command palette.
 *
 * Every command the shell and the panels registered, one filter box, Enter runs
 * the highlighted one. A command that cannot run carries the reason the owner
 * gave, and it is shown — the point of a palette is to be honest about what is
 * available right now.
 */
export function CommandPalette(): ReactNode {
  const layer = useLayerKey();
  const commands = useShellCommands();
  const [filter, setFilter] = useState("");

  const groups = useMemo(() => shellCommandGroups(matchedCommands(commands, filter)).filter((group) => group.items.length > 0), [commands, filter]);

  const [index, setIndex] = useState(0);
  const flat = groups.flatMap((group) => group.items);
  const scroller = useRef<HTMLUListElement | null>(null);

  useEffect(() => { setIndex(0); }, [filter]);
  useEffect(() => {
    scroller.current?.querySelector('[data-highlighted="true"]')?.scrollIntoView({ block: "nearest" });
  }, [index]);

  const open = (
    <Dialog onClose={() => { closeLayer(); }} open={true} title="Commands">
      <div className="piw-palette" data-testid="command-palette">
        <input
          aria-label="Search commands"
          autoFocus={true}
          className="piw-palette__search"
          onChange={(event) => { setFilter(event.target.value); }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setIndex((current) => Math.min(current + 1, Math.max(flat.length - 1, 0)));
              return;
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setIndex((current) => Math.max(current - 1, 0));
              return;
            }
            if (event.key === "Enter") {
              event.preventDefault();
              const command = flat[index];
              if (command === undefined || command.disabled !== undefined) return;
              closeLayer();
              runShellCommand(command.id);
            }
          }}
          placeholder="Type a command…"
          role="combobox"
          value={filter}
        />
        {flat.length === 0 ? <p className="piw-empty">No command matches “{filter}”.</p> : null}
        <ul className="piw-palette__results" ref={scroller} role="listbox">
          {groups.map((group) => (
            <li key={group.group}>
              <h3 className="piw-label">{group.group}</h3>
              <ul>
                {group.items.map((command) => {
                  const position = flat.indexOf(command);
                  const highlighted = position === index;
                  return (
                    <li data-highlighted={highlighted ? "true" : "false"} key={command.id}>
                      <button
                        aria-disabled={command.disabled !== undefined}
                        className={highlighted ? "piw-palette__item piw-palette__item--active" : "piw-palette__item"}
                        disabled={command.disabled !== undefined}
                        onClick={() => {
                          closeLayer();
                          runShellCommand(command.id);
                        }}
                        onMouseEnter={() => { setIndex(position); }}
                        title={command.disabled ?? command.title}
                        type="button"
                      >
                        <Icon label="" name={iconOf(command)} size="small" />
                        <span className="piw-palette__item-title">{command.title}</span>
                        <span className="piw-palette__item-group">{command.group}</span>
                        {command.chord === undefined ? null : <kbd className="piw-kbd">{command.chord}</kbd>}
                      </button>
                      {command.disabled === undefined ? null : <p className="piw-palette__item-disabled">{command.disabled}</p>}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    </Dialog>
  );

  return layer === "palette" ? open : null;
}

const groupIcons: Record<string, IconName> = {
  Workbench: "gitBranch",
  Window: "list",
  Session: "bot",
  Project: "folder",
  View: "search",
  Account: "info",
};

function iconOf(command: ShellCommand): IconName {
  return groupIcons[command.group] ?? "bot";
}
