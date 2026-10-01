import { describe, expect, it } from "vitest";
import {
  type EmailDelayFacts,
  isWaitedFor,
  judgeEmailDelay,
  LATE_MARGIN_MINUTES,
  roundUpToFive,
} from "@/modules/notifications/domain/email-delay";

/**
 * §NNN — when the pages that wait for an email say the club's emails are late: the thresholds
 * (the promised wait plus ten minutes, ten under `immediate`), the three reasons in their order,
 * the estimate's arithmetic, and which messages count at all.
 */
const NOW = new Date("2026-10-01T09:30:00.000Z");
const MINUTE = 60_000;
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * MINUTE);
const ahead = (minutes: number) => new Date(NOW.getTime() + minutes * MINUTE);

const facts = (overrides: Partial<EmailDelayFacts> = {}): EmailDelayFacts => ({
  queued: 3,
  queuedOnMailgun: 3,
  aheadOnMailgun: 3,
  oldestWaitingSince: ago(5),
  deferredUntil: null,
  pausedUntil: null,
  hourlyAllowance: 100,
  hourlyRemaining: 60,
  paceBinding: false,
  ...overrides,
});

describe("§NNN judgeEmailDelay", () => {
  it("is quiet when nothing waits, whatever else is true", () => {
    const quiet = judgeEmailDelay(facts({ queued: 0, queuedOnMailgun: 0, oldestWaitingSince: null, pausedUntil: ahead(30), hourlyRemaining: 0 }), 15, NOW);
    expect(quiet).toEqual({ late: false, reason: null, queued: 0, oldestWaitMinutes: 0, estimateMinutes: null });
  });

  it("under the scheduled timing, is late only past the promised wait plus ten minutes", () => {
    expect(LATE_MARGIN_MINUTES).toBe(10);
    expect(judgeEmailDelay(facts({ oldestWaitingSince: ago(25) }), 15, NOW).late).toBe(false);
    const late = judgeEmailDelay(facts({ oldestWaitingSince: ago(26) }), 15, NOW);
    expect(late).toMatchObject({ late: true, reason: "backlog", queued: 3, oldestWaitMinutes: 26 });
    // At night the promise is the hour: seventy minutes, not twenty-five.
    expect(judgeEmailDelay(facts({ oldestWaitingSince: ago(60) }), 60, NOW).late).toBe(false);
    expect(judgeEmailDelay(facts({ oldestWaitingSince: ago(71) }), 60, NOW).reason).toBe("backlog");
  });

  it("under the immediate timing, ten minutes is late", () => {
    expect(judgeEmailDelay(facts({ oldestWaitingSince: ago(10) }), null, NOW).late).toBe(false);
    expect(judgeEmailDelay(facts({ oldestWaitingSince: ago(11) }), null, NOW)).toMatchObject({ late: true, reason: "backlog" });
  });

  it("a Mailgun pause is late at once, and the estimate is the pause's end", () => {
    const paused = judgeEmailDelay(facts({ pausedUntil: ahead(12), oldestWaitingSince: ago(1) }), 15, NOW);
    expect(paused).toEqual({ late: true, reason: "paused", queued: 3, oldestWaitMinutes: 1, estimateMinutes: 15 });
    // A pause that ended, or one with nothing of ours on its road, says nothing.
    expect(judgeEmailDelay(facts({ pausedUntil: ago(1), oldestWaitingSince: ago(1) }), 15, NOW).late).toBe(false);
    expect(judgeEmailDelay(facts({ pausedUntil: ahead(12), queuedOnMailgun: 0, oldestWaitingSince: ago(1) }), 15, NOW).late).toBe(false);
  });

  it("a spent hour is late, and the estimate is the queue at the pace", () => {
    const spent = judgeEmailDelay(facts({ hourlyRemaining: 0, aheadOnMailgun: 150, queued: 120, oldestWaitingSince: ago(2) }), 15, NOW);
    // 150 ÷ 100 × 60 = 90.
    expect(spent).toEqual({ late: true, reason: "allowance", queued: 120, oldestWaitMinutes: 2, estimateMinutes: 90 });
    // 7 ÷ 100 × 60 = 4.2 → never under five.
    expect(judgeEmailDelay(facts({ hourlyRemaining: 0, aheadOnMailgun: 7 }), 15, NOW).estimateMinutes).toBe(5);
    // Rows on Gmail's road only: Mailgun's hour holds none of them.
    expect(judgeEmailDelay(facts({ hourlyRemaining: 0, queuedOnMailgun: 0 }), 15, NOW).late).toBe(false);
    // No pace set: nothing to spend.
    expect(judgeEmailDelay(facts({ hourlyAllowance: null, hourlyRemaining: null }), 15, NOW).late).toBe(false);
  });

  it("a deferral to the allowance's reset is late, and the estimate is the reset", () => {
    const deferred = judgeEmailDelay(facts({ deferredUntil: ahead(121) }), 15, NOW);
    expect(deferred).toMatchObject({ late: true, reason: "allowance", estimateMinutes: 125 });
  });

  it("names the dominant reason: a pause before a spent allowance before a backlog", () => {
    const all = facts({ pausedUntil: ahead(3), hourlyRemaining: 0, oldestWaitingSince: ago(90) });
    expect(judgeEmailDelay(all, 15, NOW).reason).toBe("paused");
    expect(judgeEmailDelay({ ...all, pausedUntil: null }, 15, NOW).reason).toBe("allowance");
    expect(judgeEmailDelay({ ...all, pausedUntil: null, hourlyRemaining: 40 }, 15, NOW).reason).toBe("backlog");
  });

  it("estimates a backlog only while the pace binds", () => {
    const behind = facts({ oldestWaitingSince: ago(40), aheadOnMailgun: 240 });
    expect(judgeEmailDelay(behind, 15, NOW).estimateMinutes).toBeNull();
    expect(judgeEmailDelay({ ...behind, paceBinding: true }, 15, NOW).estimateMinutes).toBe(145);
  });

  it("rounds an estimate up to five minutes, never under five", () => {
    expect([0, 1, 5, 12, 15, 90.2].map(roundUpToFive)).toEqual([5, 5, 5, 15, 15, 95]);
  });

  it("counts what a person waits for: never the newsletter, the alert, the club's copies or a colleague's invitation", () => {
    expect(isWaitedFor("VERIFY_REGISTRATION_EMAIL", false)).toBe(true);
    expect(isWaitedFor("REGISTRATION_MANAGE_LINK", false)).toBe(true);
    expect(isWaitedFor("NEWSLETTER_CONFIRM", false)).toBe(true);
    expect(isWaitedFor("REGISTRATION_CONFIRMED", true)).toBe(false);
    for (const type of ["NEWSLETTER", "NEW_EVENT_ALERT", "DECLARATION_ARCHIVE", "GROUP_RUN_DECLARATION_ARCHIVE", "CLUB_CONFIRMATION_NOTICE", "STAFF_INVITATION", "MEMBER_INVITATION"] as const) {
      expect(isWaitedFor(type, false), type).toBe(false);
    }
  });
});
