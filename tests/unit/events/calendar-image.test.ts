import { describe, expect, it } from "vitest";
import type { PublicEvent } from "@/modules/events/repository";
import { calendarImageRows } from "@/modules/events/domain/calendar-image-rows";
import { fitText, paletteFor, wrapText } from "@/modules/events/ui/calendar-image-draw";

/**
 * «Salvează ca imagine» (§NNN; the owner, 2026-10-27): the month as a picture, drawn in the browser. The pure
 * halves: which day each date falls on and what repeats, and the words cut to the room a cell gives them.
 */

/** A measure of ten units per character: a line of `width` holds `width / 10` characters. */
const ctx = { measureText: (text: string) => ({ width: [...text].length * 10 }) as TextMetrics };

function event(startsAt: string, title: string, overrides: Partial<PublicEvent> = {}): PublicEvent {
  return {
    startsAt: new Date(startsAt),
    timezone: "Europe/Bucharest",
    title,
    type: "GROUP_RUN",
    isSpecial: false,
    eventStatus: "SCHEDULED",
    timeToBeAnnounced: false,
    ...overrides,
  } as PublicEvent;
}

describe("the month's rows", () => {
  const rows = calendarImageRows(
    { year: 2026, month: 6 },
    [
      event("2026-06-08T15:30:00Z", "Happy Monday"),
      event("2026-06-01T15:30:00Z", "Happy Monday"),
      event("2026-06-05T15:00:00Z", "Girls only shake out run", { isSpecial: true }),
      // The club's day, not UTC's: 23:30 UTC on 30 June is 1 July in Brașov — next month's.
      event("2026-06-30T23:30:00Z", "Night run"),
      event("2026-07-02T15:00:00Z", "July"),
    ],
    () => "18:30",
  );

  it("puts each date on its day in the club's zone, soonest first, and leaves out the other months", () => {
    expect(rows.entries.map((entry) => [entry.day, entry.title])).toEqual([
      [1, "Happy Monday"],
      [5, "Girls only shake out run"],
      [8, "Happy Monday"],
    ]);
  });

  it("tells what repeats in the month from what stands alone", () => {
    expect(rows.series.map((members) => members.map((member) => member.title))).toEqual([["Happy Monday", "Happy Monday"]]);
    expect(rows.singles.map((member) => member.title)).toEqual(["Girls only shake out run"]);
  });

  it("says no hour for a date whose hour is to be announced, and marks a cancelled one", () => {
    const [entry] = calendarImageRows({ year: 2026, month: 6 }, [event("2026-06-03T09:00:00Z", "Tură", { timeToBeAnnounced: true, eventStatus: "CANCELLED" })], () => "12:00").entries;
    expect(entry).toMatchObject({ time: null, cancelled: true });
  });
});

describe("the words in a cell", () => {
  it("keeps what fits and cuts the rest with «…»", () => {
    expect(fitText(ctx, "Happy Monday", 200)).toBe("Happy Monday");
    expect(fitText(ctx, "Happy Monday", 60)).toBe("Happy…");
  });

  it("breaks a title at spaces, and the last line allowed says it was cut", () => {
    expect(wrapText(ctx, "Happy Monday with Brașov Runners", 130, 3)).toEqual(["Happy Monday", "with Brașov", "Runners"]);
    expect(wrapText(ctx, "Happy Monday with Brașov Runners", 130, 2)).toEqual(["Happy Monday", "with Brașov…"]);
    expect(wrapText(ctx, "Happy Monday with Brașov Runners", 130, 1)).toEqual(["Happy Monday…"]);
  });
});

describe("«Sezonul lunii»", () => {
  it("draws each month in its season's palette", () => {
    expect([1, 3, 6, 9, 12].map((month) => paletteFor("season", month))).toEqual(["winter", "spring", "summer", "autumn", "winter"]);
    expect(paletteFor("dark", 6)).toBe("dark");
  });
});
