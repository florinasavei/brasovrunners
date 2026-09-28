/**
 * Fixed-window arithmetic for the throttle (AGENTS.md §19.4); `now` is injected (§1.5).
 *
 * Fixed windows need one counter row per (scope, key, window) instead of one row per event. The
 * known trade: a burst across a boundary (five at 10:59, five at 11:01) passes a limit of five
 * per hour — acceptable against form or mailbox flooding.
 */

/** The start of the window `now` falls in, for a window of the given width. */
export function windowStart(now: Date, windowMs: number): Date {
  if (windowMs <= 0) throw new RangeError("a rate-limit window must be a positive duration");
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs);
}

/**
 * Whole seconds until the window ends (for `Retry-After`), never below one: "try again in 0
 * seconds" invites a retry that fails.
 */
export function retryAfterSeconds(now: Date, windowMs: number): number {
  const elapsed = now.getTime() - windowStart(now, windowMs).getTime();
  return Math.max(1, Math.ceil((windowMs - elapsed) / 1000));
}
