import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { cache } from "react";
import { getDb } from "@/db/client";
import { events } from "@/db/schema/events";
import { formatDay } from "@/i18n/dates";
import { deadlinesForThisRequest } from "@/modules/deadlines/request";
import { noFreePlace, type PlacesTaken, placesTakenValues } from "./domain/capacity";
import { computeWaitlistOfferExpiry } from "./domain/hold-deadlines";
import { countOccupied } from "./repository";

/**
 * Whether «Dă-i un loc» would be refused as full, read before the press (§592; the owner,
 * 2026-09-30: the button stays, and says why). The allocator's own counts (`countOccupied`) and the
 * event's capacity, compared as `promoteFromWaitlistByStaff` compares them under the lock — the
 * five numbers when the race is full, null when a place is free or the event is uncapped.
 *
 * Once per event per request (React's `cache`): the list page, the row page and every desk row of
 * one event ask the same question, and a page of twenty-five waiting rows costs one read per event,
 * never one per row. A forecast only: the press still goes through the allocator, which decides.
 */
export const placesTakenIfFull = cache(async (eventId: string): Promise<PlacesTaken | null> => {
  const db = getDb();
  const [row] = await db.select({ capacity: events.capacity }).from(events).where(eq(events.id, eventId)).limit(1);
  if (!row || row.capacity === null) return null;
  return noFreePlace(row.capacity, await countOccupied(db, eventId, new Date()));
});

/**
 * The tooltip's sentence, or null while a place is free: the refusal banner's own words
 * (`Admin.errors.NO_FREE_PLACE`, §589) with the numbers read now — one text for both, so the
 * button says before the press exactly what the banner would say after it.
 */
export async function givePlaceRefusalAhead(eventId: string): Promise<string | null> {
  const [places, t] = await Promise.all([placesTakenIfFull(eventId), getTranslations("Admin")]);
  return places ? t("errors.NO_FREE_PLACE", placesTakenValues(places)) : null;
}

/**
 * «Trimite-i oferta»'s question (§NNN): until when the runner would have to sign if the press were
 * made now — the ordinary offer's deadline (`computeWaitlistOfferExpiry`: the club's window from
 * «Termene», capped by the close and the start), in the event's own zone and the page's words, as the
 * email names it. Null once registration has closed, when the press is refused: an offer then would
 * already be lapsed. Once per event per request. A forecast: the email's send re-bases the offer
 * (§513), and the server computes it again under the lock.
 */
export const offerDeadlineIfMadeNow = cache(async (eventId: string, locale: string): Promise<string | null> => {
  const db = getDb();
  const [row] = await db
    .select({ registrationClosesAt: events.registrationClosesAt, startsAt: events.startsAt, timezone: events.timezone })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);
  if (!row) return null;
  const now = new Date();
  const at = computeWaitlistOfferExpiry({ now, registrationClosesAt: row.registrationClosesAt, eventStartsAt: row.startsAt, deadlines: await deadlinesForThisRequest() });
  if (at.getTime() <= now.getTime()) return null;
  return formatDay(at, { locale, timeZone: row.timezone, style: "short", withTime: true, position: "inline" });
});
