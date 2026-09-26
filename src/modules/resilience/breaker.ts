import { isDatabaseAwayError } from "./domain/database-away";

/**
 * No storms (§NNN): once a public read has found the database away, this instance stops asking it
 * for a while and every public read goes straight to its last good copy.
 *
 * Without it an outage costs every page view a failed connection — each one up to the driver's
 * wait, several per page (the listing, the header, the free places) — and a suspended project met
 * by a crawler is hundreds of refused connections a minute for nothing. With it the first read
 * that fails opens the breaker for `BREAKER_FIRST_MS`, each failure after a retry doubles it up to
 * `BREAKER_MAX_MS`, and the first read that succeeds closes it. A retry is simply the first read
 * after the breaker's time is up: one request pays for the question, the rest are served the copy.
 *
 * Per instance, in memory, on purpose. It needs no store — a store is one more thing that may be
 * away — and a serverless instance that starts cold starts closed, so the worst case of losing it
 * is one failed connection per new instance, which is what every request paid before. Only the
 * public cache's reads consult it (`public-cache/cache.ts`); a decision — a registration, a token,
 * the backoffice — always asks the database itself and fails honestly.
 */

export const BREAKER_FIRST_MS = 15_000;
export const BREAKER_MAX_MS = 5 * 60_000;

/** Thrown instead of asking a database this instance already knows is away. Its message is one `isDatabaseAwayError` reads as away. */
/**
 * Its `cause` is the failure that opened the breaker, so a reader that asks *why* the database is
 * away — Neon's quota refusal (`isQuotaRefusalError`) or an ordinary outage — gets the same answer
 * from the skipped reads as from the one that failed.
 */
export class DatabaseRestingError extends Error {
  constructor(cause?: unknown) {
    super("the database is resting; the breaker is open (§NNN)", cause === undefined ? undefined : { cause });
    this.name = "DatabaseRestingError";
  }
}

/**
 * Thrown by a public read that missed the data cache while the month's budget is red (§NNN,
 * `GOVERNOR_EFFECTS.publicMissRefreshMinutes`): the database was deliberately not asked, and no
 * last good copy stood behind the read. A `DatabaseRestingError`, so every reader that already
 * knows what to do when the database is away — serve a copy, drop an optional part of the page —
 * does it, and `readWithLastGood` sends the reader to the short resting page when it has no copy
 * either. Nothing failed, so nothing is logged.
 */
export class ColdMissError extends DatabaseRestingError {
  constructor() {
    super();
    this.message = "the database is resting; a red month answers a cache miss without it (§NNN)";
    this.name = "ColdMissError";
  }
}

/** Whether this is a red month's cache miss, on the error or anywhere in its causes. */
export function isColdMiss(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    if (current instanceof ColdMissError || (current as { name?: unknown }).name === "ColdMissError") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

const state: { openUntil: number; failures: number; lastError: unknown } = { openUntil: 0, failures: 0, lastError: undefined };

/** Whether this instance should skip the database for now. */
export function breakerOpen(now: number = Date.now()): boolean {
  return now < state.openUntil;
}

/** A read failed: if it is the database being away, open the breaker for longer each time. Returns whether it was. */
export function noteReadFailure(error: unknown, now: number = Date.now()): boolean {
  if (!isDatabaseAwayError(error)) return false;
  state.lastError = error;
  if (now >= state.openUntil) {
    state.failures += 1;
    state.openUntil = now + Math.min(BREAKER_FIRST_MS * 2 ** (state.failures - 1), BREAKER_MAX_MS);
  }
  return true;
}

/** A read reached the database: close the breaker. */
export function noteReadSuccess(): void {
  state.failures = 0;
  state.openUntil = 0;
  state.lastError = undefined;
}

/**
 * One public read behind the breaker: skipped with `DatabaseRestingError` while it is open, and
 * noted either way when it runs.
 */
export async function throughBreaker<T>(load: () => Promise<T>, now: () => number = Date.now): Promise<T> {
  if (breakerOpen(now())) throw new DatabaseRestingError(state.lastError);
  try {
    const value = await load();
    noteReadSuccess();
    return value;
  } catch (error) {
    noteReadFailure(error, now());
    throw error;
  }
}

/** For the tests. */
export function resetBreaker(): void {
  noteReadSuccess();
}
