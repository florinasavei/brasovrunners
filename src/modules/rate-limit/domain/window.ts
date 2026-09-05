/**
 * Fixed-window arithmetic for the throttle (AGENTS.md §19.4).
 *
 * Pure, and takes `now` as an argument rather than reading the clock — §1.5 requires that of
 * every time-dependent rule, and a window boundary is exactly the kind of thing that is wrong
 * only at the boundary.
 *
 * Fixed windows rather than a sliding log: a sliding window needs one row per event, and this
 * needs one row per (scope, key, window) with a counter on it. The known trade is a burst
 * across a boundary — five at 10:59 and five at 11:01 passes a limit of five per hour. That is
 * acceptable for what this defends: somebody hammering a form or a mailbox, not an attacker
 * optimising against the window. Say so rather than discover it later.
 */

/** The start of the window `now` falls in, for a window of the given width. */
export function windowStart(now: Date, windowMs: number): Date {
  if (windowMs <= 0) throw new RangeError("a rate-limit window must be a positive duration");
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs);
}

/**
 * How long until the current window ends, in whole seconds, never below one.
 *
 * Whole seconds because that is what a `Retry-After` header and a human-readable message both
 * want; never zero because "try again in 0 seconds" reads as a bug and invites an immediate
 * retry that fails again.
 */
export function retryAfterSeconds(now: Date, windowMs: number): number {
  const elapsed = now.getTime() - windowStart(now, windowMs).getTime();
  return Math.max(1, Math.ceil((windowMs - elapsed) / 1000));
}
