import { describe, expect, it } from "vitest";
import { distanceInKm } from "@/modules/events/domain/event-kind";

/**
 * BR-REQ-040-03 — localized formatting.
 *
 * These assert the behaviour the pages depend on, using the same `Intl` primitives next-intl
 * delegates to. The rules being protected are: an event is shown in *its own* timezone rather
 * than the server's or the reader's, each locale gets its own separators, and converting
 * metres for display never changes what is stored.
 */

const ro = "ro-RO";
const en = "en-GB";
const BUCHAREST = "Europe/Bucharest";

function dateTime(locale: string, instant: Date, timeZone: string) {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(instant);
}

function time(locale: string, instant: Date, timeZone: string) {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(instant);
}

describe("BR-REQ-040-03 criterion 1 dates in the event timezone", () => {
  // 05:00 UTC on a September Sunday is 08:00 in Bucharest (UTC+3).
  const instant = new Date("2026-09-20T05:00:00Z");

  it("formats the date in Romanian for a Romanian reader", () => {
    const formatted = dateTime(ro, instant, BUCHAREST);
    expect(formatted).toContain("duminică");
    expect(formatted).toContain("septembrie");
    expect(formatted).toContain("2026");
  });

  it("formats the same instant in English for an English reader", () => {
    const formatted = dateTime(en, instant, BUCHAREST);
    expect(formatted).toContain("Sunday");
    expect(formatted).toContain("September");
  });

  it("uses the event timezone, not UTC, so the start time reads as local", () => {
    expect(time(ro, instant, BUCHAREST)).toBe("08:00");
    // The same instant in UTC is three hours earlier. Showing this would tell a runner in
    // Brașov the wrong time to turn up, which is the failure this rule prevents.
    expect(time(ro, instant, "UTC")).toBe("05:00");
  });

  it("keeps the winter offset correct, so the conversion is not hardcoded", () => {
    const january = new Date("2026-01-15T06:00:00Z");
    // January is UTC+2 in Bucharest.
    expect(time(ro, january, BUCHAREST)).toBe("08:00");
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
