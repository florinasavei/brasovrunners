import { and, asc, count, eq, gt, inArray, sql } from "drizzle-orm";
import { events, eventTranslations } from "@/db/schema/events";
import type { Locale } from "@/i18n/routing";
import { registrations } from "@/db/schema/registrations";
import type { Database } from "@/db/types";
import { ACTIVE_STATUSES } from "./domain/state-machine";
import { familyReservationHolds, offerAwaitingItsFirstEmail } from "./repository";

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

/** Dropped when a registration is created or cancelled, so the badge does not lag a minute. */
export function forgetRegisteredBadgeCount(): void {
  cachedBreakdown.clear();
}

/**
 * One upcoming event's share of the badge: its title in the reader's language, how many people
 * have an active registration, and who among them holds a place (§255, amended by §NNN). `count` is always `withPlace + awaitingEmail + waitlisted`.
 *
 * `withPlace` is what the allocator's `computeOccupied` counts for the event's registrations: CONFIRMED,
 * PENDING_DECLARATION, a WAITLIST_OFFERED that has not lapsed, and a family's reservation (§543), which is
 * a PENDING_EMAIL_CONFIRMATION row with an unexpired `hold_expires_at`. `awaitingEmail` is every other
 * PENDING_EMAIL_CONFIRMATION row. `waitlisted` is WAITLISTED, plus an offer that has lapsed and not yet been
 * swept: it holds no place and is going back to the list. Only `family_place_holds` rows, which carry no
 * person, are in no part. `capacity` is `null` for an
 * event without a limit.
 */
export type RegisteredOnEvent = {
  eventId: string;
  title: string;
  count: number;
  withPlace: number;
  awaitingEmail: number;
  waitlisted: number;
  capacity: number | null;
};

/**
 * The bucket a row falls in, by the allocator's own predicates (`computeOccupied`'s), so «cu loc» is the
 * allocator's count of people and never a guess from the status alone.
 */
function badgeBucket(now: Date) {
  return sql<"place" | "awaitingEmail" | "waitlisted">`case
    when ${registrations.status} in ('CONFIRMED', 'PENDING_DECLARATION')
      or (${registrations.status} = 'WAITLIST_OFFERED' and (${registrations.holdExpiresAt} > ${now} or ${offerAwaitingItsFirstEmail(now)}))
      or ${familyReservationHolds(now)} then 'place'
    when ${registrations.status} = 'PENDING_EMAIL_CONFIRMATION' then 'awaitingEmail'
    else 'waitlisted' end`;
}

/**
 * The badge's figure split per event (§476): the same filter as `countRegisteredForUpcoming`,
 * grouped by event **and bucket** (`badgeBucket`) — a handful of rows for a few dozen events, still one indexed
 * query — so the tab's tooltip says what the number is made of: people with a place, people
 * awaiting their email, people on the waiting list. The total is the sum of the split.
 *
 * The title is the reader's own language's; an event with no translation in it shows a dash,
 * never the other language's title.
 */
export async function countRegisteredPerUpcomingEvent<T extends Record<string, unknown>>(
  db: Database<T>,
  now: Date,
  locale: Locale,
): Promise<RegisteredOnEvent[]> {
  const bucket = badgeBucket(now);
  const rows = await db
    .select({
      eventId: events.id,
      title: eventTranslations.title,
      capacity: events.capacity,
      // Must stay the FOURTH field: the GROUP BY below names it by position (`4`), because the bound `now`s of its expression cannot be repeated in a GROUP BY.
      bucket,
      value: count(),
    })
    .from(registrations)
    .innerJoin(events, eq(events.id, registrations.eventId))
    .leftJoin(eventTranslations, and(eq(eventTranslations.eventId, events.id), eq(eventTranslations.locale, locale)))
    .where(
      and(
        gt(events.startsAt, now),
        sql`${events.eventStatus} <> 'CANCELLED'`,
        eq(registrations.kind, "REAL"),
        inArray(registrations.status, [...ACTIVE_STATUSES]),
      ),
    )
    .groupBy(events.id, events.startsAt, events.capacity, eventTranslations.title, sql`4`) // the bucket, by position: its bound `now`s cannot be repeated in a GROUP BY expression
    .orderBy(asc(events.startsAt));
  const perEvent = new Map<string, RegisteredOnEvent>();
  for (const row of rows) {
    const entry =
      perEvent.get(row.eventId) ??
      { eventId: row.eventId, title: row.title ?? "—", count: 0, withPlace: 0, awaitingEmail: 0, waitlisted: 0, capacity: row.capacity };
    entry.count += row.value;
    if (row.bucket === "place") entry.withPlace += row.value;
    else if (row.bucket === "awaitingEmail") entry.awaitingEmail += row.value;
    else entry.waitlisted += row.value;
    perEvent.set(row.eventId, entry);
  }
  return [...perEvent.values()];
}

const cachedBreakdown = new Map<Locale, { at: number; value: RegisteredOnEvent[] }>();

/**
 * The badge's figure and its per-event split, memoized a minute per language, and `null` when
 * the database is away: the shell renders on every backoffice page, `/admin/tasks` and `/devs`
 * included, and a badge is not worth a 500.
 * The total is the sum of the split, so the tab and its tooltip can never disagree.
 */
export async function registeredBadgeBreakdown<T extends Record<string, unknown>>(
  db: Database<T>,
  now: Date,
  locale: Locale,
): Promise<{ total: number; events: RegisteredOnEvent[] } | null> {
  const hit = cachedBreakdown.get(locale);
  let value: RegisteredOnEvent[];
  if (hit && now.getTime() - hit.at < CACHE_MS) {
    value = hit.value;
  } else {
    try {
      value = await countRegisteredPerUpcomingEvent(db, now, locale);
    } catch {
      return null;
    }
    cachedBreakdown.set(locale, { at: now.getTime(), value });
  }
  return { total: value.reduce((sum, row) => sum + row.count, 0), events: value };
}

/** How many events the tooltip names before it says how many more — a tooltip is not a list. */
export const BADGE_HINT_EVENTS = 5;

/** The words the hint is built from, in the reader's language — the `Admin.nav` entries. */
export type BadgeHintWords = {
  rule: string;
  /** "{title}: {count} — {parts}". */
  event: (title: string, count: number, parts: string) => string;
  withPlace: (count: number) => string;
  withPlaceOf: (count: number, capacity: number) => string;
  awaitingEmail: (count: number) => string;
  waitlisted: (count: number) => string;
  more: (count: number) => string;
};

/**
 * The tab's tooltip text (§NNN): what the number is and is not, then each upcoming
 * event with its total and who holds a place — "153 — 144 of 150 places taken, 9 awaiting the
 * email confirmation" — a zero part omitted except the places; the first `BADGE_HINT_EVENTS` by
 * start and how many more after them. Pure, so both languages are tested against the catalogues.
 */
export function registeredBadgeHint(events: readonly RegisteredOnEvent[], words: BadgeHintWords): string {
  const shown = events.slice(0, BADGE_HINT_EVENTS).map((row) => {
    const parts = [
      row.capacity === null ? words.withPlace(row.withPlace) : words.withPlaceOf(row.withPlace, row.capacity),
      ...(row.awaitingEmail > 0 ? [words.awaitingEmail(row.awaitingEmail)] : []),
      ...(row.waitlisted > 0 ? [words.waitlisted(row.waitlisted)] : []),
    ].join(", ");
    return words.event(row.title, row.count, parts);
  });
  const rest = events.length - BADGE_HINT_EVENTS;
  return [words.rule, ...shown, ...(rest > 0 ? [words.more(rest)] : [])].join("\n");
}
