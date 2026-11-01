import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import type { Database } from "@/db/types";
import { eventTranslations, events } from "@/db/schema/events";
import type { Locale } from "@/i18n/routing";
import { eventTakesResults } from "@/modules/results/domain/event-type";

/**
 * The two race-day settings «Sarcini» reminds the club of (§NNN), read from the live system.
 *
 * «Startul cursei» (`events.race_starts_at`) is the gun the finish clock counts from — `raceStartsAt ?? startsAt`, and
 * the event's own start is the desk's opening — and «Categorii de vârstă» (`events.result_age_bands`, §850) are the
 * groups the awards are given in; a change to them after results are entered ranks the places again, so the time to
 * choose is before the race. Both are columns that stay null until the club writes them: the row is open while the
 * column is null and done once it holds a value.
 */

/** How far ahead a race is «coming»: three weeks, the time to set it and to be reminded more than once. */
export const RACE_DAY_SETTINGS_WINDOW_DAYS = 21;

/** A race that started up to this long ago still counts as coming: race day itself, when the gun time matters most. */
export const RACE_DAY_SETTINGS_GRACE_HOURS = 6;

export type RaceDaySetting = { eventId: string; title: string; hasGunTime: boolean; hasAgeBands: boolean };

/**
 * The published, dated races that take results (`eventTakesResults`: only the race) and start from six hours ago to
 * three weeks ahead, soonest first, each with whether the two settings are chosen. Nothing in the window, nothing
 * returned: the page draws no row.
 */
export async function readRaceDaySettings<T extends Record<string, unknown>>(db: Database<T>, locale: Locale, now: Date): Promise<RaceDaySetting[]> {
  const hour = 60 * 60_000;
  const rows = await db
    .select({
      eventId: events.id,
      title: eventTranslations.title,
      type: events.type,
      raceStartsAt: events.raceStartsAt,
      resultAgeBands: events.resultAgeBands,
    })
    .from(events)
    .leftJoin(eventTranslations, and(eq(eventTranslations.eventId, events.id), eq(eventTranslations.locale, locale)))
    .where(
      and(
        eq(events.type, "RACE"),
        eq(events.editorialStatus, "PUBLISHED"),
        eq(events.dateToBeAnnounced, false),
        eq(events.eventStatus, "SCHEDULED"),
        gte(events.startsAt, new Date(now.getTime() - RACE_DAY_SETTINGS_GRACE_HOURS * hour)),
        lte(events.startsAt, new Date(now.getTime() + RACE_DAY_SETTINGS_WINDOW_DAYS * 24 * hour)),
      ),
    )
    .orderBy(asc(events.startsAt));
  return rows
    .filter((row) => eventTakesResults(row.type))
    .map((row) => ({
      eventId: row.eventId,
      title: row.title ?? row.eventId,
      hasGunTime: row.raceStartsAt !== null,
      hasAgeBands: row.resultAgeBands !== null,
    }));
}

/**
 * Whether a published, dated race that was not cancelled has already started — the first real race is behind the club. «Luăm o lună de Mailgun
 * plătit înainte de prima cursă adevărată?» is a question with a deadline, and the deadline is that race (§NNN).
 */
export async function aRaceHasRun<T extends Record<string, unknown>>(db: Database<T>, now: Date): Promise<boolean> {
  const [row] = await db
    .select({ id: events.id })
    .from(events)
    .where(
      and(
        eq(events.type, "RACE"),
        eq(events.editorialStatus, "PUBLISHED"),
        eq(events.dateToBeAnnounced, false),
        inArray(events.eventStatus, ["SCHEDULED", "COMPLETED"]),
        lte(events.startsAt, now),
      ),
    )
    .limit(1);
  return row !== undefined;
}
