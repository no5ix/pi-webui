import { describe, expect, it } from "vitest";
import { compactAge, compactElapsedSince, compactSpan, parseTime } from "./compactSpan.js";

const NOW = Date.parse("2026-04-15T12:00:00.000Z");
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

describe("compact spans", () => {
  it("keeps the seconds under a minute, because that is where the information is", () => {
    expect(compactSpan(9_000)).toBe("9s");
    expect(compactSpan(45_400)).toBe("45s");
    expect(compactSpan(0)).toBe("0s");
    expect(compactSpan(-5_000)).toBe("0s");
  });

  it("drops the remainder above a minute, so a column of ages stays narrow", () => {
    expect(compactSpan(7 * 60_000 + 24_000)).toBe("7m");
    expect(compactSpan(3 * 3_600_000)).toBe("3h");
    expect(compactSpan(2 * 86_400_000 + 3_600_000)).toBe("2d");
  });

  it("says nothing about a time the listing did not carry, rather than a zero", () => {
    expect(compactAge(undefined, NOW)).toBeUndefined();
    expect(compactAge("", NOW)).toBeUndefined();
    expect(compactAge("not a time", NOW)).toBeUndefined();
    expect(parseTime("nope")).toBeUndefined();
  });

  it("measures an age and an elapsed span the same way", () => {
    expect(compactAge(iso(5 * 60_000), NOW)).toBe("5m");
    expect(compactElapsedSince(iso(5 * 60_000), NOW)).toBe("5m");
  });
});
