import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { cache } from "react";
import { getDb } from "@/db/client";
import { events } from "@/db/schema/events";
import { formatDay } from "@/i18n/dates";
import { startHeldBack } from "@/modules/events/domain/dated";
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
 * «Dă-i un loc acum» before the press (§637): null where the press is always refused — an event that
 * is not local, not `SCHEDULED`, whose date is to be announced (§533) or that has started, the
 * service's own refusals (`givePlaceNowByStaff`), so the button is not drawn there — and otherwise
 * whether the question must say no place is free. Full reads as the service decides under the lock:
 * the allocator's counts against the capacity, except that one lapsed declaration hold may go for
 * this person (§160), so a full race with a lapsed hold is not "full" here. Once per event per
 * request; a forecast only, the server decides. Since §NNN a full race does not refuse the press — it
 * adds one supplementary place — so `raisedTo` is the capacity the question names, null when not full.
 */
export const givePlaceNowAhead = cache(async (eventId: string): Promise<{ full: boolean; raisedTo: number | null } | null> => {
  const db = getDb();
  const [row] = await db
    .select({
      capacity: events.capacity,
      registrationMode: events.registrationMode,
      eventStatus: events.eventStatus,
      startsAt: events.startsAt,
      dateToBeAnnounced: events.dateToBeAnnounced,
      timeToBeAnnounced: events.timeToBeAnnounced,
    })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);
  const now = new Date();
  if (!row || row.registrationMode !== "INTERNAL" || row.eventStatus !== "SCHEDULED" || startHeldBack(row) || row.startsAt.getTime() <= now.getTime()) {
    return null;
  }
  if (row.capacity === null) return { full: false, raisedTo: null };
  const raisedTo = await supplementaryPlaceIfFull(eventId);
  return { full: raisedTo !== null, raisedTo };
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
 * The capacity one supplementary place would raise a full event to (§NNN), read before the press of
 * «Trimite-i oferta» or «Dă-i un loc acum»: the allocator's counts against the capacity, as the service
 * compares them under the lock after expiring the stale holds — where a lapsed declaration hold is
 * released for the one person chosen (§160; the line or the newcomer wants it), so a full race with a
 * lapsed hold is not "full" here. Null with a place free, with a lapsed hold to release, or uncapped.
 * One read per event per request; a forecast only, the server decides.
 */
const supplementaryPlaceIfFull = cache(async (eventId: string): Promise<number | null> => {
  const db = getDb();
  const [row] = await db.select({ capacity: events.capacity }).from(events).where(eq(events.id, eventId)).limit(1);
  if (!row || row.capacity === null) return null;
  const counts = await countOccupied(db, eventId, new Date());
  return noFreePlace(row.capacity, counts) !== null && counts.lapsedDeclarationHolds === 0 ? row.capacity + 1 : null;
});

export type StaffOfferForecast = {
  /** The deadline, formatted for a sentence. */
  deadline: string;
  /** Registration has closed: the offer goes anyway, capped by the start. */
  afterClose: boolean;
  /** The capacity a press would raise it to — no place free now — or null with a place free or no limit. */
  raisedTo: number | null;
};

/**
 * «Trimite-i oferta»'s question (§615, §NNN), read before the press: until when the runner would have
 * to sign if the press were made now — the staff offer's deadline (`computeWaitlistOfferExpiry` with
 * `capByClose: false`: the club's window from «Termene», capped by the start alone), in the event's
 * own zone and the page's words, as the email names it; whether registration has closed (the offer
 * still goes); and, on a full event, the capacity the press would raise it to
 * (`supplementaryPlaceIfFull`). Null once the event has started, when the press is refused. Once per
 * event per request. A forecast: the server decides again under the lock, and the email's send
 * re-bases the offer (§513).
 */
export const staffOfferIfMadeNow = cache(async (eventId: string, locale: string): Promise<StaffOfferForecast | null> => {
  const db = getDb();
  const [row] = await db
    .select({ registrationClosesAt: events.registrationClosesAt, startsAt: events.startsAt, timezone: events.timezone })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);
  if (!row) return null;
  const now = new Date();
  const at = computeWaitlistOfferExpiry({
    now,
    registrationClosesAt: row.registrationClosesAt,
    eventStartsAt: row.startsAt,
    deadlines: await deadlinesForThisRequest(),
    capByClose: false,
  });
  if (at.getTime() <= now.getTime()) return null;
  return {
    deadline: formatDay(at, { locale, timeZone: row.timezone, style: "short", withTime: true, position: "inline" }),
    afterClose: row.registrationClosesAt !== null && row.registrationClosesAt.getTime() <= now.getTime(),
    raisedTo: await supplementaryPlaceIfFull(eventId),
  };
});

type Translate = (key: string, values?: Record<string, string>) => string;

/**
 * The dialog for one person (§NNN; the owner, 2026-10-02: «vreau confirmare când depășesc limita»):
 * the offer and its deadline, then — each its own catalogue string, under §511's 200 characters — the
 * supplementary place a full event gets and that registration has closed; and a confirm button that
 * names the added place when there is one («Adaugă un loc și trimite oferta»), so a raise is never
 * pressed through a button that only says «Trimite-i oferta». `t` is the `Admin` translator.
 */
export function staffOfferQuestion(t: Translate, name: string, forecast: StaffOfferForecast): { body: string; confirmLabel: string } {
  const body = [
    t("confirm.offerPlaceBody", { name, message: t("emails.types.WAITLIST_SPOT_OFFER"), deadline: forecast.deadline }),
    forecast.raisedTo !== null ? t("confirm.offerPlaceRaise", { n: String(forecast.raisedTo) }) : null,
    forecast.afterClose ? t("confirm.offerPlaceAfterClose") : null,
  ]
    .filter((sentence): sentence is string => sentence !== null)
    .join(" ");
  return { body, confirmLabel: forecast.raisedTo !== null ? t("confirm.offerPlaceRaiseConfirm") : t("desk.offerPlace") };
}
