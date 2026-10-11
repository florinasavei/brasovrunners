import { z } from "zod";
import { CLUB_TIME_ZONE } from "@/i18n/dates";
import { groupSeries, recurrenceOf, type SeriesMember } from "@/modules/events/domain/series";
import { toWallTimeInput } from "@/modules/events/domain/zoned-time";

/**
 * The numbers band (§NNN; `docs/REDESIGN.md`, decision 8): four figures, two the club types and two
 * the site reads off the events. **Never invented** (BUSINESS.md §7): a figure without its fact is
 * left out, never guessed, and the band with none is not drawn.
 *
 * - **Years** — from the founding date the club types: whole years to today, on the club's calendar.
 * - **Active runners** — the number the club types; it is the club's claim, the site only prints it.
 * - **Runs a week** — the weekly runs' weekdays, summed over every standing series that repeats every
 *   week (the listing's own recognition, `groupSeries` + `recurrenceOf`, §113 — the one «Vino cu noi»
 *   reads, §708): a Tuesday run and a Thursday run are «2×».
 * - **Free** — drawn as «100%» only when every coming date of those weekly runs says «Gratuit»: the
 *   band states a promise, and a share under it is a sentence for a page, not a badge.
 *
 * Pure: the page hands it the upcoming events it already reads (the listing's cached read) and the
 * clock; a test hands it rows.
 */
export type NumbersContent = {
  /** The day the club was founded, `YYYY-MM-DD`, or none. */
  foundedOn: string | null;
  /** How many people run with the club, by the club's own count, or none. */
  activeRunners: number | null;
};

export const EMPTY_NUMBERS: NumbersContent = { foundedOn: null, activeRunners: null };

const ISO_DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export const numbersContentSchema = z.object({
  foundedOn: z
    .string()
    .regex(ISO_DAY)
    .refine((day) => !Number.isNaN(Date.parse(`${day}T00:00:00Z`)) && new Date(`${day}T00:00:00Z`).toISOString().startsWith(day), "a real day")
    .nullable()
    .default(null),
  activeRunners: z.number().int().min(1).max(100_000).nullable().default(null),
});

export function readNumbersContent(value: unknown): NumbersContent {
  const parsed = numbersContentSchema.safeParse(value);
  return parsed.success ? parsed.data : EMPTY_NUMBERS;
}

/** The figures, in the band's order; each `count` is what the band prints. */
export const HOME_FIGURES = ["years", "runners", "perWeek", "free"] as const;
export type HomeFigureId = (typeof HOME_FIGURES)[number];
export type HomeFigure = { id: HomeFigureId; count: number };

/** An upcoming date as the listing's read carries it: enough to recognise a series and its cost. */
export type NumbersEvent = SeriesMember & { timezone: string; eventStatus: string; costType: string | null };

/** Whole years from `foundedOn` to `now`, on the club's calendar; null before the first anniversary or for a day still to come. */
export function yearsSince(foundedOn: string, now: Date): number | null {
  const today = toWallTimeInput(now, CLUB_TIME_ZONE).slice(0, 10);
  if (today < foundedOn) return null;
  const years = Number(today.slice(0, 4)) - Number(foundedOn.slice(0, 4)) - (today.slice(5) < foundedOn.slice(5) ? 1 : 0);
  return years >= 1 ? years : null;
}

/** The weekly series among the upcoming dates, each with the weekdays it runs on. */
function weeklySeries<T extends NumbersEvent>(upcoming: readonly T[]): { members: readonly T[]; weekdays: number }[] {
  const weekly: { members: readonly T[]; weekdays: number }[] = [];
  for (const series of groupSeries(upcoming)) {
    const recurrence = recurrenceOf(series.members, series.members[0].timezone);
    if (recurrence.kind === "weekly") weekly.push({ members: series.members, weekdays: recurrence.weekdays.length });
  }
  return weekly;
}

export function homeFigures(content: NumbersContent, upcoming: readonly NumbersEvent[], now: Date): HomeFigure[] {
  const figures: HomeFigure[] = [];
  const years = content.foundedOn ? yearsSince(content.foundedOn, now) : null;
  if (years) figures.push({ id: "years", count: years });
  if (content.activeRunners && content.activeRunners > 0) figures.push({ id: "runners", count: content.activeRunners });

  const weekly = weeklySeries(upcoming);
  const perWeek = weekly.reduce((sum, series) => sum + series.weekdays, 0);
  if (perWeek > 0) figures.push({ id: "perWeek", count: perWeek });

  const going = weekly.flatMap((series) => series.members.filter((member) => member.eventStatus !== "CANCELLED"));
  if (going.length > 0 && going.every((member) => member.costType === "FREE")) figures.push({ id: "free", count: 100 });
  return figures;
}
