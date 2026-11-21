/**
 * The bound every Settings mutation runs against.
 *
 * The Settings shell locks its panels while a mutation runs, and a mutation can reach outside the
 * machine: a connection test starts a server process and waits for a handshake, a package operation
 * runs pi's own installer, a config write goes through the machine's file layer. A request that never
 * answers used to keep the shell's busy flag set forever, and every panel on the page inherits that
 * lock - so one hung server took the whole Settings page's controls with it, with no stated deadline,
 * no way to press anything again, and no sentence saying what the page had given up on.
 *
 * The bound belongs to the owner of the lock, because a deadline a bystander knows about does not
 * release it. The shell runs every panel's request through `runWithinDeadline`, so the lock is dropped
 * when the bound passes and the page says so; a panel that knows what its action means - a connection
 * test changes nothing, a write may have landed anyway - adds its own sentence over the same bound.
 */
export const MUTATION_DEADLINE_MS = 20_000;

/** The machine did not answer within the page's bound. */
export class MutationDeadlineReached extends Error {
  readonly deadlineMs: number;

  constructor(deadlineMs: number = MUTATION_DEADLINE_MS) {
    super(`The machine did not answer within ${String(Math.round(deadlineMs / 1000))} seconds.`);
    this.name = "MutationDeadlineReached";
    this.deadlineMs = deadlineMs;
  }
}

export function isMutationDeadline(value: unknown): value is MutationDeadlineReached {
  return value instanceof MutationDeadlineReached;
}

/**
 * The promise, answered by the bound at the latest.
 *
 * A request that keeps running after the bound is not cancelled - a write already in flight can still
 * land on disk - which is why the page's sentence names what it can claim: the machine did not answer,
 * and the reader has to look at the machine's answer (Reload) to learn what actually happened.
 */
export function runWithinDeadline<T>(request: Promise<T>, deadlineMs: number = MUTATION_DEADLINE_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => { reject(new MutationDeadlineReached(deadlineMs)); }, deadlineMs);
    request.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (failure: unknown) => {
        clearTimeout(timer);
        reject(failure instanceof Error ? failure : new Error(String(failure)));
      },
    );
  });
}

/** What the shell says when a mutation passed the bound, for a caller that knows nothing about it. */
export function mutationDeadlineNotice(deadlineMs: number = MUTATION_DEADLINE_MS): string {
  return `The machine did not answer within ${String(Math.round(deadlineMs / 1000))} seconds, so the page stopped waiting and the controls work again. Reload reads the machine's answer, because a change already sent may have landed.`;
}
