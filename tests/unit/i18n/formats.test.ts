import { describe, expect, it } from "vitest";
import { formatDay, formatTime } from "@/i18n/dates";
import { distanceInKm } from "@/modules/events/domain/event-type";

/**
 * BR-REQ-040-03 — localized formatting.
 *
 * These assert the behaviour the pages depend on, through the date helper every page, email and
 * PDF writes a date with (`src/i18n/dates.ts`, §NNN). The rules being protected are: an event is
 * shown in *its own* timezone rather than the server's or the reader's, each locale gets its own
 * separators, and converting metres for display never changes what is stored. The weekday, the
 * capital by position and the caller's zone are criteria 4–6, in `dates.test.ts`.
 */

const ro = "ro-RO";
const en = "en-GB";
const BUCHAREST = "Europe/Bucharest";

describe("BR-REQ-040-03 criterion 1 dates in the event timezone", () => {
  // 05:00 UTC on a September Sunday is 08:00 in Bucharest (UTC+3).
  const instant = new Date("2026-09-20T05:00:00Z");

  it("formats the date in Romanian for a Romanian reader", () => {
    expect(formatDay(instant, { locale: "ro", timeZone: BUCHAREST })).toBe("Duminică, 20 sept. 2026");
    expect(formatDay(instant, { locale: "ro", timeZone: BUCHAREST, withTime: true })).toBe("Duminică, 20 sept. 2026, 08:00");
  });

  it("formats the same instant in English for an English reader", () => {
    // British English abbreviates September "Sept" in current CLDR and "Sep" in older data.
    expect(formatDay(instant, { locale: "en", timeZone: BUCHAREST })).toMatch(/^Sunday, 20 Sept? 2026$/);
    expect(formatDay(instant, { locale: "en", timeZone: BUCHAREST, withTime: true })).toMatch(/^Sunday, 20 Sept? 2026, 08:00$/);
  });

  it("uses the event timezone, not UTC, so the start time reads as local", () => {
    expect(formatTime(instant, { locale: "ro", timeZone: BUCHAREST })).toBe("08:00");
    // The same instant in UTC is three hours earlier. Showing this would tell a runner in
    // Brașov the wrong time to turn up, which is the failure this rule prevents.
    expect(formatTime(instant, { locale: "ro", timeZone: "UTC" })).toBe("05:00");
  });

  it("keeps the winter offset correct, so the conversion is not hardcoded", () => {
    const january = new Date("2026-01-15T06:00:00Z");
    // January is UTC+2 in Bucharest.
    expect(formatTime(january, { locale: "ro", timeZone: BUCHAREST })).toBe("08:00");
  });
});

describe("BR-REQ-040-03 criterion 3 distances", () => {
  it("converts metres to kilometres without altering the stored value", () => {
    // The function receives metres and returns kilometres; nothing writes back.
    expect(distanceInKm(8000)).toBe(8);
    expect(distanceInKm(14000)).toBe(14);
    expect(distanceInKm(14500)).toBe(14.5);
    expect(distanceInKm(21097)).toBe(21.1);
  });

  it("returns null for an absent or meaningless distance so the page shows nothing", () => {
    expect(distanceInKm(null)).toBeNull();
    expect(distanceInKm(0)).toBeNull();
    expect(distanceInKm(-1)).toBeNull();
  });

  it("uses the locale's decimal separator, comma in Romanian and dot in English", () => {
    const km = distanceInKm(14500);
    expect(km).not.toBeNull();
    const value = km as number;

    // This is why distanceInKm returns a number rather than a preformatted string: a string
    // built with toFixed would show "14.5" to a Romanian reader, where the separator is ",".
    expect(new Intl.NumberFormat(ro, { maximumFractionDigits: 1 }).format(value)).toBe("14,5");
    expect(new Intl.NumberFormat(en, { maximumFractionDigits: 1 }).format(value)).toBe("14.5");
  });

  it("formats a whole number without a stray decimal in either locale", () => {
    for (const locale of [ro, en]) {
      expect(
        new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(distanceInKm(8000) ?? 0),
      ).toBe("8");
    }
  });
});
