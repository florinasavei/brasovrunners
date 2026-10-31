import type { YearMonth } from "./calendar";
import type { CalendarTone } from "./calendar-kind";
import type { EventSurface, EventType } from "./event-type";
import type { SocialNetwork } from "@/shared/ui/SocialIcon";

/**
 * «Salvează ca imagine» (§855; the owner, 2026-10-27: «people want to export the calendar as a picture so
 * they can share to social media … with themes and settings such as aspect ratio … super efficient so it
 * does not consume a lot of Vercel credits»).
 *
 * What the picture is drawn from: the month already on the page, flattened into plain words and numbers the
 * browser draws on a `<canvas>`. Nothing is read for it and no server renders it — the data rides in the
 * month page the public cache already holds, and the drawing code loads only when somebody presses the
 * button. This module is the shapes both sides share, and imports nothing that runs: the browser's half
 * (`ui/calendar-image-draw.ts`) must not carry the server's code (§489). Which day each date falls on and
 * what repeats is `calendar-image-rows.ts`, on the server.
 */

/**
 * A date's details, the words a layout may draw after the hour (the owner, 2026-10-27: «show short location
 * as well like "Tampa", "Parc" and also elevation»), each null when the event has none — and which of
 * them are drawn is the dialog's «Detalii» (`CalendarImageOptions.details`, `calendar-image-canvas.ts#detailWords`).
 */
export type CalendarImageDetails = {
  /** «Locul, pe scurt» in the page's language (migration `0181`): «Tâmpa», «Parc»; null while the place is to be announced. */
  place: string | null;
  /**
   * The place's own name up to its first comma, for a date whose organizer typed no short place (§873):
   * «Parcul Tractorul» from «Parcul Tractorul, intrarea principală». Null when the date has a short place, and
   * while the place is to be announced. Drawn after the distance and the climb (`detailWords`), so a cell too
   * short for it drops it first. Optional: a picture drawn from data without it draws the short place alone.
   */
  placeName?: string | null;
  /** The distance's short words as the site's pills say them (`domain/distance.ts`): «8 km», «≈ 10 km». */
  distance: string | null;
  /** The climb's short words (`domain/elevation.ts`): «350 m D+», «≈ 350 m D+». */
  elevation: string | null;
};

/** One date in a day's cell. */
export type CalendarImageEntry = CalendarImageDetails & {
  day: number;
  /** «18:30», or null when the hour is to be announced. */
  time: string | null;
  title: string;
  tone: CalendarTone;
  /** The type's glyph on «Afiș» (§855). */
  type: EventType;
  /** The ground's glyph beside it — road, mountain, the fork — as the app's chips show it; null when not set. */
  surface: EventSurface | null;
  special: boolean;
  cancelled: boolean;
};

/** The words the picture says, in the page's language. */
export type CalendarImageWords = {
  heading: string;
  monthTitle: string;
  weekdays: string[];
  /** «Luni» … «Duminică», the poster's column heads. */
  weekdaysLong: string[];
  /** The month alone, «octombrie», the poster's large word. */
  monthName: string;
  /** «ora {time}» under a date's title on the poster. */
  at: string;
  /** The club's tags at the poster's foot. */
  hashtags: string;
  recurringTitle: string;
  specialTitle: string;
  cancelled: string;
  /** «ora se anunță» where a date's hour goes while `time` is null — lower case, short, like `at`. */
  tba: string;
  follow: string;
  more: string;
  /** «Nicio alergare luna aceasta»: what the frame says in the body of a month with no date (`calendar-image-frame.ts`). */
  emptyMonth: string;
  /** «Nicio alergare săptămâna aceasta»: the same for a week with none. */
  emptyWeek: string;
};

export type CalendarImageData = {
  month: YearMonth;
  entries: CalendarImageEntry[];
  /** A title that repeats in the month, with its rhythm: «În fiecare luni, la 18:30» — and the series' details, its first date's. */
  recurring: (CalendarImageDetails & { title: string; sentence: string; tone: CalendarTone; type: EventType; surface: EventSurface | null })[];
  /** A date that stands alone in the month: its day and title, with its details. */
  specials: (CalendarImageDetails & { day: number; title: string; tone: CalendarTone; type: EventType; surface: EventSurface | null })[];
  /** The club's profiles the site links (`clubSocialLinks`), drawn at the poster's foot with the club's name. */
  socials: SocialNetwork[];
  words: CalendarImageWords;
  /** Where to find the club, the site's own host (`APP_BASE_URL`). */
  host: string;
  clubName: string;
};

/** The most rows each legend draws; a busier month is the calendar's to read in full. */
export const LEGEND_MAX = 4;

/**
 * Whether «Locul» has anything to draw (§863, §873): a date of the month — or of the week's `days` — with a short
 * place or, failing one, its place's name. False only while no date of the period has its place announced.
 */
export function periodHasPlace(entries: readonly CalendarImageEntry[], days: readonly number[] | null): boolean {
  const said = (text: string | null | undefined) => typeof text === "string" && text.trim() !== "";
  return entries.some((entry) => (said(entry.place) || said(entry.placeName)) && (days === null || days.includes(entry.day)));
}
