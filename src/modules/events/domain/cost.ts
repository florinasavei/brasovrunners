import { eventLinkHost } from "./links";

/**
 * What a runner pays, and where (`DECISIONS.md` §343; the owner, 2026-09-24, on "Cu taxă"
 * showing no box for the money: "usually nothing is paid; the exception is Wings for Life,
 * where a donation is made on another site").
 *
 * `FREE` and `PAID` are migration `0018`'s pair. `DONATION` is the third answer: no fee the
 * platform or the club takes, a link to somewhere else where a runner gives what they choose.
 * This file is the one place that decides what the pair of columns behind `PAID` and `DONATION`
 * mean, the same role `links.ts` plays for "Linkuri și fișiere" — so the editor, the page, the
 * calendar and the structured data cannot disagree about them.
 */
export const EVENT_COST_TYPES = ["FREE", "PAID", "DONATION"] as const;
export type EventCostType = (typeof EVENT_COST_TYPES)[number];

/**
 * 60 characters: "50 lei", "20 € la ridicarea kitului", "sugerat 50 lei" — a price, not a
 * paragraph.
 */
export const MAX_EVENT_COST_AMOUNT = 60;

/**
 * The host a runner recognises under a cost link — "revolut.me", "strava.com" — shown instead
 * of the raw address, exactly as "Linkuri și fișiere" shows one under its own links.
 */
export const costUrlHost = eventLinkHost;

/**
 * Whether the fee itself is settled somewhere the club has no query over — an `EXTERNAL`
 * registration's own organizer — rather than at the club's own link, if any (`DECISIONS.md`
 * §394). Only this combination reads "la organizator" / "to the organizer" and only this one
 * may carry a discount note: an `INTERNAL` paid event's link, when it has one, is the club's.
 */
export function costPaidToExternalOrganizer(event: {
  registrationMode: "NONE" | "INTERNAL" | "EXTERNAL";
  costType: EventCostType | null;
}): boolean {
  return event.registrationMode === "EXTERNAL" && event.costType === "PAID";
}

/**
 * "50 lei — 40 pentru membri, până pe 1 mai": the club's discount on an external event's own
 * fee, one short line (`DECISIONS.md` §394). The organizer sets the price; the club only ever
 * knows what its members get off it, so this is a note, never a second amount.
 */
export const MAX_DISCOUNT_NOTE = 200;
