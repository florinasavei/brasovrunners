/**
 * The clock, as part of a cache key (`DECISIONS.md` §NNN).
 *
 * Some public reads compare against `now` in SQL: an event is upcoming while it has not ended, a
 * legal version is in force from its effective date, a waiting-list offer holds a place until it
 * lapses. Their answer changes with nothing written — only with time passing one of a known set
 * of instants. Between two of those instants the answer cannot change, so the stretch of time
 * `now` falls in is a correct cache key, and the next instant is a fine name for it.
 *
 * The instants are read (and cached) separately, because they depend on the rows alone and not
 * on the clock. That is what makes the scheme exact rather than approximately fresh: a cached
 * answer is only ever served for a `now` it was true for.
 *
 * ## "passed" and "reached"
 *
 * Which side of an instant the change falls on decides which stretch a moment belongs to, and the
 * two SQL comparisons in use fall on different sides:
 *
 * - `passed` — the answer changes once `now` is **after** the instant. `coalesce(ends_at,
 *   starts_at) >= now` is still upcoming at the very millisecond it ends.
 * - `reached` — the answer changes once `now` **is** the instant. `effective_at <= now` is in
 *   force at its effective millisecond; `hold_expires_at > now` stops holding at it.
 *
 * Getting that backwards would file the answer computed at the boundary millisecond under the
 * stretch that follows it — a one-in-a-trillion request, and a page wrong until the next write.
 */

export type ChangesWhen = "passed" | "reached";

/**
 * The name of the stretch of time `now` is in: the first instant the answer will change at, or
 * `"after-last"` when no instant is ahead and nothing but a write can change it.
 */
export function clockWindow(instants: readonly Date[], now: Date, changes: ChangesWhen): string {
  const at = now.getTime();
  let next: number | null = null;
  for (const instant of instants) {
    const time = instant.getTime();
    if (Number.isNaN(time)) continue;
    const ahead = changes === "passed" ? time >= at : time > at;
    if (ahead && (next === null || time < next)) next = time;
  }
  return next === null ? "after-last" : new Date(next).toISOString();
}
