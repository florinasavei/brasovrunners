import { eq, and } from "drizzle-orm";
import { eventRsvps, rsvpAskRefusals } from "@/db/schema/event-rsvps";
import { eventTranslations, events } from "@/db/schema/events";
import type { Database } from "@/db/types";
import { isWellFormedTokenSecret } from "@/modules/action-tokens/domain/token-secret";
import { seriesKey } from "@/modules/events/domain/series";
import { routing } from "@/i18n/routing";
import { consumeRsvpToken } from "./rsvp";

/**
 * «Nu mă mai întreba la seria aceasta» (§NNN; the owner, 2026-10-19: «I need to set how these emails are sent») — the one press that stops the
 * day-before question (§818) for good, for a SERIES of events, for an address.
 *
 * It is the third link of a question sent to an earlier answerer (`RSVP_REFUSE`, minted by `makeRsvpAsk`, never in a subscriber's: their way
 * out is their topic page). **It follows the house's link rules** (AGENTS.md §12.8, BR-REQ-036-02): the secret is hashed at rest, single use
 * (one UPDATE, one winner — `consumeRsvpToken`), and a GET of its page writes nothing — the press is a POST (`app/[locale]/vin/[token]/actions.ts`).
 *
 * **What the press records** is the address's canonical form, its canonicalizer's version and the series key — `rsvp_ask_refusals`, UNIQUE on
 * (address, series), so a second press changes nothing. The series key is the listing's (`events/domain/series.ts#seriesKey`, the type and the
 * default-language title, §113): not an event, because a weekly run is asked again at every date. A series renamed since takes the person
 * out of it on purpose, as it takes a date out of the listing's line. **What it stops:** every later question of that series, whichever list
 * the address is on (`queueRsvpAsks`, `checkRsvpAsk`); the answers already given stay; an unanswered row this email made is deleted,
 * as «Nu vin» deletes it, and a counted one is left (a person who said «Vin» and then «don't ask me again» keeps their place in the count).
 *
 * **What is kept, and how long** (the notice says exactly this): the address in its canonical form and the series' key, nothing else — no name, no
 * event, no message — for as long as the series lives and a year after its last date (`RETENTION_PERIODS.rsvpAskRefusalDaysAfterSeries`,
 * `jobs/retention.ts`). Keeping it is what makes the refusal true: deleting it would ask the person again. It is the person's data like any other
 * (`registrations/person-data.ts` lists it), and the one row an erase keeps: the objection is honoured by remembering it.
 */

/** The key a series is refused by: the listing's `seriesKey` of the event's type and default-language title, or — for an event with no such title — the event alone. */
export async function eventSeriesKey<T extends Record<string, unknown>>(db: Database<T>, eventId: string): Promise<string> {
  const [row] = await db
    .select({ type: events.type, title: eventTranslations.title })
    .from(events)
    .leftJoin(eventTranslations, and(eq(eventTranslations.eventId, events.id), eq(eventTranslations.locale, routing.defaultLocale)))
    .where(eq(events.id, eventId))
    .limit(1);
  return row && row.title !== null ? seriesKey({ type: row.type, title: row.title }) : `event:${eventId}`;
}

/** Who a used refusal link proved, for the page that says «Gata»: the event's page address and whether the row it made was deleted. */
export type RefusedAsks = {
  eventId: string;
  locale: "ro" | "en";
  slug: string | null;
  /** The row the question made was still unanswered (deleted) — the page says «nu te numărăm»; false when a counted answer was left in place. */
  unanswered: boolean;
};

/**
 * The refusal link's POST: spends the `RSVP_REFUSE` link, records the refusal for the answer's series, and deletes the answer when it was
 * the question's still-unanswered row — in one transaction. Null when the link was not live (a second press, an expired or superseded
 * link, an event that has started). The first press is the only one that writes; the unique key makes any other a no-op.
 */
export async function refuseRsvpAsks<T extends Record<string, unknown>>(db: Database<T>, secret: string, now: Date): Promise<RefusedAsks | null> {
  if (!isWellFormedTokenSecret(secret)) return null;
  return db.transaction(async (tx) => {
    const rsvpId = await consumeRsvpToken(tx, secret, "RSVP_REFUSE", now);
    if (!rsvpId) return null;
    const [row] = await tx.select().from(eventRsvps).where(eq(eventRsvps.id, rsvpId)).for("update");
    if (!row) return null;
    await tx
      .insert(rsvpAskRefusals)
      .values({ canonicalEmail: row.canonicalEmail, canonicalizationVersion: row.canonicalizationVersion, seriesKey: await eventSeriesKey(tx, row.eventId), createdAt: now })
      .onConflictDoNothing({ target: [rsvpAskRefusals.canonicalEmail, rsvpAskRefusals.seriesKey] });
    const unanswered = row.confirmedAt === null;
    if (unanswered) await tx.delete(eventRsvps).where(eq(eventRsvps.id, row.id));
    const [translation] = await tx
      .select({ slug: eventTranslations.slug })
      .from(eventTranslations)
      .where(and(eq(eventTranslations.eventId, row.eventId), eq(eventTranslations.locale, row.locale)))
      .limit(1);
    return { eventId: row.eventId, locale: row.locale, slug: translation?.slug ?? null, unanswered };
  });
}
