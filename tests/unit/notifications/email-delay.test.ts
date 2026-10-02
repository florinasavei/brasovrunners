import { describe, expect, it } from "vitest";
import { pingerCadenceMinutes } from "@/modules/jobs/quiet-hours";
import {
  type EmailDelayFacts,
  isWaitedFor,
  judgeEmailDelay,
  LATE_MARGIN_MINUTES,
  roundUpToFive,
} from "@/modules/notifications/domain/email-delay";

/**
 * §623 — when the pages that wait for an email say the club's emails are late: the thresholds
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
  hourFreesAt: null,
  deferredUntil: null,
  pausedUntil: null,
  hourlyAllowance: 100,
  hourlyRemaining: 60,
  paceBinding: false,
  ...overrides,
});

describe("§623 judgeEmailDelay", () => {
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

  it("a Mailgun pause is late at once, and the estimate is the pause's end plus the next run", () => {
    // 12 minutes of pause, then the pinger's 15-minute tick: 27 → 30.
    const paused = judgeEmailDelay(facts({ pausedUntil: ahead(12), oldestWaitingSince: ago(1) }), 15, NOW);
    expect(paused).toEqual({ late: true, reason: "paused", queued: 3, oldestWaitMinutes: 1, estimateMinutes: 30 });
    // More waiting than an hour carries: the pause's end plus the queue at the pace plus the tick (12 + 150 ÷ 100 × 60 + 15 = 117).
    expect(judgeEmailDelay(facts({ pausedUntil: ahead(12), aheadOnMailgun: 150, queued: 150, oldestWaitingSince: ago(1) }), 15, NOW).estimateMinutes).toBe(120);
    // A pause that ended, or one with nothing of ours on its road, says nothing.
    expect(judgeEmailDelay(facts({ pausedUntil: ago(1), oldestWaitingSince: ago(1) }), 15, NOW).late).toBe(false);
    expect(judgeEmailDelay(facts({ pausedUntil: ahead(12), queuedOnMailgun: 0, oldestWaitingSince: ago(1) }), 15, NOW).late).toBe(false);
  });

  it("a spent hour is late, and the estimate is the queue at the pace", () => {
    // The first place frees in 41 minutes, then 150 ÷ 100 × 60 = 90 at the pace, then the 15-minute tick: 146 → 150.
    const spent = judgeEmailDelay(facts({ hourlyRemaining: 0, aheadOnMailgun: 150, queued: 120, oldestWaitingSince: ago(2), hourFreesAt: ahead(41) }), 15, NOW);
    expect(spent).toEqual({ late: true, reason: "allowance", queued: 120, oldestWaitMinutes: 2, estimateMinutes: 150 });
    // Seven behind a spent hour: nothing leaves for 41 minutes, however few they are — never «5 minutes» (41 + 4.2 + 15 → 65).
    expect(judgeEmailDelay(facts({ hourlyRemaining: 0, aheadOnMailgun: 7, hourFreesAt: ahead(41) }), 15, NOW).estimateMinutes).toBe(65);
    // Rows on Gmail's road only: Mailgun's hour holds none of them.
    expect(judgeEmailDelay(facts({ hourlyRemaining: 0, queuedOnMailgun: 0 }), 15, NOW).late).toBe(false);
    // No pace set: nothing to spend.
    expect(judgeEmailDelay(facts({ hourlyAllowance: null, hourlyRemaining: null }), 15, NOW).late).toBe(false);
  });

  it("a deferral to the allowance's reset is late, and the estimate is the reset plus the next run", () => {
    const deferred = judgeEmailDelay(facts({ deferredUntil: ahead(121) }), 15, NOW);
    expect(deferred).toMatchObject({ late: true, reason: "allowance", estimateMinutes: 140 });
    // Under the immediate timing there is no tick to wait for: the reset alone, 121 → 125.
    expect(judgeEmailDelay(facts({ deferredUntil: ahead(121) }), null, NOW).estimateMinutes).toBe(125);
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
    // 240 ÷ 100 × 60 = 144 at the pace, and the queue's last run a tick later: 159 → 160.
    expect(judgeEmailDelay({ ...behind, paceBinding: true }, 15, NOW).estimateMinutes).toBe(160);
  });

  it("adds the scheduler's tick to the instant waited for: nothing leaves between two runs", () => {
    // The hourly night cadence, a pause ending in five minutes: the next send is at the next run, not in five.
    const night = judgeEmailDelay(facts({ pausedUntil: ahead(5), oldestWaitingSince: ago(1) }), 60, NOW);
    expect(night.estimateMinutes).toBeGreaterThanOrEqual(65);
    expect(night.estimateMinutes).toBe(65);
    // The hour's freeing and the reset carry it too.
    expect(judgeEmailDelay(facts({ hourlyRemaining: 0, aheadOnMailgun: 7, hourFreesAt: ahead(41) }), 60, NOW).estimateMinutes).toBe(110);
    expect(judgeEmailDelay(facts({ deferredUntil: ahead(121) }), 60, NOW).estimateMinutes).toBe(185);
    // A queue that fits in one pass, while the pace binds: its few minutes at the pace, then the tick (3 ÷ 100 × 60 + 60 → 65).
    expect(judgeEmailDelay(facts({ oldestWaitingSince: ago(80), paceBinding: true }), 60, NOW).estimateMinutes).toBe(65);
    // Under the immediate timing, unchanged: the pause's end alone, never under five.
    expect(judgeEmailDelay(facts({ pausedUntil: ahead(5), oldestWaitingSince: ago(1) }), null, NOW).estimateMinutes).toBe(5);
    expect(judgeEmailDelay(facts({ pausedUntil: ahead(12), oldestWaitingSince: ago(1) }), null, NOW).estimateMinutes).toBe(15);
  });

  it("takes the tick at the instant waited for, not at the visitor's hour", () => {
    // Seen at 12:30 club time (day cadence, 15). The allowance resets at 02:05 club time: the night's hourly run follows.
    const waitAt = (instant: Date) => pingerCadenceMinutes(instant, 15);
    const reset = judgeEmailDelay(facts({ deferredUntil: ahead(815) }), 15, NOW, waitAt);
    expect(reset.estimateMinutes).toBe(875);
    expect(judgeEmailDelay(facts({ deferredUntil: ahead(815) }), 15, NOW).estimateMinutes).toBe(830);
    // A pause ending in the daytime keeps the day tick: 5 + 15.
    expect(judgeEmailDelay(facts({ pausedUntil: ahead(5), oldestWaitingSince: ago(1) }), 15, NOW, waitAt).estimateMinutes).toBe(20);
    // A pause ending at 23:30 club time (night): 5h+ later, the hourly tick.
    expect(judgeEmailDelay(facts({ pausedUntil: ahead(660), oldestWaitingSince: ago(1) }), 15, NOW, waitAt).estimateMinutes).toBe(720);
    // Immediate: no tick anywhere.
    expect(judgeEmailDelay(facts({ deferredUntil: ahead(815) }), null, NOW, () => null).estimateMinutes).toBe(815);
  });

  it("rounds an estimate up to five minutes, never under five", () => {
    expect([0, 1, 5, 12, 15, 90.2].map(roundUpToFive)).toEqual([5, 5, 5, 15, 15, 95]);
  });

  it("counts what a person waits for: never the newsletter, the alert, the club's copies or a colleague's invitation", () => {
    expect(isWaitedFor("VERIFY_REGISTRATION_EMAIL", false)).toBe(true);
    expect(isWaitedFor("REGISTRATION_MANAGE_LINK", false)).toBe(true);
    expect(isWaitedFor("NEWSLETTER_CONFIRM", false)).toBe(true);
    expect(isWaitedFor("REGISTRATION_CONFIRMED", true)).toBe(false);
    for (const type of [
      "NEWSLETTER",
      "NEW_EVENT_ALERT",
      "DECLARATION_ARCHIVE",
      "GROUP_RUN_DECLARATION_ARCHIVE",
      "CLUB_CONFIRMATION_NOTICE",
      "STAFF_INVITATION",
      "MEMBER_INVITATION",
      "LEGAL_TEMPLATES_CHANGED",
    ] as const) {
      expect(isWaitedFor(type, false), type).toBe(false);
    }
  });
});
