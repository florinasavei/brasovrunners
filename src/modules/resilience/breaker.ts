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
export class DatabaseRestingError extends Error {
  constructor() {
    super("the database is resting; the breaker is open (§NNN)");
    this.name = "DatabaseRestingError";
  }
}

const state = { openUntil: 0, failures: 0 };

/** Whether this instance should skip the database for now. */
export function breakerOpen(now: number = Date.now()): boolean {
  return now < state.openUntil;
}

/** A read failed: if it is the database being away, open the breaker for longer each time. Returns whether it was. */
export function noteReadFailure(error: unknown, now: number = Date.now()): boolean {
  if (!isDatabaseAwayError(error)) return false;
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
}

/**
 * One public read behind the breaker: skipped with `DatabaseRestingError` while it is open, and
 * noted either way when it runs.
 */
export async function throughBreaker<T>(load: () => Promise<T>, now: () => number = Date.now): Promise<T> {
  if (breakerOpen(now())) throw new DatabaseRestingError();
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
