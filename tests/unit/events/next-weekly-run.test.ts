import { describe, expect, it } from "vitest";
import { nextWeeklyRun, type WeeklyRunCandidate } from "@/modules/events/domain/next-weekly-run";

/**
 * §708 — where «Vino cu noi» goes: the soonest date, still going ahead, of a series that recurs every
 * week, as the listing recognises a series (the same type and title); nothing otherwise, and the
 * header links the listing.
 */
const ZONE = "Europe/Bucharest";
const row = (title: string, startsAt: string, extra: Partial<WeeklyRunCandidate> = {}): WeeklyRunCandidate => ({
  type: "GROUP_RUN",
  title,
  startsAt: new Date(startsAt),
  slug: `${title.toLowerCase().replace(/\s+/g, "-")}-${startsAt.slice(0, 10)}`,
  timezone: ZONE,
  eventStatus: "SCHEDULED",
  ...extra,
});

describe("§708 the next weekly run", () => {
  it("is the soonest date of a weekly series, whatever order the rows came in", () => {
    const rows = [
      row("Alergare de probă", "2026-10-20T16:00:00.000Z"),
      row("Alergare de probă", "2026-10-13T16:00:00.000Z"),
      row("Alergare de probă", "2026-10-27T16:00:00.000Z"),
    ];
    expect(nextWeeklyRun(rows)?.slug).toBe("alergare-de-probă-2026-10-13");
  });

  it("is never a one-off, a race on its own, or a fortnightly series", () => {
    const race = row("Cursa de probă", "2026-10-12T07:00:00.000Z", { type: "RACE" });
    const fortnightly = [row("Tura lungă", "2026-10-14T06:00:00.000Z"), row("Tura lungă", "2026-10-28T06:00:00.000Z")];
    expect(nextWeeklyRun([race, ...fortnightly])).toBeNull();
    expect(nextWeeklyRun([])).toBeNull();
  });

  it("skips a cancelled date for the next one of the same series", () => {
    const rows = [
      row("Alergare de probă", "2026-10-13T16:00:00.000Z", { eventStatus: "CANCELLED" }),
      row("Alergare de probă", "2026-10-20T16:00:00.000Z"),
    ];
    expect(nextWeeklyRun(rows)?.slug).toBe("alergare-de-probă-2026-10-20");
  });

  it("takes the sooner of two weekly series, and leaves a sooner one-off aside", () => {
    const rows = [
      row("Alergare de probă", "2026-10-15T16:00:00.000Z"),
      row("Alergare de probă", "2026-10-22T16:00:00.000Z"),
      row("Tura de dimineață", "2026-10-13T05:00:00.000Z"),
      row("Tura de dimineață", "2026-10-20T05:00:00.000Z"),
      row("Ieșire specială", "2026-10-12T05:00:00.000Z"),
    ];
    expect(nextWeeklyRun(rows)?.title).toBe("Tura de dimineață");
    expect(nextWeeklyRun(rows)?.startsAt.toISOString()).toBe("2026-10-13T05:00:00.000Z");
  });
});
