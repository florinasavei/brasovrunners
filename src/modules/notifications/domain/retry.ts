/**
 * Retry timing and error sanitization for the outbox (AGENTS.md §16.1; BR-REQ-080-02 c2).
 *
 * Pure, so the schedule can be read as a table and asserted without waiting for it.
 */

/**
 * After this many attempts a message is FAILED and the worker stops.
 *
 * Six attempts spread over the schedule below is a little under two hours of trying. The
 * ceiling exists because an unbounded retry against a provider that is rejecting messages is
 * how a sending domain's reputation is spent, and because a message nobody has managed to
 * deliver in two hours needs a human, not a seventh attempt. The registration itself is
 * unaffected either way: the database is authoritative when Mailgun fails (§16.1).
 */
export const MAX_SEND_ATTEMPTS = 6;

/** First retry one minute later; the delay doubles from there. */
export const FIRST_RETRY_DELAY_MS = 60_000;

/** No wait is longer than an hour, so a provider that recovers is noticed within one. */
export const MAX_RETRY_DELAY_MS = 3_600_000;

/**
 * When to try again after `attemptCount` failed attempts.
 *
 *   1 → 1 min   2 → 2 min   3 → 4 min   4 → 8 min   5 → 16 min   6 → 32 min
 *
 * Bounded exponential, no jitter. Jitter exists to stop a thundering herd of clients
 * retrying in lockstep; here a single worker processes a small batch of rows whose attempt
 * counts already differ, so it would add a random number to an assertion for no benefit.
 */
export function nextAttemptDelayMs(attemptCount: number): number {
  if (attemptCount < 1) throw new Error("attemptCount must be at least 1");
  const exponential = FIRST_RETRY_DELAY_MS * 2 ** (attemptCount - 1);
  return Math.min(exponential, MAX_RETRY_DELAY_MS);
}

export function nextAttemptAt(now: Date, attemptCount: number): Date {
  return new Date(now.getTime() + nextAttemptDelayMs(attemptCount));
}

/**
 * How long a claimed row may stay PROCESSING before another worker may take it back.
 *
 * A worker that is killed between claiming a row and recording the outcome — a deploy, an
 * out-of-memory kill, a serverless function hitting its ceiling — leaves the row claimed
 * forever, and a confirmation email that never arrives is indistinguishable from one that was
 * never queued. Five minutes is far longer than any send takes and short enough that a
 * participant is still on the page wondering.
 *
 * This is the at-least-once boundary §16.1 names: if the crash happened *after* the provider
 * accepted the message, reclaiming sends it twice. Twice is recoverable; never is not.
 */
export const PROCESSING_LOCK_TIMEOUT_MS = 300_000;

/** `email_outbox.last_error` is a column a person reads in the backoffice; keep it short. */
const MAX_ERROR_LENGTH = 500;

/**
 * Anything that looks like a secret, redacted.
 *
 * Provider errors quote what was submitted, and what was submitted contains an action link.
 * A 43-character base64url run is exactly a token secret; 32 is the shortest run worth
 * treating as one. `AGENTS.md` §14.5 forbids a raw action token in logs and errors, and
 * `last_error` is stored, exported and read over shoulders.
 *
 * The pattern is deliberately eager. Redacting a long opaque provider id costs a support
 * engineer one lookup; keeping a live token in a database column costs a registration.
 */
const SECRET_LIKE = /[A-Za-z0-9_-]{32,}/g;

export function sanitizeProviderError(error: unknown): string {
  const raw =
    error instanceof Error ? error.message : typeof error === "string" ? error : "unknown error";

  return raw
    .replace(SECRET_LIKE, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_ERROR_LENGTH);
}
