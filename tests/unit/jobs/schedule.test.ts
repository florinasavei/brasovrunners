import { describe, expect, it } from "vitest";
import {
  decidePing,
  maintenanceDueFor,
  MAX_QUIET_MINUTES,
  NEXT_DUE_CAP_MINUTES,
  PLAN_GRACE_MINUTES,
  planQuiet,
  type QuietPlan,
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

describe("§334 the quiet a real run may promise", () => {
  it("promises quiet until the soonest work", () => {
    const plan = planQuiet({ ranAt: RAN, nextWorkAt: minutes(20), cadenceMinutes: 0, failed: false });
    expect(plan.quietUntil).toEqual(minutes(20));
    expect(plan.floorUntil).toBeNull();
  });

  it("caps the quiet at an hour however far away the work is", () => {
    expect(planQuiet({ ranAt: RAN, nextWorkAt: minutes(180), cadenceMinutes: 0, failed: false }).quietUntil).toEqual(
      ends(NEXT_DUE_CAP_MINUTES),
    );
  });

  it("caps the quiet at an hour when there is no work at all", () => {
    expect(planQuiet({ ranAt: RAN, nextWorkAt: null, cadenceMinutes: 0, failed: false }).quietUntil).toEqual(ends(60));
  });

  it("promises nothing for work already due, so the next ping runs", () => {
    expect(planQuiet({ ranAt: RAN, nextWorkAt: minutes(-5), cadenceMinutes: 0, failed: false }).quietUntil).toEqual(RAN);
  });

  it("promises nothing after a run that could not finish, but keeps the Administrator's interval", () => {
    const plan = planQuiet({ ranAt: RAN, nextWorkAt: null, cadenceMinutes: 30, failed: true });
    expect(plan.quietUntil).toEqual(RAN);
    expect(plan.floorUntil).toEqual(ends(30));
  });

  it("lets a minimum interval longer than the cap replace the cap", () => {
    const plan = planQuiet({ ranAt: RAN, nextWorkAt: null, cadenceMinutes: 120, failed: false });
    expect(plan.quietUntil).toEqual(ends(120));
    expect(plan.floorUntil).toEqual(ends(120));
  });

  it("keeps a shorter interval as a floor under work that is due sooner", () => {
    const plan = planQuiet({ ranAt: RAN, nextWorkAt: minutes(10), cadenceMinutes: 30, failed: false });
    expect(plan.quietUntil).toEqual(minutes(10));
    expect(plan.floorUntil).toEqual(ends(30));
  });

  it("gives the work's own deadline no grace: before it there is nothing to do", () => {
    expect(planQuiet({ ranAt: RAN, nextWorkAt: minutes(59), cadenceMinutes: 0, failed: false }).quietUntil).toEqual(ends(60));
    expect(planQuiet({ ranAt: RAN, nextWorkAt: minutes(45), cadenceMinutes: 0, failed: false }).quietUntil).toEqual(minutes(45));
  });

  it("never promises longer than the longest quiet any choice allows", () => {
    expect(MAX_QUIET_MINUTES).toBe(120);
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

  it("runs the call an hour after a run on demand, half a second early", () => {
    const plan = planQuiet({ ranAt: RAN, nextWorkAt: null, cadenceMinutes: 0, failed: false });
    expect(verdictAt(halfSecondBefore(60), plan)).toEqual({ run: true });
  });

  it.each([15, 30, 60, 120] as const)("runs the call %i minutes after a run under that interval, half a second early", (cadence) => {
    const idle = planQuiet({ ranAt: RAN, nextWorkAt: null, cadenceMinutes: cadence, failed: false });
    expect(verdictAt(halfSecondBefore(Math.max(cadence, NEXT_DUE_CAP_MINUTES)), idle)).toEqual({ run: true });
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
