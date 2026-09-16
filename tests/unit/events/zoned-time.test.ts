import { describe, expect, it } from "vitest";
import { fromWallTimeInput, toWallTimeInput } from "@/modules/events/domain/zoned-time";

/**
 * BR-REQ-011-01 — an event's times.
 *
 * An organizer types a wall-clock time and means it in Brașov. Everything between the form and
 * the database has to preserve that, and the interesting cases are the two Sundays a year when
 * the offset changes — which in Romania is exactly when the spring and autumn races are held.
 */

const BUCHAREST = "Europe/Bucharest";

describe("BR-REQ-011-01 wall-clock time in the event timezone", () => {
  it("reads a summer time as UTC+3", () => {
    // 11 October 2026 is still summer time in Romania: 09:00 local is 06:00 UTC.
    const instant = fromWallTimeInput("2026-10-11T09:00", BUCHAREST);
    expect(instant?.toISOString()).toBe("2026-10-11T06:00:00.000Z");
  });

  it("reads a winter time as UTC+2", () => {
    // 6 December 2026 is winter time: 09:00 local is 07:00 UTC.
    const instant = fromWallTimeInput("2026-12-06T09:00", BUCHAREST);
    expect(instant?.toISOString()).toBe("2026-12-06T07:00:00.000Z");
  });

  it("gets the morning of the spring change right", () => {
    // Clocks go forward at 03:00 local on 29 March 2026. An 08:00 start that morning is
    // already on the new offset, so it is 05:00 UTC — the case a single-pass conversion,
    // using the offset of the day before, gets wrong by an hour.
    const instant = fromWallTimeInput("2026-03-29T08:00", BUCHAREST);
    expect(instant?.toISOString()).toBe("2026-03-29T05:00:00.000Z");
  });

  it("gets the morning of the autumn change right", () => {
    // Clocks go back at 04:00 local on 25 October 2026; an 08:00 start is on UTC+2.
    const instant = fromWallTimeInput("2026-10-25T08:00", BUCHAREST);
    expect(instant?.toISOString()).toBe("2026-10-25T06:00:00.000Z");
  });

  it("accepts a value that carries seconds and one that does not", () => {
    expect(fromWallTimeInput("2026-10-11T09:00:00", BUCHAREST)?.toISOString()).toBe(
      "2026-10-11T06:00:00.000Z",
    );
  });

  it("treats an empty field as no time at all rather than as midnight", () => {
    expect(fromWallTimeInput("", BUCHAREST)).toBeNull();
    expect(fromWallTimeInput("   ", BUCHAREST)).toBeNull();
  });

  it("refuses a value that is not a date and time", () => {
    // Returned as null so the caller reports a validation error, rather than storing an
    // Invalid Date that becomes NULL or 1970 depending on the driver.
    expect(fromWallTimeInput("tomorrow at ten", BUCHAREST)).toBeNull();
    expect(fromWallTimeInput("2026-10-11", BUCHAREST)).toBeNull();
  });

  it("renders an instant back into the form as local wall time", () => {
    expect(toWallTimeInput(new Date("2026-10-11T06:00:00Z"), BUCHAREST)).toBe("2026-10-11T09:00");
    expect(toWallTimeInput(new Date("2026-12-06T07:00:00Z"), BUCHAREST)).toBe("2026-12-06T09:00");
  });

  it("renders nothing for a time that is not set", () => {
    expect(toWallTimeInput(null, BUCHAREST)).toBe("");
  });

  it("round-trips every value the form can produce", () => {
    for (const wall of [
      "2026-01-01T00:00",
      "2026-03-29T08:00",
      "2026-06-15T18:30",
      "2026-10-25T08:00",
      "2026-12-31T23:59",
    ]) {
      const instant = fromWallTimeInput(wall, BUCHAREST);
      expect(instant, wall).not.toBeNull();
      expect(toWallTimeInput(instant, BUCHAREST), wall).toBe(wall);
    }
  });
});
