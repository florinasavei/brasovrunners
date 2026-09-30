import { describe, expect, it } from "vitest";
import {
  decidePing,
  maintenanceDueFor,
  dueSlotsFor,
  hourSlotStart,
  MAX_QUIET_MINUTES,
  PLAN_GRACE_MINUTES,
  planQuiet,
  type QuietPlan,
  SAFETY_LOOK_MAX_MINUTES,
  slotStart,
  slotsBack,
  slotsBetween,
} from "@/modules/jobs/schedule";

/**
 * §334 — a job ping with nothing to do does not wake the database. The arithmetic of the plan a
 * real run leaves behind, and of the verdict a ping reads from it; the database half is
 * `tests/integration/jobs/next-work.test.ts`, the cache half `job-sleep.test.ts`.
 */
/*
  Noon in Brașov (UTC+3 on 1 October): on every boundary the pinger has — a quarter-hour, a
  half-hour, an hour, an even hour — so the plan's ends below are §334's whole minutes after the
  run, and the alignment of §355, tested further down, moves none of them.
*/
const RAN = new Date("2026-10-01T09:00:00.000Z");
const minutes = (n: number) => new Date(RAN.getTime() + n * 60_000);
/** Where a cap or an interval of `n` minutes ends: `PLAN_GRACE_MINUTES` early. */
const ends = (n: number) => minutes(n - PLAN_GRACE_MINUTES);
/** The daily window after RAN (§577): 04:00 in Brașov on 2 October, 01:00Z, `PLAN_GRACE_MINUTES` early. */
const WINDOW_END = new Date("2026-10-02T00:58:00.000Z");

describe("§334 the quiet a real run may promise", () => {
  it("promises quiet until the soonest work", () => {
    const plan = planQuiet({ ranAt: RAN, nextWorkAt: minutes(20), cadenceMinutes: 0, failed: false });
    expect(plan.quietUntil).toEqual(minutes(20));
    expect(plan.floorUntil).toBeNull();
  });

  it("caps the quiet at the daily window however far away the work is (§577)", () => {
    expect(planQuiet({ ranAt: RAN, nextWorkAt: minutes(3 * 24 * 60), cadenceMinutes: 0, failed: false }).quietUntil).toEqual(WINDOW_END);
  });

  it("caps the quiet at the daily window when there is no work at all (§577)", () => {
    expect(planQuiet({ ranAt: RAN, nextWorkAt: null, cadenceMinutes: 0, failed: false }).quietUntil).toEqual(WINDOW_END);
  });

  it("promises nothing for work already due, so the next ping runs", () => {
    expect(planQuiet({ ranAt: RAN, nextWorkAt: minutes(-5), cadenceMinutes: 0, failed: false }).quietUntil).toEqual(RAN);
  });

  it("promises nothing after a run that could not finish, but keeps the Administrator's interval", () => {
    const plan = planQuiet({ ranAt: RAN, nextWorkAt: null, cadenceMinutes: 30, failed: true });
    expect(plan.quietUntil).toEqual(RAN);
    expect(plan.floorUntil).toEqual(ends(30));
  });

  it("keeps even the longest minimum interval a floor under the daily window (§577)", () => {
    const plan = planQuiet({ ranAt: RAN, nextWorkAt: null, cadenceMinutes: 120, failed: false });
    expect(plan.quietUntil).toEqual(WINDOW_END);
    expect(plan.floorUntil).toEqual(ends(120));
  });

  it("counts a run inside the hour before the window as the window's run: the next look is tomorrow (§577)", () => {
    const ranAt = new Date("2026-10-02T00:30:00.000Z"); // 03:30 in Brașov
    expect(planQuiet({ ranAt, nextWorkAt: null, cadenceMinutes: 0, failed: false }).quietUntil).toEqual(
      new Date("2026-10-03T00:58:00.000Z"),
    );
  });

  it("lets a minimum interval that ends past the window hold the window's run back to it (§577)", () => {
    // A run at 02:59 in Brașov under two hours: 04:00 is 61 minutes on, so today's window, but the
    // interval runs to 05:13 — the later of the two is the quiet.
    const ranAt = new Date("2026-10-01T23:59:00.000Z");
    const plan = planQuiet({ ranAt, nextWorkAt: null, cadenceMinutes: 120, failed: false });
    expect(plan.floorUntil).toEqual(new Date("2026-10-02T02:13:00.000Z"));
    expect(plan.quietUntil).toEqual(plan.floorUntil);
  });

  it("keeps a shorter interval as a floor under work that is due sooner", () => {
    const plan = planQuiet({ ranAt: RAN, nextWorkAt: minutes(10), cadenceMinutes: 30, failed: false });
    expect(plan.quietUntil).toEqual(minutes(10));
    expect(plan.floorUntil).toEqual(ends(30));
  });

  it("gives the work's own deadline no grace: before it there is nothing to do", () => {
    // Due a minute after the window: the window's grace wins, two minutes early.
    expect(planQuiet({ ranAt: RAN, nextWorkAt: new Date(WINDOW_END.getTime() + 3 * 60_000), cadenceMinutes: 0, failed: false }).quietUntil).toEqual(
      WINDOW_END,
    );
    expect(planQuiet({ ranAt: RAN, nextWorkAt: minutes(59), cadenceMinutes: 0, failed: false }).quietUntil).toEqual(minutes(59));
    expect(planQuiet({ ranAt: RAN, nextWorkAt: minutes(45), cadenceMinutes: 0, failed: false }).quietUntil).toEqual(minutes(45));
  });

  it("never promises longer than the longest quiet any choice allows: a day, the gap and the autumn hour (§577)", () => {
    expect(SAFETY_LOOK_MAX_MINUTES).toBe(26 * 60);
    expect(MAX_QUIET_MINUTES).toBe(SAFETY_LOOK_MAX_MINUTES);
  });

  it("keeps the grace under one slot, so it never lets a genuinely early ping through", () => {
    expect(PLAN_GRACE_MINUTES).toBeGreaterThan(0);
    expect(PLAN_GRACE_MINUTES).toBeLessThan(5);
  });
});

/**
 * The pinger's next call, a whole period after the run, lands a few hundred milliseconds either
 * side of the boundary depending on each invocation's cold start. It must run whichever side it
 * lands on — or a sixty-minute interval under the hourly night pinger becomes sixty or a hundred
 * and twenty at random, and an outbox retry waits long enough for `/api/health` to cry stalled.
 */
describe("§334 the pinger's next call runs, early or late by its latency", () => {
  const halfSecondBefore = (n: number) => new Date(minutes(n).getTime() - 500);

  /** The verdict a ping at `now` reads from the slots `plan` wrote; `woken` drops the due slot, as `wakeJobs` does. */
  function verdictAt(now: Date, plan: QuietPlan, woken = false) {
    const due = woken
      ? null
      : { quietUntil: plan.quietUntil.toISOString(), ranAt: plan.ranAt.toISOString(), cadenceMinutes: plan.cadenceMinutes };
    const floor = plan.floorUntil
      ? { until: plan.floorUntil.toISOString(), ranAt: plan.ranAt.toISOString(), cadenceMinutes: plan.cadenceMinutes }
      : null;
    return decidePing(now, due, floor);
  }

  /** The window's 04:00 call, half a second early. */
  const windowCallEarly = new Date(WINDOW_END.getTime() + PLAN_GRACE_MINUTES * 60_000 - 500);

  it("runs the window's 04:00 call after a run on demand, half a second early (§577)", () => {
    const plan = planQuiet({ ranAt: RAN, nextWorkAt: null, cadenceMinutes: 0, failed: false });
    expect(verdictAt(halfSecondBefore(60), plan)).toMatchObject({ run: false, reason: "nothing-due" });
    expect(verdictAt(windowCallEarly, plan)).toEqual({ run: true });
  });

  it.each([15, 30, 60, 120] as const)("runs the window's call under a %i-minute interval, and the interval's own after a wake", (cadence) => {
    const idle = planQuiet({ ranAt: RAN, nextWorkAt: null, cadenceMinutes: cadence, failed: false });
    expect(verdictAt(windowCallEarly, idle)).toEqual({ run: true });
    // Work due at once (a failed run, or a write path that woke the job): the interval alone decides.
    const busy = planQuiet({ ranAt: RAN, nextWorkAt: minutes(1), cadenceMinutes: cadence, failed: true });
    expect(verdictAt(halfSecondBefore(cadence), busy, true)).toEqual({ run: true });
  });

  it("still holds back a call a whole slot before the interval ends", () => {
    const plan = planQuiet({ ranAt: RAN, nextWorkAt: minutes(1), cadenceMinutes: 30, failed: false });
    expect(verdictAt(minutes(25), plan, true)).toMatchObject({ run: false, reason: "cadence" });
  });
});

describe("§334 a ping's verdict", () => {
  const due = { quietUntil: minutes(40).toISOString(), ranAt: RAN.toISOString(), cadenceMinutes: 0 };
  const floor = { until: minutes(30).toISOString(), ranAt: RAN.toISOString(), cadenceMinutes: 30 };

  it("skips before the cached quiet ends", () => {
    expect(decidePing(minutes(15), due, null)).toMatchObject({ run: false, reason: "nothing-due", until: minutes(40) });
  });

  it("runs once the quiet has ended", () => {
    expect(decidePing(minutes(40), due, null)).toEqual({ run: true });
  });

  it("runs when nothing is cached", () => {
    expect(decidePing(minutes(15), null, null)).toEqual({ run: true });
  });

  it("holds back inside the Administrator's interval even when the quiet was forgotten", () => {
    expect(decidePing(minutes(15), null, floor)).toMatchObject({ run: false, reason: "cadence", until: minutes(30) });
    expect(decidePing(minutes(31), null, floor)).toEqual({ run: true });
  });
});

describe("§334 the five-minute slots", () => {
  it("names each slot by its start", () => {
    expect(slotStart(new Date("2026-10-01T10:07:31.000Z"))).toEqual(new Date("2026-10-01T10:05:00.000Z"));
  });

  it("covers every slot a waiting ping could fall in, and none after", () => {
    expect(slotsBetween(new Date("2026-10-01T10:02:00.000Z"), new Date("2026-10-01T10:17:00.000Z")).map((at) => at.toISOString())).toEqual([
      "2026-10-01T10:00:00.000Z",
      "2026-10-01T10:05:00.000Z",
      "2026-10-01T10:10:00.000Z",
      "2026-10-01T10:15:00.000Z",
    ]);
    expect(slotsBetween(RAN, RAN)).toEqual([]);
  });

  it("writes a day's quiet as twelve five-minute slots and then hour slots, not 288 (§577)", () => {
    const { fine, hours } = dueSlotsFor(RAN, WINDOW_END);
    expect(fine).toHaveLength(12);
    expect(fine[0]).toEqual(RAN);
    expect(fine.at(-1)).toEqual(minutes(55));
    // From the hour the fine span ends in (10:00Z) to the last hour that begins before 00:58Z.
    expect(hours[0]).toEqual(new Date("2026-10-01T10:00:00.000Z"));
    expect(hours.at(-1)).toEqual(new Date("2026-10-02T00:00:00.000Z"));
    expect(hours).toHaveLength(15);
    // Every minute of the quiet has a slot: its five-minute one, or else its hour's.
    const fineStarts = new Set(fine.map((at) => at.getTime()));
    const hourStarts = new Set(hours.map((at) => at.getTime()));
    for (let at = RAN.getTime(); at < WINDOW_END.getTime(); at += 60_000) {
      const covered = fineStarts.has(slotStart(new Date(at)).getTime()) || hourStarts.has(hourSlotStart(new Date(at)).getTime());
      expect(covered, new Date(at).toISOString()).toBe(true);
    }
  });

  it("writes only five-minute slots for a quiet shorter than an hour, and none for none", () => {
    expect(dueSlotsFor(RAN, minutes(20))).toEqual({ fine: [RAN, minutes(5), minutes(10), minutes(15)], hours: [] });
    expect(dueSlotsFor(RAN, RAN)).toEqual({ fine: [], hours: [] });
  });

  it("looks back newest first", () => {
    const back = slotsBack(new Date("2026-10-01T10:12:00.000Z"), 10 * 60_000);
    expect(back.map((at) => at.toISOString())).toEqual([
      "2026-10-01T10:10:00.000Z",
      "2026-10-01T10:05:00.000Z",
      "2026-10-01T10:00:00.000Z",
    ]);
  });
});

describe("§334 when a registration change can matter to the maintenance job", () => {
  const day = 24 * 60 * 60_000;
  // The reminder lead in force for the event — the club's forty-eight hours unset (§377).
  const race = { startsAt: new Date(RAN.getTime() + 30 * day), registrationClosesAt: null, reminderHours: 48 };

  it("is the hold the change created, on a race weeks away", () => {
    expect(maintenanceDueFor(race, RAN, minutes(30))).toEqual(minutes(30));
  });

  it("is two days before the start when nothing sooner was created", () => {
    expect(maintenanceDueFor(race, RAN)).toEqual(new Date(race.startsAt.getTime() - 2 * day));
  });

  it("is the event's own reminder lead, and has no reminder instant when it sends none (§377)", () => {
    // Seventy-two hours chosen on the event: three days before the start.
    expect(maintenanceDueFor({ ...race, reminderHours: 72 }, RAN)).toEqual(new Date(race.startsAt.getTime() - 3 * day));
    // No reminder: the close is the start here, so the start is the next instant.
    expect(maintenanceDueFor({ ...race, reminderHours: 0 }, RAN)).toEqual(race.startsAt);
  });

  it("is the participation window's opening when it comes first", () => {
    const withWindow = { ...race, confirmationOpensDaysBefore: 7, confirmationDeadlineDaysBefore: 2 };
    expect(maintenanceDueFor(withWindow, RAN)).toEqual(new Date(race.startsAt.getTime() - 7 * day));
  });

  it("is the registration close when it comes first", () => {
    expect(maintenanceDueFor({ ...race, registrationClosesAt: minutes(45) }, RAN)).toEqual(minutes(45));
  });

  it("leaves out the event's instants already behind, so race week's signatures wake nothing", () => {
    const closed = { startsAt: new Date(RAN.getTime() + 30 * 60 * 60_000), registrationClosesAt: minutes(-60), reminderHours: 48 };
    // The close is behind and the reminder window already open: the start is all that is ahead.
    expect(maintenanceDueFor(closed, RAN)).toEqual(closed.startsAt);
    expect(maintenanceDueFor({ startsAt: minutes(-10), registrationClosesAt: null, reminderHours: 48 }, RAN)).toBeNull();
  });

  it("counts a deadline the change created that is already behind as due now", () => {
    expect(maintenanceDueFor({ startsAt: minutes(-10), registrationClosesAt: null, reminderHours: 48 }, RAN, minutes(-5))).toEqual(RAN);
  });
});
