import { describe, expect, it } from "vitest";
import {
  convertDistance,
  convertPace,
  durationSeconds,
  formatDuration,
  KM_PER_MILE,
  parseDecimal,
  parseWhole,
  RACE_DISTANCES,
  solvePace,
  speedPerHour,
  splitDuration,
} from "@/modules/tools/pace";

/**
 * «Unelte» → «Calculator de ritm»: two of distance, time and pace give the third. The arithmetic the
 * island draws, pinned on the numbers a runner knows by heart.
 */
describe("the pace calculator's arithmetic", () => {
  it("reads a distance typed with a comma or a point, and refuses anything else", () => {
    expect(parseDecimal("21,1")).toBe(21.1);
    expect(parseDecimal(" 21.1 ")).toBe(21.1);
    expect(parseDecimal("10")).toBe(10);
    expect(parseDecimal("5.")).toBe(5);
    expect(parseDecimal(",5")).toBe(0.5);
    for (const wrong of ["", "0", "0,0", "-5", "abc", "1,2,3", "1e3", "5 km"]) expect(parseDecimal(wrong), wrong).toBeNull();
  });

  it("reads a duration's boxes: empty is zero, a box may pass 59, the whole must be more than nothing", () => {
    expect(parseWhole("")).toBe(0);
    expect(parseWhole("07")).toBe(7);
    expect(parseWhole("4,5")).toBeNull();
    expect(durationSeconds("1", "52", "30")).toBe(6750);
    expect(durationSeconds("", "90", "")).toBe(5400);
    expect(durationSeconds("", "", "")).toBeNull();
    expect(durationSeconds("0", "0", "0")).toBeNull();
    expect(durationSeconds("", "4x", "")).toBeNull();
  });

  it("works out the pace from a distance and a time", () => {
    const result = solvePace("pace", { distance: 10, timeSeconds: 50 * 60, paceSeconds: null });
    expect(result?.paceSeconds).toBe(300);
    expect(formatDuration(result?.paceSeconds ?? 0)).toBe("5:00");
    expect(speedPerHour(300)).toBe(12);
  });

  it("works out the time from a distance and a pace: a marathon at 5:00 a kilometre", () => {
    const marathon = RACE_DISTANCES.find((race) => race.key === "presetMarathon")?.km ?? 0;
    const result = solvePace("time", { distance: marathon, timeSeconds: null, paceSeconds: 300 });
    expect(formatDuration(result?.timeSeconds ?? 0)).toBe("3:30:59");
  });

  it("works out the distance from a time and a pace", () => {
    expect(solvePace("distance", { distance: null, timeSeconds: 3600, paceSeconds: 240 })?.distance).toBe(15);
  });

  it("answers nothing while one of the two it needs is missing", () => {
    expect(solvePace("pace", { distance: null, timeSeconds: 3000, paceSeconds: 300 })).toBeNull();
    expect(solvePace("time", { distance: 10, timeSeconds: 3000, paceSeconds: null })).toBeNull();
    expect(solvePace("distance", { distance: 10, timeSeconds: null, paceSeconds: 300 })).toBeNull();
  });

  it("rounds a duration to the second where it is shown, carrying into the minute and the hour", () => {
    expect(formatDuration(299.6)).toBe("5:00");
    expect(formatDuration(3599.5)).toBe("1:00:00");
    expect(formatDuration(65)).toBe("1:05");
    expect(splitDuration(6750)).toEqual({ hours: 1, minutes: 52, seconds: 30 });
  });
});

describe("«Unitatea de măsură»: kilometres or miles, the same run in either", () => {
  it("converts a distance by the statute mile, and back to what it was", () => {
    expect(KM_PER_MILE).toBe(1.609344);
    expect(convertDistance(10, "km", "mi")).toBeCloseTo(6.21371, 5);
    expect(convertDistance(42.195, "km", "mi")).toBeCloseTo(26.2188, 4);
    expect(convertDistance(convertDistance(21.0975, "km", "mi"), "mi", "km")).toBeCloseTo(21.0975, 10);
    expect(convertDistance(5, "km", "km")).toBe(5);
  });

  it("converts a pace the other way: 5:00 a kilometre is 8:03 a mile", () => {
    expect(convertPace(300, "km", "mi")).toBeCloseTo(482.8032, 4);
    expect(formatDuration(convertPace(300, "km", "mi"))).toBe("8:03");
    expect(convertPace(convertPace(300, "km", "mi"), "mi", "km")).toBeCloseTo(300, 10);
  });

  it("gives the speed in the unit's own hour: 8:00 a mile is 7.5 mph", () => {
    expect(speedPerHour(480)).toBe(7.5);
  });

  it("takes as long in miles as in kilometres: a marathon at 5:00 a kilometre", () => {
    const inMiles = solvePace("time", { distance: convertDistance(42.195, "km", "mi"), timeSeconds: null, paceSeconds: convertPace(300, "km", "mi") });
    expect(inMiles?.timeSeconds).toBeCloseTo(12658.5, 6);
    expect(formatDuration(inMiles?.timeSeconds ?? 0)).toBe("3:30:59");
  });
});
