/**
 * The filenames a session wrote, in the words the sidebar rail needs.
 *
 * Which tool records count as writing a file is decided once, in the app's
 * transcript reading (`editedFilePaths` in PiWebApp), and this module turns those
 * paths into rows: a file edited many times is one row, the name is the row's
 * label and its directory is the tail. A path is presented, never resolved -
 * these are the paths the tools named, which is what a reader checks them
 * against, and not a claim about the working tree (the Git tab counts that).
 */

/** One file the session named. */
export interface EditedFileRow {
  /** The path exactly as the tool named it. */
  path: string;
  /** The file's name, the row's label. */
  name: string;
  /** The path's directory, shown beside the name; empty for a bare name. */
  directory: string;
};

/** One path per file, each split into the name a row leads with and its directory. */
export function editedFileRows(paths: readonly string[]): EditedFileRow[] {
  const rows = new Map<string, EditedFileRow>();
  for (const path of paths) {
    const trimmed = path.trim();
    if (trimmed === "") continue;
    const normalised = trimmed.replaceAll("\\", "/");
    const name = normalised.slice(normalised.lastIndexOf("/") + 1);
    if (name === "" || rows.has(name)) continue;
    const directory = normalised.slice(0, Math.max(0, normalised.length - name.length)).replace(/\/+$/u, "");
    rows.set(name, { path: trimmed, name, directory });
  }
  return [...rows.values()];
}
