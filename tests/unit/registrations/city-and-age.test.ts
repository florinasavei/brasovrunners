import { describe, expect, it } from "vitest";
import { ageOnRaceDay } from "@/modules/registrations/domain/age";
import { cityLabel } from "@/modules/registrations/domain/city-label";

/**
 * BR-REQ-037-03 — the registrations list's «Oraș» and «Vârstă» (§NNN): the two pure helpers the list's
 * cells, its phone row and the export read.
 */
describe("§NNN «Oraș»: the city, and the country's code only when it is not Romania", () => {
  it("a Romanian city reads as typed, without a code", () => {
    expect(cityLabel("Brașov", "RO")).toBe("Brașov");
  });

  it("a city abroad carries its country's code in brackets", () => {
    expect(cityLabel("Bristol", "GB")).toBe("Bristol (GB)");
    expect(cityLabel(" Wien ", "at")).toBe("Wien (AT)");
  });

  it("is empty with no city, whatever the country", () => {
    expect(cityLabel(null, "GB")).toBe("");
    expect(cityLabel("   ", "RO")).toBe("");
    expect(cityLabel(undefined, null)).toBe("");
  });

  it("a city with no country recorded reads as typed", () => {
    expect(cityLabel("Cluj-Napoca", null)).toBe("Cluj-Napoca");
  });
});

describe("§NNN «Vârstă»: the age on the event's day, on the event's clock", () => {
  // 21 November, 08:00 in Brașov.
  const raceStart = new Date("2026-11-21T06:00:00.000Z");

  it("counts a birthday on the event's day, and not one the day after", () => {
    expect(ageOnRaceDay("2008-11-21", raceStart, "Europe/Bucharest")).toBe(18);
    expect(ageOnRaceDay("2008-11-22", raceStart, "Europe/Bucharest")).toBe(17);
  });

  it("is the event's day, not today's: somebody who is 17 now is 18 on a race after their birthday", () => {
    const later = new Date("2027-05-01T07:00:00.000Z");
    expect(ageOnRaceDay("2009-01-15", raceStart, "Europe/Bucharest")).toBe(17);
    expect(ageOnRaceDay("2009-01-15", later, "Europe/Bucharest")).toBe(18);
  });

  it("reads the day on the start line's clock: 00:30 in Brașov is still the previous day in UTC", () => {
    const pastMidnight = new Date("2026-11-20T22:30:00.000Z");
    expect(ageOnRaceDay("2008-11-21", pastMidnight, "Europe/Bucharest")).toBe(18);
    expect(ageOnRaceDay("2008-11-21", pastMidnight, "UTC")).toBe(17);
  });

  it("is null with no birth date", () => {
    expect(ageOnRaceDay(null, raceStart, "Europe/Bucharest")).toBeNull();
  });
});
