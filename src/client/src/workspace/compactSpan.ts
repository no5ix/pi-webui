/**
 * A span of time in the fewest characters that still say what it is.
 *
 * The sidebar's rows carry an age ("12m", "2d") in a column a few characters
 * wide, and the running list carries an elapsed span in the same column. One
 * formatter keeps the two columns reading alike, and keeps a row's width
 * predictable, which a sentence-length label is not.
 *
 * A span of a minute or more drops its remainder: a sidebar row that says
 * "7m 24s" invites the reader to watch the seconds, and the row is re-rendered
 * on every status frame anyway. Under a minute the seconds carry the
 * information ("45s" is now; "9s" is just now).
 */
export function compactSpan(spanMs: number): string {
  const seconds = Math.max(0, Math.round(spanMs / 1000));
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h`;
  return `${String(Math.floor(hours / 24))}d`;
}

/** How long ago a timestamp is, in the sidebar's compact form. */
export function compactAge(iso: string | undefined, now: number = Date.now()): string | undefined {
  const at = parseTime(iso);
  if (at === undefined) return undefined;
  return compactSpan(now - at);
}

/** How long a span that began at a timestamp has run, in the same compact form. */
export function compactElapsedSince(iso: string | undefined, now: number = Date.now()): string | undefined {
  const at = parseTime(iso);
  if (at === undefined) return undefined;
  return compactSpan(now - at);
}

/** A timestamp that parses, or undefined for absent, empty and unparseable values. */
export function parseTime(iso: string | undefined): number | undefined {
  if (iso === undefined || iso === "") return undefined;
  const at = Date.parse(iso);
  return Number.isFinite(at) ? at : undefined;
}
