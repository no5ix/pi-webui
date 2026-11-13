/**
 * A span of work in the words a reader uses: `48s`, `1m 5s`, `1h 5m`.
 *
 * The activity dock, the line at the bottom of the window, and the notice a finished task posts all
 * say the same number, so they say it the same way. It lives in the shared layer because the words a
 * notification is written with are built in the shared layer too: the session daemon and the browser
 * page report one task's span to one notification centre, and two formatters would be two numbers.
 */
export function runDuration(elapsedMs: number): string {
  const seconds = Math.max(0, Math.round(elapsedMs / 1000));
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m ${String(seconds % 60)}s`;
  return `${String(Math.floor(minutes / 60))}h ${String(minutes % 60)}m`;
}
