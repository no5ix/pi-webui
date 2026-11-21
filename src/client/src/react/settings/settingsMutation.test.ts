import { describe, expect, it, vi } from "vitest";
import { isMutationDeadline, MUTATION_DEADLINE_MS, mutationDeadlineNotice, MutationDeadlineReached, runWithinDeadline } from "./settingsMutation";

/**
 * The bound belongs to the page's lock.
 *
 * The Settings shell disables its panels while a mutation runs, so a request that never answers leaves
 * every control on the page unpressable, forever, with no sentence saying so. The shell runs each
 * request through the bound, which is the only way the lock can be released by the page that set it.
 * The request is not cancelled: a write already sent may land, so the sentence the page gives has to
 * name that, and the reader's way to learn the truth is the machine's own answer.
 */
describe("settings mutation bound", () => {
  it("hands back a request that answers inside the bound, untouched", async () => {
    await expect(runWithinDeadline(Promise.resolve("answered"), 1_000)).resolves.toBe("answered");
  });

  it("passes a request's own failure through unchanged", async () => {
    await expect(runWithinDeadline(Promise.reject(new Error("pi said no")), 1_000)).rejects.toThrow("pi said no");
  });

  it("answers at the bound when the request never does", async () => {
    vi.useFakeTimers();
    const settled: string[] = [];
    const bounded = runWithinDeadline(new Promise<string>(() => undefined), MUTATION_DEADLINE_MS).then(
      () => settled.push("resolved"),
      (failure: unknown) => settled.push(isMutationDeadline(failure) ? "deadline" : "other"),
    );
    await vi.advanceTimersByTimeAsync(MUTATION_DEADLINE_MS - 1);
    expect(settled).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await bounded;
    expect(settled).toEqual(["deadline"]);
    vi.useRealTimers();
  });

  it("says the controls work again and that a change may have landed", () => {
    const notice = mutationDeadlineNotice(MUTATION_DEADLINE_MS);
    expect(notice).toContain("did not answer within 20 seconds");
    expect(notice).toContain("the controls work again");
    expect(notice).toContain("may have landed");
    expect(new MutationDeadlineReached().message).toContain("20 seconds");
  });
});
