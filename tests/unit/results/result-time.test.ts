import { describe, expect, it } from "vitest";
import { formatResultTime, parseResultTime, RESULT_TIME_MAX_MS } from "@/modules/results/domain/result-time";

/**
 * §NNN, BR-REQ-050-02 — a race time as the club types it (`h:mm:ss`, `m:ss`, `mm:ss.t`) and as the page says it. Stored as whole
 * milliseconds from the gun; read in the three shapes a stopwatch and a timing sheet use, refused for anything else.
 */
const sec = (n: number) => n * 1000;

describe("§NNN parseResultTime", () => {
  it("reads h:mm:ss", () => {
    expect(parseResultTime("1:23:45")).toBe(sec(1 * 3600 + 23 * 60 + 45));
    expect(parseResultTime("0:45:12")).toBe(sec(45 * 60 + 12));
    expect(parseResultTime("12:00:00")).toBe(sec(12 * 3600));
  });

  it("reads m:ss and mm:ss, the minutes passing sixty where there is no hour", () => {
    expect(parseResultTime("9:05")).toBe(sec(9 * 60 + 5));
    expect(parseResultTime("45:12")).toBe(sec(45 * 60 + 12));
    expect(parseResultTime("125:30")).toBe(sec(2 * 3600 + 5 * 60 + 30));
  });

  it("reads a fraction of a second after a dot or a comma, up to three digits", () => {
    expect(parseResultTime("45:12.3")).toBe(sec(45 * 60 + 12) + 300);
    expect(parseResultTime("45:12,25")).toBe(sec(45 * 60 + 12) + 250);
    expect(parseResultTime("1:23:45.125")).toBe(sec(1 * 3600 + 23 * 60 + 45) + 125);
  });

  it("trims what was typed", () => {
    expect(parseResultTime("  45:12  ")).toBe(sec(45 * 60 + 12));
  });

  it("refuses what is not a time", () => {
    for (const text of ["", "   ", "abc", "45", "45:1", "1:2:3", "1:5:30", "1:60:00", "1:23:60", "45:60", "12:34:56:78", "-1:00", "0:00", "0:00:00", "1h23m", "45:12.1234", null, undefined]) {
      expect(parseResultTime(text as string | null | undefined), String(text)).toBeNull();
    }
  });

  it("refuses a time past two days, a typo rather than a result", () => {
    expect(parseResultTime("48:00:00")).toBe(RESULT_TIME_MAX_MS);
    expect(parseResultTime("48:00:01")).toBeNull();
    expect(parseResultTime("99:59:59")).toBeNull();
  });
});

describe("§NNN formatResultTime", () => {
  it("says h:mm:ss, with a fraction only when there is one", () => {
    expect(formatResultTime(sec(45 * 60 + 12))).toBe("0:45:12");
    expect(formatResultTime(sec(3600 + 23 * 60 + 45))).toBe("1:23:45");
    expect(formatResultTime(sec(45 * 60 + 12) + 300)).toBe("0:45:12.3");
    expect(formatResultTime(sec(45 * 60 + 12) + 25)).toBe("0:45:12.025");
  });

  it("says nothing for no time", () => {
    expect(formatResultTime(null)).toBe("");
    expect(formatResultTime(undefined)).toBe("");
    expect(formatResultTime(-1)).toBe("");
  });

  it("round-trips: a save of what the page drew changes nothing", () => {
    for (const ms of [1000, 59_999, 60_000, sec(45 * 60 + 12) + 300, sec(3600 + 5), sec(10 * 3600 + 59 * 60 + 59) + 999]) {
      expect(parseResultTime(formatResultTime(ms)), String(ms)).toBe(ms);
    }
  });
});
