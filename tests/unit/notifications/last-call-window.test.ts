import { describe, expect, it } from "vitest";
import { DEFAULT_DEADLINES } from "@/modules/deadlines/domain/deadlines";
import {
  AUTOMATIC_SEND_KEYS,
  declarationLastCallDueAt,
  isDeclarationLastCallDue,
  lastCallDeadline,
  lastCallKey,
  windowLastCallAt,
} from "@/modules/notifications/domain/automatic-sends";

/**
 * §NNN (amending §160, §377) — the last call to sign follows the participation window's deadline,
 * not the start. The owner's race: 21 Nov at 10:00, the window 15 / 5 (deadline 16 Nov 10:00), the
 * reminder three days before the start. Until §NNN the last call went at the reminder's lead — two
 * days after every window hold had lapsed.
 */
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const START = new Date("2026-11-21T08:00:00.000Z");
const before = (ms: number) => new Date(START.getTime() - ms);
const DEADLINE = before(5 * DAY);
const race = { startsAt: START, reminderHoursBefore: 72, confirmationOpensDaysBefore: 15, confirmationDeadlineDaysBefore: 5 };
const held = { ...race, holdExpiresAt: DEADLINE };

describe("§NNN the last call before a window's deadline", () => {
  it("goes 48 hours before the deadline to a row held until it, and only between then and the deadline", () => {
    expect(lastCallDeadline(held)).toEqual(DEADLINE);
    expect(declarationLastCallDueAt(held, DEFAULT_DEADLINES)).toEqual(new Date(DEADLINE.getTime() - 48 * HOUR));
    expect(isDeclarationLastCallDue(held, new Date(DEADLINE.getTime() - 48 * HOUR - 1), DEFAULT_DEADLINES)).toBe(false);
    expect(isDeclarationLastCallDue(held, new Date(DEADLINE.getTime() - 48 * HOUR), DEFAULT_DEADLINES)).toBe(true);
    expect(isDeclarationLastCallDue(held, new Date(DEADLINE.getTime() - 1), DEFAULT_DEADLINES)).toBe(true);
    // At and after the deadline nothing more: not even at the reminder's lead before the start.
    expect(isDeclarationLastCallDue(held, DEADLINE, DEFAULT_DEADLINES)).toBe(false);
    expect(isDeclarationLastCallDue(held, before(3 * DAY), DEFAULT_DEADLINES)).toBe(false);
  });

  it("is keyed by the deadline, so a moved deadline earns one more and the same one never two", () => {
    expect(lastCallKey("r1", held)).toBe(`registration:r1:sign-reminder:${DEADLINE.toISOString()}`);
    const moved = { ...race, confirmationDeadlineDaysBefore: 4, holdExpiresAt: before(4 * DAY) };
    expect(lastCallKey("r1", moved)).toBe(`registration:r1:sign-reminder:${before(4 * DAY).toISOString()}`);
    expect(lastCallKey("r1", moved)).not.toBe(lastCallKey("r1", held));
  });

  it("follows «Termene» lastCallHours, and 0 sends none before the deadline", () => {
    expect(declarationLastCallDueAt(held, { ...DEFAULT_DEADLINES, lastCallHours: 24 })).toEqual(new Date(DEADLINE.getTime() - 24 * HOUR));
    expect(declarationLastCallDueAt(held, { ...DEFAULT_DEADLINES, lastCallHours: 0 })).toBeNull();
    expect(isDeclarationLastCallDue(held, before(3 * DAY), { ...DEFAULT_DEADLINES, lastCallHours: 0 })).toBe(false);
  });

  it("goes nowhere at or before the window's opening: the window's own ask is the call there", () => {
    const short = { ...race, confirmationOpensDaysBefore: 7, holdExpiresAt: DEADLINE };
    expect(windowLastCallAt(short, DEFAULT_DEADLINES)).toBeNull();
    expect(windowLastCallAt(short, { lastCallHours: 47 })).toEqual(new Date(DEADLINE.getTime() - 47 * HOUR));
  });

  it("keeps today's rule — the reminder's lead before the start, the old key — without a window, at a deadline of 0, and for the club's minutes", () => {
    const noWindow = { ...race, confirmationOpensDaysBefore: 0, holdExpiresAt: DEADLINE };
    const atStart = { ...race, confirmationDeadlineDaysBefore: 0, holdExpiresAt: START };
    const clubMinutes = { ...race, holdExpiresAt: new Date(DEADLINE.getTime() + 30 * 60_000) };
    for (const candidate of [noWindow, atStart, clubMinutes]) {
      expect(lastCallDeadline(candidate)).toBeNull();
      expect(declarationLastCallDueAt(candidate, DEFAULT_DEADLINES)).toEqual(before(72 * HOUR));
      expect(lastCallKey("r1", candidate)).toBe(AUTOMATIC_SEND_KEYS.lastCall("r1"));
      expect(lastCallKey("r1", candidate)).toBe("registration:r1:sign-reminder");
    }
    // A caller with no window to hand (the job's plan per event) reads the same start rule.
    expect(declarationLastCallDueAt({ startsAt: START, reminderHoursBefore: 72 }, DEFAULT_DEADLINES)).toEqual(before(72 * HOUR));
  });
});
