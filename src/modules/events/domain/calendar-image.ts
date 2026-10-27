import type { YearMonth } from "./calendar";
import type { CalendarTone } from "./calendar-kind";
import type { EventType } from "./event-type";
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

/** One date in a day's cell. */
export type CalendarImageEntry = {
  day: number;
  /** «18:30», or null when the hour is to be announced. */
  time: string | null;
  title: string;
  tone: CalendarTone;
  /** The type's glyph on «Afiș» (§855). */
  type: EventType;
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
  follow: string;
  more: string;
};

export type CalendarImageData = {
  month: YearMonth;
  entries: CalendarImageEntry[];
  /** A title that repeats in the month, with its rhythm: «În fiecare luni, la 18:30». */
  recurring: { title: string; sentence: string; tone: CalendarTone; type: EventType }[];
  /** A date that stands alone in the month: its day and title. */
  specials: { day: number; title: string; tone: CalendarTone; type: EventType }[];
  /** The club's profiles the site links (`clubSocialLinks`), drawn at the poster's foot with the club's name. */
  socials: SocialNetwork[];
  words: CalendarImageWords;
  /** Where to find the club, the site's own host (`APP_BASE_URL`). */
  host: string;
  clubName: string;
};

/** The most rows each legend draws; a busier month is the calendar's to read in full. */
export const LEGEND_MAX = 4;
