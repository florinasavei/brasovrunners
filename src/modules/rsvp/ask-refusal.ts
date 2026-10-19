import { and, eq, gt, isNotNull, isNull } from "drizzle-orm";
import { eventRsvps, rsvpAskRefusals, rsvpRefuseTokens } from "@/db/schema/event-rsvps";
import { eventTranslations, events } from "@/db/schema/events";
import type { Database } from "@/db/types";
import { generateTokenSecret, hashTokenSecret, isWellFormedTokenSecret } from "@/modules/action-tokens/domain/token-secret";
import { seriesKey } from "@/modules/events/domain/series";
import { routing } from "@/i18n/routing";
import { RSVP_LINK_GRACE_DAYS } from "./domain/link-life";
import type { RsvpLink } from "./rsvp";

/**
 * «Nu mă mai întreba la seria aceasta» (§NNN; the owner, 2026-10-19: «I need to set how these emails are sent») — the one press that stops the
 * day-before question (§818) for good, for a SERIES of events, for an address.
 *
 * It is the third link of a question sent to an earlier answerer (`rsvp_refuse_tokens`, minted by `makeRsvpAsk`, never in a subscriber's: their way
 * out is their topic page). **It follows the house's link rules** (AGENTS.md §12.8, BR-REQ-036-02): the secret is hashed at rest, single use
 * (one UPDATE, one winner), and a GET of its page writes nothing — the press is a POST (`app/[locale]/vin/[token]/actions.ts`).
 *
 * **It does not depend on the answer.** The question made an answer row and «Nu vin» in the same email deletes it; the refusal link has its own
 * table, carrying the address, the series, the event and the language, so it still works after «Nu vin», after an erase of the answers and
 * after the event's start: it lives until `RSVP_LINK_GRACE_DAYS` after the start, the notice's «oricând» for the length of the email's life.
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

/**
 * Mint the refusal link of one question to an earlier answerer, at the send (§14.5: the secret is in the email alone). It carries what
 * the refusal needs, so it outlives the answer row. Lives until `RSVP_LINK_GRACE_DAYS` after the event's start.
 */
export async function mintRefuseLink<T extends Record<string, unknown>>(
  db: Database<T>,
  params: { eventId: string; locale: "ro" | "en"; canonicalEmail: string; canonicalizationVersion: number; startsAt: Date; now: Date },
): Promise<string> {
  const secret = generateTokenSecret();
  await db.insert(rsvpRefuseTokens).values({
    eventId: params.eventId,
    locale: params.locale,
    canonicalEmail: params.canonicalEmail,
    canonicalizationVersion: params.canonicalizationVersion,
    seriesKey: await eventSeriesKey(db, params.eventId),
    tokenHash: hashTokenSecret(secret),
    expiresAt: new Date(params.startsAt.getTime() + RSVP_LINK_GRACE_DAYS * 86_400_000),
    createdAt: params.now,
  });
  return secret;
}

/**
 * What a GET of a refusal link may do (read-only): name the event and say whether the press would act. `readRsvpLink` asks this when the secret
 * is not one of the answer's links. There is no «over» state: the link outlives the start on purpose. Null when the secret is unknown.
 */
export async function readRefuseLink<T extends Record<string, unknown>>(db: Database<T>, secret: string, now: Date): Promise<RsvpLink | null> {
  const [row] = await db
    .select({
      eventId: rsvpRefuseTokens.eventId,
      locale: rsvpRefuseTokens.locale,
      usedAt: rsvpRefuseTokens.usedAt,
      expiresAt: rsvpRefuseTokens.expiresAt,
      title: eventTranslations.title,
      slug: eventTranslations.slug,
      startsAt: events.startsAt,
    })
    .from(rsvpRefuseTokens)
    .innerJoin(events, eq(events.id, rsvpRefuseTokens.eventId))
    .innerJoin(eventTranslations, and(eq(eventTranslations.eventId, events.id), eq(eventTranslations.locale, rsvpRefuseTokens.locale)))
    .where(eq(rsvpRefuseTokens.tokenHash, hashTokenSecret(secret)))
    .limit(1);
  if (!row) return null;
  return {
    purpose: "RSVP_REFUSE",
    state: row.usedAt !== null ? "used" : row.expiresAt.getTime() <= now.getTime() ? "expired" : "live",
    rsvpId: null,
    eventId: row.eventId,
    locale: row.locale,
    title: row.title,
    slug: row.slug,
    startsAt: row.startsAt,
    confirmed: false,
    asked: false,
    named: false,
    showName: false,
    name: null,
  };
}

/** Who a used refusal link proved, for the page that says «Gata»: the event's page address and whether the row it made was deleted. */
export type RefusedAsks = {
  eventId: string;
  locale: "ro" | "en";
  slug: string | null;
  /** The row the question made was still unanswered (deleted) — the page says «nu te numărăm»; false when a counted answer was left in place, or «Nu vin» had deleted it. */
  unanswered: boolean;
};

/**
 * The refusal link's POST: spends the link, records the refusal for the token's series, and deletes the answer when it is still the
 * question's unanswered row — in one transaction. Null when the link was not live (a second press, an expired link). The first press is the
 * only one that writes; the unique key makes any other a no-op. Nothing here reads the answer row to find the person: the token knows.
 */
export async function refuseRsvpAsks<T extends Record<string, unknown>>(db: Database<T>, secret: string, now: Date): Promise<RefusedAsks | null> {
  if (!isWellFormedTokenSecret(secret)) return null;
  return db.transaction(async (tx) => {
    const [token] = await tx
      .update(rsvpRefuseTokens)
      .set({ usedAt: now })
      .where(and(eq(rsvpRefuseTokens.tokenHash, hashTokenSecret(secret)), isNull(rsvpRefuseTokens.usedAt), gt(rsvpRefuseTokens.expiresAt, now)))
      .returning();
    if (!token) return null;
    await tx
      .insert(rsvpAskRefusals)
      .values({ canonicalEmail: token.canonicalEmail, canonicalizationVersion: token.canonicalizationVersion, seriesKey: token.seriesKey, createdAt: now })
      .onConflictDoNothing({ target: [rsvpAskRefusals.canonicalEmail, rsvpAskRefusals.seriesKey] });
    const deleted = await tx
      .delete(eventRsvps)
      .where(and(eq(eventRsvps.eventId, token.eventId), eq(eventRsvps.canonicalEmail, token.canonicalEmail), isNotNull(eventRsvps.askedAt), isNull(eventRsvps.confirmedAt)))
      .returning({ id: eventRsvps.id });
    const [translation] = await tx
      .select({ slug: eventTranslations.slug })
      .from(eventTranslations)
      .where(and(eq(eventTranslations.eventId, token.eventId), eq(eventTranslations.locale, token.locale)))
      .limit(1);
    return { eventId: token.eventId, locale: token.locale, slug: translation?.slug ?? null, unanswered: deleted.length > 0 };
  });
}
