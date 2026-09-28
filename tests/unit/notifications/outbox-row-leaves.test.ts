import { describe, expect, it } from "vitest";
import { nextOutboxTick, outboxRowLeavesAt, outboxRowOverdue } from "@/modules/notifications/domain/email-wait";
import { EMAIL_HEALTH_THRESHOLDS } from "@/modules/notifications/health";
import { pingerCadenceMinutes } from "@/modules/jobs/quiet-hours";

/**
 * §529 — the queue panel says when each waiting message is expected to leave: the outbox job's
 * first real run at or after the row's own turn (its creation, or its next attempt after a retry or
 * a deferral), the runs after the next one spaced by the pinger or by the minimum interval; and a
 * row whose turn passed longer ago than `/api/health`'s `overdue` threshold is late.
 */

// 10:00 in Brașov on 1 October 2026 (UTC+3): a day hour, pinged every fifteen minutes.
const NEXT_TICK = new Date("2026-10-01T07:15:00.000Z");
const at15 = () => 15;

describe("§529 outboxRowLeavesAt — one queued row's departure", () => {
  it("is the next real run for a row whose turn has come", () => {
    const leaves = outboxRowLeavesAt({ dueAt: new Date("2026-10-01T07:02:00.000Z"), nextTickAt: NEXT_TICK, intervalMinutes: 0, pingerMinutesAt: at15 });
    expect(leaves.toISOString()).toBe(NEXT_TICK.toISOString());
  });

  it("is the first pinger call at or after a later turn — a retry, a deferral — with no interval", () => {
    const retry = outboxRowLeavesAt({ dueAt: new Date("2026-10-01T07:40:00.000Z"), nextTickAt: NEXT_TICK, intervalMinutes: 0, pingerMinutesAt: at15 });
    expect(retry.toISOString()).toBe("2026-10-01T07:45:00.000Z");
    // A deferral to the allowance's reset at night: the next hourly call, the night's cadence.
    const deferred = outboxRowLeavesAt({
      dueAt: new Date("2026-10-01T21:10:00.000Z"),
      nextTickAt: NEXT_TICK,
      intervalMinutes: 0,
      pingerMinutesAt: (instant) => pingerCadenceMinutes(instant, 15),
    });
    expect(deferred.toISOString()).toBe("2026-10-01T22:00:00.000Z");
  });

  it("steps from one real run to the next by the minimum interval when one holds the job back", () => {
    const interval = 120;
    const second = nextOutboxTick({ now: NEXT_TICK, pingerMinutes: 15, intervalMinutes: interval, lastRunAt: NEXT_TICK });
    // The run after next is at least the interval later, and a row due between the two waits for it.
    expect(second.getTime() - NEXT_TICK.getTime()).toBeGreaterThanOrEqual((interval - 1) * 60_000);
    const leaves = outboxRowLeavesAt({ dueAt: new Date(NEXT_TICK.getTime() + 5 * 60_000), nextTickAt: NEXT_TICK, intervalMinutes: interval, pingerMinutesAt: at15 });
    expect(leaves.toISOString()).toBe(second.toISOString());
  });

  it("never estimates a departure before the row's own turn", () => {
    for (const minutes of [1, 20, 95, 600, 1500]) {
      const dueAt = new Date(NEXT_TICK.getTime() + minutes * 60_000);
      for (const interval of [0, 30, 120]) {
        const leaves = outboxRowLeavesAt({ dueAt, nextTickAt: NEXT_TICK, intervalMinutes: interval, pingerMinutesAt: (instant) => pingerCadenceMinutes(instant, 15) });
        expect(leaves.getTime(), `${minutes} min, interval ${interval}`).toBeGreaterThanOrEqual(dueAt.getTime());
      }
    }
  });
});

describe("§529 outboxRowOverdue — the same threshold as the health check's `overdue`", () => {
  const now = new Date("2026-10-01T10:00:00.000Z");
  const { OVERDUE_AFTER_MS } = EMAIL_HEALTH_THRESHOLDS;

  it("is late ninety minutes past its turn, plus the interval in force", () => {
    const justInside = new Date(now.getTime() - OVERDUE_AFTER_MS + 60_000);
    const justPast = new Date(now.getTime() - OVERDUE_AFTER_MS - 60_000);
    expect(outboxRowOverdue({ now, dueAt: justInside, overdueAfterMs: OVERDUE_AFTER_MS, intervalMinutes: 0 })).toBe(false);
    expect(outboxRowOverdue({ now, dueAt: justPast, overdueAfterMs: OVERDUE_AFTER_MS, intervalMinutes: 0 })).toBe(true);
    // A two-hour interval is the club's own brake, not a stall.
    expect(outboxRowOverdue({ now, dueAt: justPast, overdueAfterMs: OVERDUE_AFTER_MS, intervalMinutes: 120 })).toBe(false);
  });
});
