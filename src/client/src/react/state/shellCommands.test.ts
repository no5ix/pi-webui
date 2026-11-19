import { describe, expect, it } from "vitest";
import { builtInShellCommands, matchedCommands, type ShellCommand } from "./shellCommands";

function command(over: Partial<ShellCommand> & { id: string }): ShellCommand {
  return { title: over.id, group: "Session", run: () => undefined, ...over };
}

const commands: readonly ShellCommand[] = [
  ...builtInShellCommands,
  command({ id: "session.stop", title: "Stop the running turn", keywords: ["stop", "abort", "kill"] }),
  command({ id: "session.archiveTree", title: "Archive session with children", keywords: ["archive", "tree"] }),
  command({ id: "session.copyPath", title: "Copy session path", keywords: ["copy", "path"], chord: "⌘⇧C" }),
];

const ids = (filter: string): readonly string[] => matchedCommands(commands, filter).map((entry) => entry.id);

describe("the palette's filter", () => {
  it("lists every command when the box is empty, in the order the owners registered", () => {
    expect(matchedCommands(commands, "")).toHaveLength(commands.length);
    expect(matchedCommands(commands, "   ")).toHaveLength(commands.length);
    expect(ids("").slice(0, 2)).toEqual(builtInShellCommands.slice(0, 2).map((entry) => entry.id));
  });

  it("matches a keyword the owner supplied, not only the title", () => {
    expect(ids("kill")).toEqual(["session.stop"]);
    expect(ids("copy path")).toEqual(["session.copyPath"]);
  });

  it("requires every term the reader typed", () => {
    expect(ids("archive tree")).toEqual(["session.archiveTree"]);
    expect(ids("archive descendants")).toHaveLength(0);
  });

  it("matches the owner and the chord, the things a reader reads first", () => {
    expect(ids("workbench")).toContain("workbench.git");
    expect(ids("⌘⇧c")).toEqual(["session.copyPath"]);
  });

  it("answers nothing, loudly, when no command fits", () => {
    expect(matchedCommands(commands, "quantum loom")).toHaveLength(0);
  });
});
