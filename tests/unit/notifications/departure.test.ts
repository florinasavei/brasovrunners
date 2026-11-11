import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import { type DepartureContext, type DepartureRow, departureOf, mailgunReopensAt } from "@/modules/notifications/domain/departure";
import { nextOutboxTick, outboxRowLeavesAt, outboxRowOverdue } from "@/modules/notifications/domain/email-wait";
import { RATE_PAUSE_ERROR_PREFIX } from "@/modules/notifications/domain/hourly-pace";
import { nextAllowanceResetAt } from "@/modules/notifications/domain/retry";
import { EMAIL_HEALTH_THRESHOLDS } from "@/modules/notifications/health";
import { departureWords } from "@/modules/notifications/ui/departure-words";
import { pingerCadenceMinutes } from "@/modules/jobs/quiet-hours";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * §529 — the queue panel says when each waiting message is expected to leave: the outbox job's
 * first real run at or after the row's own turn (its creation, or its next attempt after a retry or
 * a deferral), the runs after the next one spaced by the pinger or by the minimum interval; and a
 * row whose turn passed longer ago than `/api/health`'s `overdue` threshold is late.
 *
 * Since the design «telling the owner about every email a staff press sends» (slice 1) the judgement is one
 * function, `domain/departure.ts#departureOf`, which the queue panel, «Emailuri azi» and the toast after a press
 * all ask: now (a press's «now», or the «imediat» timing's drain), at the next real run, held for a family, late,
 * or after Mailgun's stop when nothing carries the row — and a Gmail row never waits for Mailgun.
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

describe("departureOf — the one judgement of when a waiting email leaves", () => {
  // 10:04 in Brașov, the queue panel test's own moment; the next real run at 10:15.
  const NOW = new Date("2026-10-01T07:04:00.000Z");
  const minutes = (count: number) => new Date(NOW.getTime() + count * 60_000);
  const CTX: DepartureContext = {
    now: NOW,
    timing: "scheduled",
    nextTickAt: NEXT_TICK,
    runIntervalMinutes: 0,
    overdueCadenceMinutes: 0,
    overdueAfterMs: EMAIL_HEALTH_THRESHOLDS.OVERDUE_AFTER_MS,
    deferredBeyondMs: EMAIL_HEALTH_THRESHOLDS.DEFERRED_BEYOND_MS,
    hourPaceHolds: false,
    mailgunReopensAt: null,
    pingerMinutesAt: at15,
  };
  const ROW: DepartureRow = {
    status: "PENDING",
    messageType: "REGISTRATION_CANCELLED",
    attemptCount: 0,
    nextAttemptAt: null,
    createdAt: minutes(-1),
    lastError: null,
    familyHeld: false,
    sentNow: false,
    onMailgunRoad: true,
  };

  it("says «sending» for a row a worker holds and «never» for one out of retries", () => {
    expect(departureOf({ ...ROW, status: "PROCESSING" }, CTX)).toEqual({ kind: "sending" });
    expect(departureOf({ ...ROW, status: "FAILED", attemptCount: 6 }, CTX)).toEqual({ kind: "never" });
  });

  it("says now for a press's «now» (§540), and the round once the row was tried", () => {
    expect(departureOf({ ...ROW, sentNow: true }, CTX)).toEqual({ kind: "now" });
    expect(departureOf({ ...ROW, sentNow: true, attemptCount: 1 }, CTX)).toMatchObject({ kind: "at", at: NEXT_TICK });
  });

  it("under «imediat» says now for a row the request's drain is sending, and the round for one the drain left", () => {
    const immediate = { ...CTX, timing: "immediate" as const };
    expect(departureOf(ROW, immediate)).toEqual({ kind: "now" });
    // Queued ten minutes ago and still here: the drain is over, the outbox job takes it.
    expect(departureOf({ ...ROW, createdAt: minutes(-10) }, immediate)).toMatchObject({ kind: "at", at: NEXT_TICK, late: false });
    // A retry is never «now», whatever the timing.
    expect(departureOf({ ...ROW, attemptCount: 1, nextAttemptAt: minutes(20) }, immediate)).toMatchObject({ kind: "at" });
  });

  it("under the scheduled timing says the next real run", () => {
    expect(departureOf(ROW, CTX)).toEqual({ kind: "at", at: NEXT_TICK, late: false, heldUntil: null });
  });

  it("says the first run after a held row's turn, and a family's hold with its end", () => {
    // A retry at 10:40: the 10:45 call.
    expect(departureOf({ ...ROW, attemptCount: 1, nextAttemptAt: minutes(36) }, CTX)).toMatchObject({ kind: "at", at: new Date("2026-10-01T07:45:00.000Z"), heldUntil: null });
    const held = departureOf({ ...ROW, familyHeld: true, nextAttemptAt: new Date("2026-10-01T08:30:00.000Z") }, CTX);
    expect(held).toEqual({ kind: "at", at: new Date("2026-10-01T08:30:00.000Z"), late: false, heldUntil: new Date("2026-10-01T08:30:00.000Z") });
  });

  it("is late past health's threshold — never for a newsletter, never a Mailgun row while Mailgun's hour binds", () => {
    const stale = { ...ROW, createdAt: minutes(-5 * 60) };
    expect(departureOf(stale, CTX)).toMatchObject({ kind: "at", late: true });
    expect(departureOf({ ...stale, messageType: "NEWSLETTER" }, CTX)).toMatchObject({ kind: "at", late: false });
    expect(departureOf(stale, { ...CTX, hourPaceHolds: true })).toMatchObject({ kind: "at", late: false });
    // A Gmail row never waits for Mailgun's hour.
    expect(departureOf({ ...stale, onMailgunRoad: false }, { ...CTX, hourPaceHolds: true })).toMatchObject({ kind: "at", late: true });
    // Paused by Mailgun a moment ago and due again within the hour: late once queued past the threshold.
    const paused = { ...stale, attemptCount: 1, lastError: `${RATE_PAUSE_ERROR_PREFIX}429`, nextAttemptAt: minutes(5) };
    expect(departureOf(paused, CTX)).toMatchObject({ kind: "at", late: true });
  });

  it("waits for Mailgun's reopening when nothing carries the row — a Gmail row and a row due later do not", () => {
    const stopped = { ...CTX, mailgunReopensAt: minutes(116) }; // 12:00
    expect(departureOf(ROW, stopped)).toEqual({ kind: "reset", at: new Date("2026-10-01T09:00:00.000Z") });
    expect(departureOf({ ...ROW, onMailgunRoad: false }, stopped)).toMatchObject({ kind: "at", at: NEXT_TICK });
    expect(departureOf({ ...ROW, attemptCount: 1, nextAttemptAt: minutes(200) }, stopped)).toMatchObject({ kind: "at" });
    // A press's «now» was asked with room to send it (`assertRoomToSendNow`, §540): it is said as now.
    expect(departureOf({ ...ROW, sentNow: true }, stopped)).toEqual({ kind: "now" });
  });

  it("under «imediat» never says now for a Mailgun row the stop holds — the drain's claim takes none of it — and still does for a Gmail row", () => {
    // Queued a minute ago, never tried: the drain after the response runs, but Mailgun's road is closed to it until 12:00.
    const stoppedNow = { ...CTX, timing: "immediate" as const, mailgunReopensAt: minutes(116) };
    expect(departureOf(ROW, stoppedNow)).toEqual({ kind: "reset", at: new Date("2026-10-01T09:00:00.000Z") });
    // The Free plan's day spent, the same: the provider would refuse it and the row waits for the reset.
    expect(departureOf(ROW, { ...stoppedNow, mailgunReopensAt: minutes(20 * 60) })).toMatchObject({ kind: "reset" });
    // Gmail's road is open: that drain sends it.
    expect(departureOf({ ...ROW, onMailgunRoad: false }, stoppedNow)).toEqual({ kind: "now" });
    // The stop already over: the drain sends it.
    expect(departureOf(ROW, { ...stoppedNow, mailgunReopensAt: minutes(-1) })).toEqual({ kind: "now" });
  });

  it("«Cere reconfirmarea», part two: while Gmail carries a stop, a send to many on Mailgun's road waits for the stop's end; a registration's own, a manual resend and the event's urgent notices do not", () => {
    const carried = { ...CTX, mailgunReopensAt: null, sendsToManyWaitUntil: minutes(116) }; // 12:00
    for (const messageType of ["EVENT_REMINDER", "ORGANIZER_MESSAGE", "EVENT_THANKS", "REGISTRATION_OPENED"] as const) {
      expect(departureOf({ ...ROW, messageType }, carried), messageType).toEqual({ kind: "reset", at: new Date("2026-10-01T09:00:00.000Z") });
      // The turn the claim gives it is the stop's end itself: it still leaves after Mailgun resumes.
      expect(departureOf({ ...ROW, messageType, nextAttemptAt: minutes(116) }, carried), messageType).toEqual({ kind: "reset", at: new Date("2026-10-01T09:00:00.000Z") });
      // An Administrator's «Retrimite» for one runner is that runner's own message: Gmail carries it.
      expect(departureOf({ ...ROW, messageType, isManualResend: true }, carried), messageType).toMatchObject({ kind: "at", at: NEXT_TICK });
      // On Gmail's road its own road carries it.
      expect(departureOf({ ...ROW, messageType, onMailgunRoad: false }, carried), messageType).toMatchObject({ kind: "at", at: NEXT_TICK });
    }
    // The cancellation and «Detalii actualizate» are carried by Gmail, as a registration's own message is.
    for (const messageType of ["EVENT_CANCELLED", "EVENT_UPDATE_NOTICE"] as const) {
      expect(departureOf({ ...ROW, messageType }, carried), messageType).toMatchObject({ kind: "at", at: NEXT_TICK });
    }
    expect(departureOf(ROW, carried)).toMatchObject({ kind: "at", at: NEXT_TICK });
  });

  it("judges a manual resend of a send to many late as the person's own message, and the send itself never late for waiting its turn", () => {
    const stale = { ...ROW, messageType: "EVENT_REMINDER" as const, createdAt: minutes(-5 * 60) };
    expect(departureOf(stale, CTX)).toMatchObject({ kind: "at", late: false });
    expect(departureOf({ ...stale, isManualResend: true }, CTX)).toMatchObject({ kind: "at", late: true });
  });

  it("finds Mailgun's reopening: the stop's end when nothing carries, the Free day's reset, never while Gmail carries or a month binds", () => {
    const stop = { kind: "paused" as const, until: minutes(30) };
    expect(mailgunReopensAt({ whileStopped: { road: "wait", stop, reason: "fallbackOff" }, remaining: 50, period: "day" }, NOW)).toEqual(stop.until);
    expect(mailgunReopensAt({ whileStopped: { road: "gmail", stop }, remaining: 0, period: "day" }, NOW)).toBeNull();
    expect(mailgunReopensAt({ whileStopped: { road: "mailgun" }, remaining: 0, period: "day" }, NOW)).toEqual(nextAllowanceResetAt(NOW));
    expect(mailgunReopensAt({ whileStopped: { road: "mailgun" }, remaining: 0, period: "month" }, NOW)).toBeNull();
    expect(mailgunReopensAt({ whileStopped: { road: "mailgun" }, remaining: 5, period: "day" }, NOW)).toBeNull();
    expect(mailgunReopensAt({ whileStopped: { road: "mailgun" }, remaining: null, period: "none" }, NOW)).toBeNull();
  });

  it("says each departure in the queue's own words, in both languages, late only where it is", () => {
    for (const [locale, catalogue] of [
      ["ro", ro],
      ["en", en],
    ] as const) {
      const t = createTranslator({ locale, messages: catalogue, namespace: "Admin" }) as unknown as (key: string, values?: Record<string, string | number>) => string;
      const say = (row: DepartureRow, ctx: DepartureContext = CTX, mayEdit = true) => departureWords(departureOf(row, ctx), { now: NOW, locale, mayEdit, t });
      const words = catalogue.Admin.emails.queue.leaves;
      expect(say({ ...ROW, status: "PROCESSING" })).toEqual({ text: words.sending, late: false });
      expect(say({ ...ROW, status: "FAILED" })).toEqual({ text: words.never, late: false });
      expect(say({ ...ROW, sentNow: true })).toEqual({ text: words.leavesNow, late: false });
      expect(say(ROW).text).toBe(words.at.replace("{at}", "10:15"));
      expect(say({ ...ROW, createdAt: minutes(-5 * 60) })).toEqual({ text: words.late.replace("{at}", "10:15"), late: true });
      expect(say({ ...ROW, createdAt: minutes(-5 * 60) }, CTX, false).text).toBe(words.lateAskAdmin.replace("{at}", "10:15"));
      expect(say(ROW, { ...CTX, mailgunReopensAt: minutes(116) }).text).toBe(words.reset.replace("{at}", "12:00"));
      expect(say({ ...ROW, familyHeld: true, nextAttemptAt: new Date("2026-10-01T08:30:00.000Z") }).text).toMatch(/11:30/);
    }
  });
});
