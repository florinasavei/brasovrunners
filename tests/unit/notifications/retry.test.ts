import { describe, expect, it } from "vitest";
import {
  FIRST_RETRY_DELAY_MS,
  MAX_RETRY_DELAY_MS,
  MAX_SEND_ATTEMPTS,
  nextAttemptAt,
  nextAttemptDelayMs,
  sanitizeProviderError,
} from "@/modules/notifications/domain/retry";

/**
 * BR-REQ-080-02 criterion 2 — bounded backoff up to a maximum attempt count.
 *
 * The integration test proves the outbox applies this schedule; here it is asserted as a
 * table, because "bounded" is a claim about every input rather than about the two the outbox
 * test happens to exercise.
 */
describe("BR-REQ-080-02 retry schedule", () => {
  it("doubles from one minute", () => {
    expect(nextAttemptDelayMs(1)).toBe(60_000);
    expect(nextAttemptDelayMs(2)).toBe(120_000);
    expect(nextAttemptDelayMs(3)).toBe(240_000);
    expect(nextAttemptDelayMs(4)).toBe(480_000);
    expect(nextAttemptDelayMs(5)).toBe(960_000);
    expect(nextAttemptDelayMs(6)).toBe(1_920_000);
  });

  it("is bounded — no delay exceeds the ceiling, however many attempts have failed", () => {
    for (const attempt of [7, 8, 20, 100, 1000]) {
      expect(nextAttemptDelayMs(attempt)).toBe(MAX_RETRY_DELAY_MS);
    }
  });

  it("never returns a delay shorter than the first one", () => {
    for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt += 1) {
      expect(nextAttemptDelayMs(attempt)).toBeGreaterThanOrEqual(FIRST_RETRY_DELAY_MS);
    }
  });

  it("refuses an attempt count below one, which would mean scheduling a retry before a try", () => {
    expect(() => nextAttemptDelayMs(0)).toThrow();
    expect(() => nextAttemptDelayMs(-1)).toThrow();
  });

  it("adds the delay to the injected clock rather than to the wall clock", () => {
    const now = new Date("2026-09-03T10:00:00.000Z");

    expect(nextAttemptAt(now, 1)).toEqual(new Date("2026-09-03T10:01:00.000Z"));
    expect(nextAttemptAt(now, 3)).toEqual(new Date("2026-09-03T10:04:00.000Z"));
  });
});

/**
 * AGENTS.md §14.5 and §16.1: `last_error` is stored, exported and read in the backoffice, so
 * it must never carry a token, a body, or an unbounded provider dump.
 */
describe("BR-REQ-080-02 provider errors are sanitized before they are stored", () => {
  it("redacts anything long enough to be an action token", () => {
    const secret = "hQ2v_xR8tL-3mZpK9wFj0aBcDeFgHiJkLmNoPqRsTuV";
    const sanitized = sanitizeProviderError(
      new Error(`rejected body containing https://example.test/ro/t/${secret}`),
    );

    expect(sanitized).not.toContain(secret);
    expect(sanitized).toContain("[redacted]");
  });

  it("redacts a stored hash just as readily", () => {
    const hash = "a".repeat(64);

    expect(sanitizeProviderError(`duplicate ${hash}`)).not.toContain(hash);
  });

  it("keeps a short provider reason readable", () => {
    expect(sanitizeProviderError(new Error("550 5.1.1 mailbox unavailable"))).toBe(
      "550 5.1.1 mailbox unavailable",
    );
  });

  it("collapses whitespace, because a stack-shaped error is unreadable in a table cell", () => {
    expect(sanitizeProviderError("timed out\n  after\n  30s")).toBe("timed out after 30s");
  });

  it("truncates an unbounded provider dump", () => {
    const sanitized = sanitizeProviderError("x ".repeat(2000));

    expect(sanitized.length).toBeLessThanOrEqual(500);
  });

  it("describes a thrown value that is not an error at all", () => {
    expect(sanitizeProviderError(undefined)).toBe("unknown error");
    expect(sanitizeProviderError({ status: 500 })).toBe("unknown error");
  });
});
