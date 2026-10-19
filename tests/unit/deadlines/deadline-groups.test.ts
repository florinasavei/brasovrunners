import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import {
  DEADLINE_GROUPS,
  DEADLINE_KEYS,
  DEADLINE_RULES,
} from "@/modules/deadlines/domain/deadlines";
import { deadlineDuration } from "@/modules/deadlines/domain/duration-words";

/**
 * §377 (amended) — «Termene» in seven named folds (the owner, 2026-10-18: «partea asta de termene
 * trebuie grupată mai bine»). Which box sits in which fold is data in the domain; the words of the
 * folds and of their closed lines are the catalogue's, in both languages.
 */
describe("§377 the deadline groups", () => {
  it("puts every deadline in exactly one group, and no group holds a key that is not a deadline", () => {
    const placed = DEADLINE_GROUPS.flatMap((group) => [...group.fields]);
    for (const key of DEADLINE_KEYS) expect(placed.filter((candidate) => candidate === key), key).toHaveLength(1);
    expect(placed).toHaveLength(DEADLINE_KEYS.length);
    for (const key of placed) expect(DEADLINE_KEYS as readonly string[], key).toContain(key);
  });

  it("is seven non-empty groups with distinct keys, in the order the screen draws them", () => {
    expect(DEADLINE_GROUPS.map((group) => group.key)).toEqual([
      "confirmation",
      "hold",
      "beforeStart",
      "afterEvent",
      "series",
      "family",
      "outage",
    ]);
    for (const group of DEADLINE_GROUPS) expect(group.fields.length, group.key).toBeGreaterThan(0);
  });

  it("keeps the boxes of each fold as the owner's brief names them", () => {
    const byGroup = Object.fromEntries(DEADLINE_GROUPS.map((group) => [group.key, [...group.fields]]));
    expect(byGroup).toEqual({
      confirmation: ["confirmationHours", "verificationRetryHours", "verificationRetries"],
      hold: ["holdMinutes", "offerHours"],
      beforeStart: ["reminderHours", "lastCallHours", "selfCheckinHours", "raceWeekDays", "rsvpAskDaysBefore", "rsvpAskHour"],
      afterEvent: ["publicListDays"],
      series: ["seriesHorizonDays"],
      family: ["familySittingMinutes"],
      outage: ["outageGraceMaxHours"],
    });
  });

  it("has a title and a sentence for every group, and a short line for every deadline, in both catalogues", () => {
    for (const messages of [ro, en]) {
      const deadlines = messages.Admin.emails.deadlines;
      for (const group of DEADLINE_GROUPS) {
        const words = deadlines.groups[group.key];
        expect(words.title, group.key).toBeTruthy();
        // A fold of one box has no sentence of its own: its label and help already say it (the screen passes an intro only for two boxes or more).
        if (group.fields.length > 1) {
          expect(words.intro, group.key).toBeTruthy();
          // One sentence of plain words (the plain-words test's 200 characters).
          expect(words.intro.length, group.key).toBeLessThanOrEqual(200);
        }
      }
      for (const key of DEADLINE_KEYS) expect(deadlines.short[key], key).toContain("{value}");
      for (const form of ["one", "few", "other"] as const) expect(deadlines.differsCount[form], form).toContain("{count}");
    }
  });

  it("has a zero-line for exactly the deadlines that accept zero", () => {
    // A time of day (`hourOfDay`, §NNN) accepts zero as midnight, a real answer, never «none»: it has no zero-line, `deadlineDuration` says "00:00".
    const acceptZero = DEADLINE_KEYS.filter((key) => DEADLINE_RULES[key].min === 0 && DEADLINE_RULES[key].unit !== "hourOfDay").sort();
    for (const messages of [ro, en]) expect(Object.keys(messages.Admin.emails.deadlines.shortZero).sort()).toEqual(acceptZero);
  });
});

describe("§377 a deadline's value in the house's words, for a fold's closed line", () => {
  it("says hours, minutes, leads and days the way the sentences that state them do", () => {
    expect(deadlineDuration("ro", "confirmationHours", 48)).toBe("48 de ore");
    expect(deadlineDuration("ro", "holdMinutes", 120)).toBe("2 ore");
    expect(deadlineDuration("ro", "holdMinutes", 30)).toBe("30 de minute");
    expect(deadlineDuration("ro", "reminderHours", 48)).toBe("2 zile");
    expect(deadlineDuration("ro", "selfCheckinHours", 24)).toBe("o zi");
    expect(deadlineDuration("ro", "seriesHorizonDays", 56)).toBe("8 săptămâni");
    expect(deadlineDuration("ro", "publicListDays", 30)).toBe("30 de zile");
    expect(deadlineDuration("en", "offerHours", 24)).toBe("24 hours");
    expect(deadlineDuration("en", "reminderHours", 72)).toBe("3 days");
    expect(deadlineDuration("en", "familySittingMinutes", 1)).toBe("one minute");
  });

  it("leaves zero to the catalogue: it is «none», or «race day only», never «0 ore»", () => {
    for (const key of DEADLINE_KEYS) {
      if (key === "verificationRetries" || key === "rsvpAskHour") continue;
      expect(deadlineDuration("ro", key, 0), key).toBeNull();
    }
  });

  it("says the «Vii?» question's days as days and its hour as a clock: zero is midnight, never «none»", () => {
    expect(deadlineDuration("ro", "rsvpAskDaysBefore", 1)).toBe("o zi");
    expect(deadlineDuration("ro", "rsvpAskDaysBefore", 3)).toBe("3 zile");
    expect(deadlineDuration("en", "rsvpAskDaysBefore", 3)).toBe("3 days");
    expect(deadlineDuration("ro", "rsvpAskDaysBefore", 0)).toBeNull();
    expect(deadlineDuration("ro", "rsvpAskHour", 8)).toBe("08:00");
    expect(deadlineDuration("en", "rsvpAskHour", 23)).toBe("23:00");
    expect(deadlineDuration("ro", "rsvpAskHour", 0)).toBe("00:00");
  });
});
