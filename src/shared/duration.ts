/**
 * A span of work in the words a reader uses: `45s`, `7m 5s`, `2h 0m`.
 *
 * The activity dock, the line at the bottom of the window, and the notice a finished task posts - in
 * the browser and on ntfy - say the same number, so they say it the same way. It lives in `shared/`
 * because the session daemon writes ntfy's text and has no business importing a browser component, and
 * a browser component has no business owning the words a service-worker message uses.
 */
export function runDuration(elapsedMs: number): string {
  const seconds = Math.max(0, Math.round(elapsedMs / 1000));
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m ${String(seconds % 60)}s`;
  return `${String(Math.floor(minutes / 60))}h ${String(minutes % 60)}m`;
}
