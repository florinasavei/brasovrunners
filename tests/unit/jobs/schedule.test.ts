import { describe, expect, it } from "vitest";
import {
  decidePing,
  maintenanceDueFor,
  MAX_QUIET_MINUTES,
  NEXT_DUE_CAP_MINUTES,
  planQuiet,
  slotStart,
  slotsBack,
  slotsBetween,
} from "@/modules/jobs/schedule";

/**
 * §NNN — a job ping with nothing to do does not wake the database. The arithmetic of the plan a
 * real run leaves behind, and of the verdict a ping reads from it; the database half is
 * `tests/integration/jobs/next-work.test.ts`, the cache half `job-sleep.test.ts`.
 */
const RAN = new Date("2026-10-01T10:00:00.000Z");
const minutes = (n: number) => new Date(RAN.getTime() + n * 60_000);

describe("§NNN the quiet a real run may promise", () => {
  it("promises quiet until the soonest work", () => {
    const plan = planQuiet({ ranAt: RAN, nextWorkAt: minutes(20), cadenceMinutes: 0, failed: false });
    expect(plan.quietUntil).toEqual(minutes(20));
    expect(plan.floorUntil).toBeNull();
  });

  it("caps the quiet at an hour however far away the work is", () => {
    expect(planQuiet({ ranAt: RAN, nextWorkAt: minutes(180), cadenceMinutes: 0, failed: false }).quietUntil).toEqual(
      minutes(NEXT_DUE_CAP_MINUTES),
    );
  });

  it("caps the quiet at an hour when there is no work at all", () => {
    expect(planQuiet({ ranAt: RAN, nextWorkAt: null, cadenceMinutes: 0, failed: false }).quietUntil).toEqual(minutes(60));
  });

  it("promises nothing for work already due, so the next ping runs", () => {
    expect(planQuiet({ ranAt: RAN, nextWorkAt: minutes(-5), cadenceMinutes: 0, failed: false }).quietUntil).toEqual(RAN);
  });

  it("promises nothing after a run that could not finish, but keeps the Administrator's interval", () => {
    const plan = planQuiet({ ranAt: RAN, nextWorkAt: null, cadenceMinutes: 30, failed: true });
    expect(plan.quietUntil).toEqual(RAN);
    expect(plan.floorUntil).toEqual(minutes(30));
  });

  it("lets a minimum interval longer than the cap replace the cap", () => {
    const plan = planQuiet({ ranAt: RAN, nextWorkAt: null, cadenceMinutes: 120, failed: false });
    expect(plan.quietUntil).toEqual(minutes(120));
    expect(plan.floorUntil).toEqual(minutes(120));
  });

  it("keeps a shorter interval as a floor under work that is due sooner", () => {
    const plan = planQuiet({ ranAt: RAN, nextWorkAt: minutes(10), cadenceMinutes: 30, failed: false });
    expect(plan.quietUntil).toEqual(minutes(10));
    expect(plan.floorUntil).toEqual(minutes(30));
  });

  it("never promises longer than the longest quiet any choice allows", () => {
    expect(MAX_QUIET_MINUTES).toBe(120);
  });
});

describe("§NNN a ping's verdict", () => {
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

describe("§NNN the five-minute slots", () => {
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

describe("§NNN when a registration change can matter to the maintenance job", () => {
  const day = 24 * 60 * 60_000;
  const race = { startsAt: new Date(RAN.getTime() + 30 * day), registrationClosesAt: null };

  it("is the hold the change created, on a race weeks away", () => {
    expect(maintenanceDueFor(race, RAN, minutes(30))).toEqual(minutes(30));
  });

  it("is two days before the start when nothing sooner was created", () => {
    expect(maintenanceDueFor(race, RAN)).toEqual(new Date(race.startsAt.getTime() - 2 * day));
  });

  it("is the participation window's opening when it comes first", () => {
    const withWindow = { ...race, confirmationOpensDaysBefore: 7, confirmationDeadlineDaysBefore: 2 };
    expect(maintenanceDueFor(withWindow, RAN)).toEqual(new Date(race.startsAt.getTime() - 7 * day));
  });

  it("is the registration close when it comes first", () => {
    expect(maintenanceDueFor({ ...race, registrationClosesAt: minutes(45) }, RAN)).toEqual(minutes(45));
  });

  it("leaves out the event's instants already behind, so race week's signatures wake nothing", () => {
    const closed = { startsAt: new Date(RAN.getTime() + 30 * 60 * 60_000), registrationClosesAt: minutes(-60) };
    // The close is behind and the reminder window already open: the start is all that is ahead.
    expect(maintenanceDueFor(closed, RAN)).toEqual(closed.startsAt);
    expect(maintenanceDueFor({ startsAt: minutes(-10), registrationClosesAt: null }, RAN)).toBeNull();
  });

  it("counts a deadline the change created that is already behind as due now", () => {
    expect(maintenanceDueFor({ startsAt: minutes(-10), registrationClosesAt: null }, RAN, minutes(-5))).toEqual(RAN);
  });
});
