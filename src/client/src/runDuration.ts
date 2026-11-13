/**
 * The words a span of work is shown in, shared with the server.
 *
 * The formatting lives in `shared/duration` because the session daemon writes the text of an ntfy
 * notice for the same span, and the two surfaces must not say `1h 5m` and `1h 05m` about one task.
 * This module keeps the client's import path.
 */
export { runDuration } from "../../shared/duration";
