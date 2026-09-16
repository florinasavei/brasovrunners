import { describe, expect, it } from "vitest";
import { retryAfterSeconds, windowStart } from "@/modules/rate-limit/domain/window";

/**
 * AGENTS.md §19.4 — the fixed-window arithmetic behind the throttle.
 *
 * Boundaries are the only interesting part of a fixed window, and they are where an off-by-one
 * either lets a burst through or tells somebody to wait an hour when the window resets in a
 * second.
 */
const HOUR = 60 * 60_000;

describe("§19.4 window boundaries", () => {
  it("truncates to the start of the window the moment falls in", () => {
    expect(windowStart(new Date("2026-09-05T10:31:42.500Z"), HOUR).toISOString()).toBe(
      "2026-09-05T10:00:00.000Z",
    );
  });

  it("puts the first instant of a window in that window, not the previous one", () => {
    const start = new Date("2026-09-05T11:00:00.000Z");
    expect(windowStart(start, HOUR).toISOString()).toBe("2026-09-05T11:00:00.000Z");
    // And the last millisecond before it belongs to the one before.
    expect(windowStart(new Date(start.getTime() - 1), HOUR).toISOString()).toBe(
      "2026-09-05T10:00:00.000Z",
    );
  });

  it("refuses a window with no duration rather than dividing by zero", () => {
    expect(() => windowStart(new Date(), 0)).toThrow(RangeError);
  });
});

describe("§19.4 when to try again", () => {
  it("counts the whole seconds left in the current window", () => {
    // 10:31:42.5 into an hourly window: 28 minutes 17.5 seconds remain, rounded up.
    expect(retryAfterSeconds(new Date("2026-09-05T10:31:42.500Z"), HOUR)).toBe(28 * 60 + 18);
  });

  it("never says zero, because that reads as a bug and invites an instant retry", () => {
    const lastMillisecond = new Date("2026-09-05T10:59:59.999Z");
    expect(retryAfterSeconds(lastMillisecond, HOUR)).toBe(1);
  });

  it("gives the whole window at its first instant", () => {
    expect(retryAfterSeconds(new Date("2026-09-05T11:00:00.000Z"), HOUR)).toBe(3600);
  });
});
