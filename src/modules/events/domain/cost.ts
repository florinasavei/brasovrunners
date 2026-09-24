import { eventLinkHost } from "./links";

/**
 * What a runner pays, and where (`DECISIONS.md` §NNN; the owner, 2026-09-24, on "Cu taxă"
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
