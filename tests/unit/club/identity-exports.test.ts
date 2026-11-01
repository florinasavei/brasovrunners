import { describe, expect, it } from "vitest";
import { EVENT_FILE_FORMAT } from "@/modules/content/events/transfer/file-format";
import { CLUB_LOCALITY } from "@/modules/events/domain/place";
import { DEFAULT_CLUB_COORDINATES } from "@/modules/events/domain/sun";
import { buildCalendar, calendarFeedFileName, type CalendarLabels } from "@/modules/events/ical";
import { glossaryContext } from "@/modules/translate/domain/glossary";
import { CLUB_TIME_ZONE } from "@/i18n/dates";
import { envSchema } from "@/shared/config/env";
import { CLUB_NAME, CLUB_SHORT_FORMS, LOGO, WORDMARK } from "@/theme/brand";

/**
 * BR-REQ-101-01 (§882): the club's identity moved into `club/club.json`, and nothing a person sees changed.
 *
 * The file snapshot beside this test was written from `origin/qa` before the move — every identity, place,
 * time and logo export, and the strings the platform builds from them — so the values read from the config
 * are proved equal, character for character, to the ones that were written in the code. A diff in the
 * snapshot is a change the club would see: it is never updated to make this pass.
 */
describe("BR-REQ-101-01: the identity exports read from club/club.json equal the literals they replaced (§882)", () => {
  it("prints the same values as origin/qa did", async () => {
    const defaults = envSchema.parse({});
    const calendar = buildCalendar({ events: [], baseUrl: "http://localhost:3000", name: "x", labels: {} as CalendarLabels });
    const values = {
      WORDMARK,
      CLUB_NAME,
      CLUB_SHORT_FORMS,
      LOGO,
      CLUB_LOCALITY,
      DEFAULT_CLUB_COORDINATES,
      CLUB_TIME_ZONE,
      EMAIL_FROM_NAME_default: defaults.EMAIL_FROM_NAME,
      CLUB_COORDINATES_default: defaults.CLUB_COORDINATES,
      EVENT_FILE_FORMAT,
      calendarFeedFileName: { ro: calendarFeedFileName("ro"), en: calendarFeedFileName("en") },
      PRODID: calendar.split("\r\n").find((line) => line.startsWith("PRODID:")),
      glossaryContext: glossaryContext(),
    };
    await expect(`${JSON.stringify(values, null, 2)}\n`).toMatchFileSnapshot("./__snapshots__/identity-exports.json");
  });

  /**
   * §NNN: the palette moved into `club/club.json` too, and Brașov stays identical to the pixel. Every colour
   * export of `brand.ts` (the bib's colours since they moved into it), the pairs the AA tests walk and the logo's
   * proportions as the race number and the PDFs round them — written from `origin/qa` before the move.
   */
  it("prints the same palette as origin/qa did", async () => {
    const brand = await import("@/theme/brand");
    const pairs = await import("@/theme/brand-pairs");
    const values = {
      COLOR: brand.COLOR,
      COLOR_DARK: brand.COLOR_DARK,
      PROVIDER_LOGO: brand.PROVIDER_LOGO,
      SITE_TINT: brand.SITE_TINT,
      EMAIL_EMPHASIS: brand.EMAIL_EMPHASIS,
      GRADIENT: brand.GRADIENT,
      SHEET_TINT: brand.SHEET_TINT,
      SHEET_FRAME: brand.SHEET_FRAME,
      LOOK_ACCENT: brand.LOOK_ACCENT,
      TEAM_CANVAS: brand.TEAM_CANVAS,
      SURFACE_GRADIENT: brand.SURFACE_GRADIENT,
      CALENDAR_IMAGE_THEMES: brand.CALENDAR_IMAGE_THEMES,
      BIB_COLOURS: brand.BIB_COLOURS,
      BRAND_PAIRS: pairs.BRAND_PAIRS,
      CALENDAR_TONE_PAIRS: pairs.CALENDAR_TONE_PAIRS,
    };
    await expect(`${JSON.stringify(values, null, 2)}\n`).toMatchFileSnapshot("./__snapshots__/palette-exports.json");
  });
});
