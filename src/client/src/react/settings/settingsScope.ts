/**
 * The scope a Settings read belongs to, and the bookkeeping that answers it.
 *
 * Every Settings page answers from one machine, and the Skills and MCP pages from one project on that
 * machine, so a read's answer has to carry the scope it was read for: an answer about another machine
 * or another project is not an answer here, and the page says "not read yet" instead of showing it
 * under a heading that names a scope it does not belong to.
 *
 * The key is derived in exactly one place, from React state, so the render and the reader cannot
 * disagree about which scope is on screen. The reads check the key again when their answers arrive, so
 * a slow answer about a scope that has left the screen is dropped.
 */

export interface SettingsScope {
  readonly machineId: string;
  readonly projectId: string | undefined;
}

export function settingsScopeKey(scope: SettingsScope): string {
  return JSON.stringify([scope.machineId, scope.projectId]);
}

/** The resources one Settings read answers for; every page takes its rows from exactly one of them. */
export const SETTINGS_RESOURCES = ["config", "plugins", "packages", "skills", "mcp"] as const;

/**
 * One read's answers, for one scope.
 *
 * A read is over when every resource has answered, successfully or not: a page stops loading on an
 * answer that named a failure and never on an answer that did not arrive. The ledger belongs to the
 * newest read for a scope, so answers from a superseded read are dropped. A resource whose request
 * could not even start is answered too — a barrier that waits for a request that was never made holds
 * the page at "loading" forever, which is how a whole Settings page goes blind.
 */
export interface SettingsReadLedger {
  readonly scopeKey: string;
  readonly requestId: number;
  readonly pending: number;
}

export function beginSettingsRead(scopeKey: string, requestId: number): SettingsReadLedger {
  return { scopeKey, requestId, pending: SETTINGS_RESOURCES.length };
}

/** Whether an answer belongs to the read the page is waiting for. */
export function isCurrentSettingsAnswer(ledger: SettingsReadLedger, scopeKey: string, requestId: number): boolean {
  return ledger.scopeKey === scopeKey && ledger.requestId === requestId;
}

/**
 * Records one resource's answer.
 *
 * Returns the ledger unchanged when the answer belongs to a superseded read, so a late answer can
 * never finish a read it is not part of.
 */
export function settleSettingsResource(ledger: SettingsReadLedger, scopeKey: string, requestId: number): SettingsReadLedger {
  if (!isCurrentSettingsAnswer(ledger, scopeKey, requestId)) return ledger;
  return { ...ledger, pending: Math.max(0, ledger.pending - 1) };
}

/** Failures of one scope accumulate: the page reports every read that answered badly, not just the last. */
export function appendSettingsFailure(current: string | undefined, failure: string | undefined): string | undefined {
  if (failure === undefined) return current;
  if (current === undefined) return failure;
  return `${current}\n${failure}`;
}
