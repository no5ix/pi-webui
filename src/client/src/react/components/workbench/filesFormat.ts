/**
 * The words the Files surface uses for a file's facts.
 *
 * The machine answers a size in bytes and a modification time as an ISO
 * timestamp; the panel states both the way the rest of the shell does, and
 * states an unknown fact in words instead of drawing a dash that reads as zero.
 */

const byteUnits = ["B", "KB", "MB", "GB", "TB"] as const;

const timestampFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" });

/** A size in bytes, in the largest unit that keeps at least two significant digits. */
export function formatFileSize(bytes: number | undefined): string {
  if (bytes === undefined) return "size unknown";
  if (!Number.isFinite(bytes) || bytes < 0) return "size unknown";
  if (bytes < 1024) return `${String(bytes)} B`;
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), byteUnits.length - 1);
  const unit = byteUnits[exponent] ?? "B";
  const value = bytes / 1024 ** exponent;
  const text = value >= 100 ? String(Math.round(value)) : String(Math.round(value * 10) / 10);
  return `${text} ${unit}`;
}

/** A modification time as the reader's date and time; an unreadable stamp says so. */
export function formatFileTimestamp(stamp: string | undefined): string {
  if (stamp === undefined) return "modified unknown";
  const time = Date.parse(stamp);
  if (!Number.isFinite(time)) return "modified unknown";
  return timestampFormatter.format(new Date(time));
}
