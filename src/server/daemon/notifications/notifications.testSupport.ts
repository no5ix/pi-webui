import { isRecord } from "../../../shared/unknownValues.js";

/**
 * Reading the answers of the push routes and the notification service in a test.
 *
 * A response is JSON that arrived over a transport, so a test reads it through these: an answer that
 * is not the object the route promises fails with what actually arrived, and a field a test needs
 * reports that it is missing rather than comparing against `undefined`, which is how a test passes
 * while asserting nothing.
 */
export function answered(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    const arrived = typeof value === "string" ? value : JSON.stringify(value);
    throw new Error(`${label} answered with ${arrived}, not an object`);
  }
  return value;
}

/** A value a test needs to exist. */
export function present<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`${label} is missing`);
  return value;
}

/** The entries of a JSON list, every one an object. A value that is not a list, or holds a non-object, fails the test. */
export function entriesOf(value: readonly unknown[], label: string): Record<string, unknown>[] {
  const entries: Record<string, unknown>[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) throw new Error(`${label} holds ${JSON.stringify(entry)}, not an object`);
    entries.push(entry);
  }
  return entries;
}

/** The notification a push payload carries, as the object the Web Push contract defines. */
export function noticeOf(payload: unknown, label: string): Record<string, unknown> {
  return answered(answered(payload, label)["notification"], `${label} notification`);
}
