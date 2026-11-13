/**
 * The page's view of the shared duration formatter.
 *
 * The implementation lives in the shared layer (`shared/runDuration.ts`) because the session daemon
 * writes the same number into a push notification, and two formatters would be two numbers about one
 * task. This module keeps the import path the components and the notification code already use.
 */
export { runDuration } from "../../shared/runDuration";
