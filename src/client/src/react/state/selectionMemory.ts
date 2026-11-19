import type { SessionInfo } from "../../../../shared/apiTypes";
import type { SessionSelectionMemory } from "../../controllers/sessionSelection";

/**
 * Which session this browser last read in each workspace.
 *
 * PI WEB opens a workspace at the session the reader was last in, and the rule
 * lives in `selectPreferredSession`. This is where that memory is kept, so a
 * reload, a Back gesture, or coming back to the project from the switcher opens
 * the same session the reader left.
 *
 * It is per browser and per workspace path, and it never claims a session
 * exists: a remembered id that the machine no longer lists is simply not
 * preferred, and the newest live session takes its place.
 */
const storageKey = "pi-web-last-session-by-workspace";

type LastSessionByWorkspace = Record<string, string>;

function readTable(storage: Storage): LastSessionByWorkspace {
  const raw = storage.getItem(storageKey);
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const entries = Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string");
    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}

function writeTable(storage: Storage, table: LastSessionByWorkspace): void {
  try {
    storage.setItem(storageKey, JSON.stringify(table));
  } catch {
    // A browser that refuses to store (private mode, quota) keeps the memory for
    // the page's life only; the preferred-session rule still works from the listing.
  }
}

export const lastSessionMemory: SessionSelectionMemory = {
  latestSessionId(cwd: string): string | undefined {
    if (typeof window === "undefined") return undefined;
    return readTable(window.localStorage)[cwd];
  },
  rememberSession(session: SessionInfo): void {
    if (typeof window === "undefined") return;
    const table = readTable(window.localStorage);
    if (table[session.cwd] === session.id) return;
    table[session.cwd] = session.id;
    writeTable(window.localStorage, table);
  },
  forgetWorkspace(cwd: string): void {
    if (typeof window === "undefined") return;
    const table = readTable(window.localStorage);
    if (table[cwd] === undefined) return;
    writeTable(window.localStorage, Object.fromEntries(Object.entries(table).filter((entry) => entry[0] !== cwd)));
  },
};
