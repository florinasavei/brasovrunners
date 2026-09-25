import { describe, expect, it } from "vitest";
import { raceWeek } from "@/modules/events/domain/race-week";
import {
  changedDeadlines,
  DEADLINE_KEYS,
  DEADLINE_RULES,
  DEFAULT_DEADLINES,
  deadlinesSettingSchema,
  declarationHoldEndsAt,
  emailLinkExpiresAt,
  EVENT_REMINDER_CHOICES,
  EVENT_REMINDER_MAX_HOURS,
  offerEndsAt,
  readDeadlinesValue,
  reminderHoursFor,
  reminderOpensAt,
  selfCheckinOpensAt,
  seriesHorizonEnd,
  withinRaceWeek,
} from "@/modules/deadlines/domain/deadlines";

/**
 * §377 — the club's deadlines ("Termene"): one setting for the seven participant-facing timings
 * that were constants. What is protected here: unset means exactly the constants they replaced,
 * so nothing changes on a deployment until an Administrator changes it; a save is refused outside
 * the bounds, blank, fractional or with a key this code does not know; a stored value this code
 * cannot read falls back field by field; and each timing function is the only arithmetic on its
 * number.
 */
const NOW = new Date("2026-10-01T10:00:00.000Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("§377 the club's deadlines, unset", () => {
  it("are the constants they replaced: 48 h link, 30 min hold, 24 h offer, 48 h reminder, 24 h check-in, 7-day race week, 56-day horizon", () => {
    expect(DEFAULT_DEADLINES).toEqual({
      confirmationHours: 48,
      holdMinutes: 30,
      offerHours: 24,
      reminderHours: 48,
      selfCheckinHours: 24,
      raceWeekDays: 7,
      seriesHorizonDays: 56,
    });
  });

  it("keep every default inside its own bounds, and the event's column bounds equal the club's", () => {
    for (const key of DEADLINE_KEYS) {
      const rule = DEADLINE_RULES[key];
      expect(rule.default, key).toBeGreaterThanOrEqual(rule.min);
      expect(rule.default, key).toBeLessThanOrEqual(rule.max);
    }
    expect(EVENT_REMINDER_MAX_HOURS).toBe(168);
    expect([...EVENT_REMINDER_CHOICES]).toEqual([24, 48, 72]);
  });

  it("keep a declaration hold well under a day, which is what tells it apart from a window's hold (§104)", () => {
    expect(DEADLINE_RULES.holdMinutes.max * MINUTE).toBeLessThan(DAY);
  });
});

describe("§377 a save", () => {
  const valid = { ...DEFAULT_DEADLINES };

  it("takes whole numbers or the digits a form box posts", () => {
    expect(deadlinesSettingSchema.parse(valid)).toEqual(valid);
    const posted = Object.fromEntries(DEADLINE_KEYS.map((key) => [key, ` ${DEFAULT_DEADLINES[key]} `]));
    expect(deadlinesSettingSchema.parse(posted)).toEqual(valid);
  });

  it("accepts each bound itself and refuses one past it, on both sides", () => {
    for (const key of DEADLINE_KEYS) {
      const { min, max } = DEADLINE_RULES[key];
      expect(deadlinesSettingSchema.safeParse({ ...valid, [key]: min }).success, `${key} = ${min}`).toBe(true);
      expect(deadlinesSettingSchema.safeParse({ ...valid, [key]: max }).success, `${key} = ${max}`).toBe(true);
      expect(deadlinesSettingSchema.safeParse({ ...valid, [key]: min - 1 }).success, `${key} = ${min - 1}`).toBe(false);
      expect(deadlinesSettingSchema.safeParse({ ...valid, [key]: max + 1 }).success, `${key} = ${max + 1}`).toBe(false);
    }
  });

  it("refuses a blank box rather than reading it as zero — zero is 'no reminder', which nobody chooses by clearing a box", () => {
    expect(deadlinesSettingSchema.safeParse({ ...valid, reminderHours: "" }).success).toBe(false);
    expect(deadlinesSettingSchema.safeParse({ ...valid, raceWeekDays: "  " }).success).toBe(false);
  });

  it("refuses fractions, words, a missing deadline and a key this code does not know", () => {
    expect(deadlinesSettingSchema.safeParse({ ...valid, holdMinutes: 30.5 }).success).toBe(false);
    expect(deadlinesSettingSchema.safeParse({ ...valid, holdMinutes: "30.5" }).success).toBe(false);
    expect(deadlinesSettingSchema.safeParse({ ...valid, offerHours: "a day" }).success).toBe(false);
    const withoutHold: Record<string, number> = { ...valid };
    delete withoutHold.holdMinutes;
    expect(deadlinesSettingSchema.safeParse(withoutHold).success).toBe(false);
    expect(deadlinesSettingSchema.safeParse({ ...valid, tokenHours: 24 }).success).toBe(false);
  });
});

describe("§377 a stored value this code cannot fully read", () => {
  it("is today's constants when absent or not an object", () => {
    expect(readDeadlinesValue(null)).toEqual(DEFAULT_DEADLINES);
    expect(readDeadlinesValue("48")).toEqual(DEFAULT_DEADLINES);
    expect(readDeadlinesValue([1, 2])).toEqual(DEFAULT_DEADLINES);
  });

  it("keeps every field it can read and falls back only where it cannot, field by field", () => {
    expect(readDeadlinesValue({ holdMinutes: 20, offerHours: 500, reminderHours: "72", raceWeekDays: 3.5, renamed: 9 })).toEqual({
      ...DEFAULT_DEADLINES,
      holdMinutes: 20,
    });
    expect(readDeadlinesValue({ reminderHours: 0, raceWeekDays: 0 })).toEqual({ ...DEFAULT_DEADLINES, reminderHours: 0, raceWeekDays: 0 });
  });

  it("names exactly the deadlines that moved, for the audit row", () => {
    expect(changedDeadlines(DEFAULT_DEADLINES, DEFAULT_DEADLINES)).toEqual([]);
    expect(changedDeadlines(DEFAULT_DEADLINES, { ...DEFAULT_DEADLINES, holdMinutes: 15, reminderHours: 0 })).toEqual(["holdMinutes", "reminderHours"]);
  });
});

describe("§377 the timings: one function each, the only arithmetic on these numbers", () => {
  it("the email link lapses the club's hours after now", () => {
    expect(emailLinkExpiresAt(NOW, DEFAULT_DEADLINES)).toEqual(new Date(NOW.getTime() + 48 * HOUR));
    expect(emailLinkExpiresAt(NOW, { confirmationHours: 12 })).toEqual(new Date(NOW.getTime() + 12 * HOUR));
  });

  it("a declaration hold and an offer end their natural length after now", () => {
    expect(declarationHoldEndsAt(NOW, { holdMinutes: 45 })).toEqual(new Date(NOW.getTime() + 45 * MINUTE));
    expect(offerEndsAt(NOW, { offerHours: 6 })).toEqual(new Date(NOW.getTime() + 6 * HOUR));
  });

  it("the reminder lead is the event's own, else the club's, and zero from either is none", () => {
    expect(reminderHoursFor({ reminderHoursBefore: null }, { reminderHours: 48 })).toBe(48);
    expect(reminderHoursFor({}, { reminderHours: 36 })).toBe(36);
    expect(reminderHoursFor({ reminderHoursBefore: 72 }, { reminderHours: 48 })).toBe(72);
    expect(reminderHoursFor({ reminderHoursBefore: 0 }, { reminderHours: 48 })).toBe(0);
    expect(reminderHoursFor({ reminderHoursBefore: null }, { reminderHours: 0 })).toBe(0);
    expect(reminderHoursFor({ reminderHoursBefore: 24 }, { reminderHours: 0 })).toBe(24);
    const start = new Date("2026-10-11T06:00:00.000Z");
    expect(reminderOpensAt(start, 48)).toEqual(new Date(start.getTime() - 2 * DAY));
    expect(reminderOpensAt(start, 0)).toBeNull();
  });

  it("'I am here' opens the club's hours before the start", () => {
    const start = new Date("2026-10-11T06:00:00.000Z");
    expect(selfCheckinOpensAt(start, DEFAULT_DEADLINES)).toEqual(new Date(start.getTime() - DAY));
    expect(selfCheckinOpensAt(start, { selfCheckinHours: 3 })).toEqual(new Date(start.getTime() - 3 * HOUR));
  });

  it("race week, for the backoffice, is the club's days before a start still ahead", () => {
    const at = (startsAt: Date) => ({ startsAt, timezone: "Europe/Bucharest" });
    const start = new Date(NOW.getTime() + 6 * DAY);
    expect(withinRaceWeek(at(start), NOW, DEFAULT_DEADLINES)).toBe(true);
    expect(withinRaceWeek(at(start), NOW, { raceWeekDays: 5 })).toBe(false);
    expect(withinRaceWeek(at(new Date(NOW.getTime() - HOUR)), NOW, DEFAULT_DEADLINES)).toBe(false);
  });

  it("race week counts calendar days on the event's wall clock, as the public countdown does (§377)", () => {
    const zone = "Europe/Bucharest";
    // Saturday 07:00 in Brașov (05:00 UTC in November); the race-day morning and the evening before.
    const race = { startsAt: new Date("2026-11-21T05:00:00.000Z"), timezone: zone };
    const raceMorning = new Date("2026-11-21T04:30:00.000Z"); // 06:30 Brașov, same day
    const fridayLate = new Date("2026-11-20T21:59:00.000Z"); // 23:59 Brașov, the day before
    // 0 = on race day only: the day before is out, although the start is barely seven hours away.
    expect(withinRaceWeek(race, raceMorning, { raceWeekDays: 0 })).toBe(true);
    expect(withinRaceWeek(race, fridayLate, { raceWeekDays: 0 })).toBe(false);
    expect(raceWeek(race, fridayLate, { raceWeekDays: 0 })).toBeNull();
    // The boundary day: seven calendar days before is in at any hour, eight is out — at 00:01 and
    // at 23:59 alike, which elapsed time would split.
    const sevenBeforeEarly = new Date("2026-11-13T22:01:00.000Z"); // Sat 14 Nov 00:01 Brașov
    const eightBeforeLate = new Date("2026-11-13T21:59:00.000Z"); // Fri 13 Nov 23:59 Brașov
    expect(withinRaceWeek(race, sevenBeforeEarly, DEFAULT_DEADLINES)).toBe(true);
    expect(withinRaceWeek(race, eightBeforeLate, DEFAULT_DEADLINES)).toBe(false);
    for (const now of [raceMorning, fridayLate, sevenBeforeEarly, eightBeforeLate]) {
      for (const raceWeekDays of [0, 1, 7]) expect(withinRaceWeek(race, now, { raceWeekDays })).toBe(raceWeek(race, now, { raceWeekDays }) !== null);
    }
    // Started: out, whatever the number.
    expect(withinRaceWeek(race, new Date("2026-11-21T05:01:00.000Z"), { raceWeekDays: 0 })).toBe(false);
  });

  it("a series is created up to the club's horizon", () => {
    expect(seriesHorizonEnd(NOW, DEFAULT_DEADLINES)).toEqual(new Date(NOW.getTime() + 56 * DAY));
    expect(seriesHorizonEnd(NOW, { seriesHorizonDays: 14 })).toEqual(new Date(NOW.getTime() + 14 * DAY));
  });
});
