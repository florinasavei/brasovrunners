import { and, count, eq, gt, inArray, sql } from "drizzle-orm";
import { events } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import type { Database } from "@/db/types";
import { ACTIVE_STATUSES } from "./domain/state-machine";

/**
 * How many people are signed up, for the badge on the backoffice's "Înscrieri" tab
 * (`DECISIONS.md` §255; the owner: "can I see a counter of registered people here? but DB
 * efficiently! please note we use a light DB").
 *
 * ## What it counts
 *
 * Active registrations — someone waiting for their email, waiting to sign, offered a place,
 * on the waiting list or confirmed — of **real** people, on events that have not started. That
 * is the number "how many are signed up" means to a club: cancellations are gone, last month's
 * race is history, and a synthetic runner is never inside a number the club is given (§12.6).
 *
 * ## Why it is cheap enough to sit on every backoffice page
 *
 * The badge renders in the shell, so a naive read would be one query per page view. Two things
 * keep it to about one query a minute per instance:
 *
 * - **A memo with a minute's life.** The number moves when somebody registers, and a minute of
 *   staleness on a badge is invisible; the list itself is always exact.
 * - **One indexed count.** A join on `event_id` — the index the queue's own reads use — with a
 *   date bound on a table that holds a few dozen events. There is no `GROUP BY`, no sort and no
 *   row returned: PostgreSQL answers it from the index.
 *
 * Neon's free plan bills compute time (§68), which is why this is a memo rather than a
 * `force-dynamic` read: the difference over an evening of backoffice work is a few hundred
 * queries against a handful.
 */
export async function countRegisteredForUpcoming<T extends Record<string, unknown>>(
  db: Database<T>,
  now: Date,
): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(registrations)
    .innerJoin(events, eq(events.id, registrations.eventId))
    .where(
      and(
        gt(events.startsAt, now),
        sql`${events.eventStatus} <> 'CANCELLED'`,
        eq(registrations.kind, "REAL"),
        inArray(registrations.status, [...ACTIVE_STATUSES]),
      ),
    );
  return row?.value ?? 0;
}

/** A minute: long enough to cost nothing, short enough that nobody notices it is a memo. */
const CACHE_MS = 60_000;
let cached: { at: number; value: number } | null = null;

/**
 * The badge's number, memoized — and `null` rather than a throw when the database is away.
 *
 * The shell renders on every backoffice page, including the ones whose whole purpose is to
 * work when something is broken (`/admin/tasks`, `/devs`). A badge is not worth a 500, so a
 * failure means "no badge" and the page renders exactly as it did before this existed.
 */
export async function registeredBadgeCount<T extends Record<string, unknown>>(
  db: Database<T>,
  now: Date,
): Promise<number | null> {
  if (cached && now.getTime() - cached.at < CACHE_MS) return cached.value;
  try {
    const value = await countRegisteredForUpcoming(db, now);
    cached = { at: now.getTime(), value };
    return value;
  } catch {
    return null;
  }
}

/** Dropped when a registration is created or cancelled, so the badge does not lag a minute. */
export function forgetRegisteredBadgeCount(): void {
  cached = null;
}
