import type { Deadlines } from "./domain/deadlines";

/**
 * This server instance's copy of the club's deadlines (§NNN), apart from `deadlines.ts` so the
 * test helpers can drop it between tests without importing the database or `next/cache`.
 *
 * How long a copy is kept: a minute. A save is on the page that made it at once (the panel reads
 * straight through, and the save drops this copy), and on every other instance within the minute.
 * What that minute can cost is spelled out in §NNN: a hold or an offer created in it gets the
 * previous length — which is still a length the club chose, never an existing deadline rewritten.
 * Wall-clock time, not a caller's `now`: this is about round trips, not about the domain's clock.
 */
const MEMO_MS = 60_000;
let memo: { at: number; deadlines: Deadlines } | null = null;

export function memoizedDeadlines(): Deadlines | null {
  return memo && Date.now() - memo.at < MEMO_MS ? memo.deadlines : null;
}

export function rememberDeadlines(deadlines: Deadlines): void {
  memo = { at: Date.now(), deadlines };
}

/** Dropped on a save, and between tests that reset the database (`tests/helpers/db.ts`). */
export function forgetCachedDeadlines(): void {
  memo = null;
}
