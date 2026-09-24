import { describe, expect, it } from "vitest";
import { jobStalenessThresholdMs } from "@/modules/jobs/quiet-hours";
import {
  ALIGN_STRETCH_MINUTES,
  clubMinuteOfDay,
  decidePing,
  type JobCadenceMinutes,
  lastClubBoundary,
  minimumIntervalEnd,
  NEXT_DUE_CAP_MINUTES,
  nextClubBoundary,
  PINGER_SLOT_MINUTES,
  PLAN_GRACE_MINUTES,
  planQuiet,
  type QuietPlan,
  safetyCapEnd,
} from "@/modules/jobs/schedule";
import { EMAIL_HEALTH_THRESHOLDS } from "@/modules/notifications/health";

/**
 * BR-REQ-090-03 criterion 14 (§NNN) — the safety look and the owner's minimum interval end on the
 * pinger's own slots in the club's clock, not a fixed number of minutes after the last real run.
 *
 * The owner, 2026-09-24, with Neon at $1.54 for 14.7 CU-hours in 2.3 days. Production's operations
 * log after §334 still showed wakes at 10:00, 10:15, 11:02, 12:02, 12:15, 13:02, 13:15 and 14:15:
 * each job's forced hourly run had drifted to wherever its last real run happened, so the two jobs
 * and the health monitor's :02 check woke the database separately, five billed minutes each.
 *
 * Pure: the plan (`planQuiet`), the verdict a ping reads from it (`decidePing`) and a simulated
 * pinger — the quarter-hours by day, the hour at night, each call a few hundred milliseconds
 * early or late — with the health thresholds themselves (`quiet-hours.ts`, `health.ts`,
 * `notifications/health.ts`) as the bound nothing may cross.
 */

const MINUTE = 60_000;
const GRACE = PLAN_GRACE_MINUTES * MINUTE;

/** The club's wall clock on 1 October 2026, UTC+3: `club("10:15")` is 10:15 in Brașov. */
function club(time: string, day = "2026-10-01"): Date {
  return new Date(`${day}T${time}+03:00`);
}

/** Half a second before `at`: the pinger's call when that invocation started a touch sooner. */
const early = (at: Date) => new Date(at.getTime() - 500);
const after = (at: Date, minutes: number) => new Date(at.getTime() + minutes * MINUTE);

/** What a ping at `now` does with the slots `plan` wrote. */
function verdict(now: Date, plan: QuietPlan) {
  const due = { quietUntil: plan.quietUntil.toISOString(), ranAt: plan.ranAt.toISOString(), cadenceMinutes: plan.cadenceMinutes };
  const floor = plan.floorUntil
    ? { until: plan.floorUntil.toISOString(), ranAt: plan.ranAt.toISOString(), cadenceMinutes: plan.cadenceMinutes }
    : null;
  return decidePing(now, due, floor);
}

const idle = (ranAt: Date, cadenceMinutes: JobCadenceMinutes = 0) =>
  planQuiet({ ranAt, nextWorkAt: null, cadenceMinutes, failed: false });

type Call = { slot: Date; at: Date };

/**
 * Every call the external pinger makes after `from` and before `until`: the quarter-hours by day
 * (or the deployment's own day cadence — QA's is sixty), the hour at night, club time, each
 * landing up to 800 ms either side of its slot.
 */
function pingerCalls(from: Date, until: Date, dayMinutes: number): Call[] {
  const calls: Call[] = [];
  const step = PINGER_SLOT_MINUTES * MINUTE;
  const jitter = [-800, 300, -300, 800, 0];
  for (let slot = Math.ceil(from.getTime() / step) * step, k = 0; slot < until.getTime(); slot += step) {
    const minute = clubMinuteOfDay(slot);
    const hour = Math.floor(minute / 60);
    const every = hour >= 23 || hour < 7 ? Math.max(60, dayMinutes) : dayMinutes;
    if (minute % every !== 0) continue;
    const at = new Date(slot + jitter[k++ % jitter.length]);
    if (at.getTime() > from.getTime()) calls.push({ slot: new Date(slot), at });
  }
  return calls;
}

type Rule = (ranAt: Date) => QuietPlan;

/**
 * The real runs of one job: a run at `start`, then every call its latest plan does not hold back.
 * `dropped` names calls that never arrive — the pinger missed one, or the function timed out
 * before it recorded — by their place among the calls that would have run (0 is the first): a
 * dropped call the plan would have skipped changes nothing, so only these are worth dropping.
 */
function realRuns(start: Date, until: Date, plan: Rule, dayMinutes = 15, dropped: ReadonlySet<number> = new Set()): Call[] {
  const runs: Call[] = [{ slot: start, at: start }];
  let current = plan(start);
  let due = 0;
  for (const call of pingerCalls(start, until, dayMinutes)) {
    if (!verdict(call.at, current).run) continue;
    if (dropped.has(due++)) continue;
    runs.push(call);
    current = plan(call.at);
  }
  return runs;
}

/** §334's rule as it was: an hour after the run, minus the grace, whatever the clock said. */
const driftingRule: Rule = (ranAt) => ({
  ranAt,
  quietUntil: new Date(ranAt.getTime() + NEXT_DUE_CAP_MINUTES * MINUTE - GRACE),
  floorUntil: null,
  cadenceMinutes: 0,
});

/** Neon Launch: the first query wakes the compute, which sleeps five idle minutes after the last. */
function wakes(queries: Date[]): Date[] {
  const starts: Date[] = [];
  let awakeUntil = Number.NEGATIVE_INFINITY;
  for (const at of queries.map((query) => query.getTime()).sort((a, b) => a - b)) {
    if (at > awakeUntil) starts.push(new Date(at));
    awakeUntil = Math.max(awakeUntil, at + 5 * MINUTE);
  }
  return starts;
}

const onTheHour = (at: Date) => clubMinuteOfDay(at) % 60 === 0;
const onEvenHour = (at: Date) => clubMinuteOfDay(at) % 120 === 0;

describe("BR-REQ-090-03 criterion 14 (§NNN) the safety look lands on the pinger's hour", () => {
  it("looks again at the 11:00 call after a run at 10:15, not at 11:15", () => {
    const plan = idle(club("10:15"));
    expect(plan.quietUntil).toEqual(club("10:58"));
    expect(verdict(club("10:30"), plan)).toMatchObject({ run: false, reason: "nothing-due" });
    expect(verdict(club("10:45"), plan)).toMatchObject({ run: false, reason: "nothing-due" });
    expect(verdict(early(club("11:00")), plan)).toEqual({ run: true });
  });

  it("looks again at 11:00 after a run at 10:00:20, whichever side of the hour that call lands", () => {
    const plan = idle(club("10:00:20"));
    expect(plan.quietUntil).toEqual(club("10:58"));
    expect(verdict(early(club("11:00")), plan)).toEqual({ run: true });
    expect(verdict(club("11:00:00.800"), plan)).toEqual({ run: true });
  });

  it("counts a run whose :00 call landed early as that hour's run, next due at the following :00", () => {
    const plan = idle(club("09:59:59.600"));
    expect(verdict(club("10:15"), plan).run).toBe(false);
    expect(verdict(club("10:45"), plan).run).toBe(false);
    expect(verdict(early(club("11:00")), plan)).toEqual({ run: true });
  });

  it("is never later than §334's hour-minus-grace and always lands on a top-of-the-hour call, for a run at any moment", () => {
    // Every ten seconds of two hours, and the moments either side of each boundary.
    const starts: Date[] = [];
    for (let at = club("09:00").getTime(); at < club("11:00").getTime(); at += 10_000) starts.push(new Date(at));
    for (const boundary of ["09:15", "09:30", "09:45", "10:00"]) for (const offset of [-GRACE - 1, -GRACE, -900, -1, 1, 900]) {
      starts.push(new Date(club(boundary).getTime() + offset));
    }
    for (const ranAt of starts) {
      const end = safetyCapEnd(ranAt).getTime();
      expect(end, ranAt.toISOString()).toBeLessThanOrEqual(ranAt.getTime() + NEXT_DUE_CAP_MINUTES * MINUTE - GRACE);
      expect(end, ranAt.toISOString()).toBeGreaterThan(ranAt.getTime());
      // The first pinger slot the end lets through is a top of the hour.
      expect(onTheHour(nextClubBoundary(new Date(end), PINGER_SLOT_MINUTES)!), ranAt.toISOString()).toBe(true);
    }
  });

  it("runs every hourly call at night, on the hour", () => {
    const runs = realRuns(club("23:00"), club("07:00", "2026-10-02"), idle);
    expect(runs.map((run) => run.slot)).toEqual(Array.from({ length: 8 }, (_, hour) => after(club("23:00"), hour * 60)));
  });

  it("brings both jobs to the same :00 after one cycle, wherever each started", () => {
    const until = club("15:00");
    const hours = [club("11:00"), club("12:00"), club("13:00"), club("14:00")];
    const aligned = realRuns(club("10:00"), until, idle).slice(1);
    expect(aligned.map((run) => run.slot)).toEqual(hours);
    for (let second = 0; second < 3600; second += 20) {
      // One job's last real run anywhere in 10:00–10:59 (a woken run, a deploy), the other's on the hour.
      const start = after(club("10:00"), second / 60);
      const drifted = realRuns(start, until, idle).slice(1);
      // A run within the grace of 11:00 is the 11:00 call's own run; any other is followed by it.
      const expected = start.getTime() >= club("11:00").getTime() - GRACE ? hours.slice(1) : hours;
      expect(drifted.map((run) => run.slot), start.toISOString()).toEqual(expected);
    }
  });

  it("makes each quiet hour one wake of the database instead of two, the :02 health check included", () => {
    // The measured morning: maintenance's last real run at 10:15, the outbox's at 10:00, the
    // production health monitor's GET at :02 every hour.
    const until = club("16:00");
    const health = [11, 12, 13, 14, 15].map((hour) => club(`${hour}:02`));
    const queries = (rule: Rule) => [
      ...realRuns(club("10:15"), until, rule).slice(1).map((run) => run.at),
      ...realRuns(club("10:00"), until, rule).slice(1).map((run) => run.at),
      ...health,
    ];
    const inWindow = (starts: Date[]) => starts.filter((at) => at.getTime() >= club("10:55").getTime());

    expect(inWindow(wakes(queries(driftingRule))).length).toBe(10);
    const aligned = inWindow(wakes(queries(idle)));
    expect(aligned.length).toBe(5);
    expect(aligned.every((at) => onTheHour(new Date(at.getTime() + 1_000)))).toBe(true);
  });

  it("leaves a deadline the work itself has where it is: due at 10:37, the 10:45 call runs", () => {
    const plan = planQuiet({ ranAt: club("10:00"), nextWorkAt: club("10:37"), cadenceMinutes: 0, failed: false });
    expect(plan.quietUntil).toEqual(club("10:37"));
    expect(verdict(club("10:30"), plan).run).toBe(false);
    expect(verdict(early(club("10:45")), plan)).toEqual({ run: true });
    // And from that run the safety look is back on the hour.
    expect(idle(early(club("10:45"))).quietUntil).toEqual(club("10:58"));
  });
});

describe("BR-REQ-090-03 criterion 14 (§NNN) a minimum interval ends on a boundary of its own length, never sooner", () => {
  it("ends on its own boundary after a run that is already on it", () => {
    const noon = club("12:00:00.300");
    for (const cadence of [15, 30, 60, 120] as const) {
      expect(minimumIntervalEnd(noon, cadence)).toEqual(new Date(noon.getTime() + cadence * MINUTE - GRACE));
    }
  });

  it("moves 15 to the quarter-hour, 30 to :00 or :30, 60 to the hour and 120 to an even hour", () => {
    expect(minimumIntervalEnd(club("10:05"), 15)).toEqual(club("10:28"));
    expect(minimumIntervalEnd(club("10:15"), 30)).toEqual(club("10:58"));
    expect(minimumIntervalEnd(club("10:45"), 60)).toEqual(club("11:58"));
    expect(minimumIntervalEnd(club("11:45"), 120)).toEqual(club("13:58"));
  });

  it("gets there a quarter of an hour at a time when the boundary is further than that", () => {
    expect(ALIGN_STRETCH_MINUTES).toBe(PINGER_SLOT_MINUTES);
    // 60 after a run at 10:15: 12:00 would be 45 minutes late; 11:30 is 15, then 12:45, then 14:00.
    expect(minimumIntervalEnd(club("10:15"), 60)).toEqual(club("11:28"));
    expect(minimumIntervalEnd(club("11:30"), 60)).toEqual(club("12:43"));
    expect(minimumIntervalEnd(club("12:45"), 60)).toEqual(club("13:58"));
    // 120 after a run at 11:00 (odd): 13:15, 15:30, 17:45, then 20:00.
    expect(minimumIntervalEnd(club("11:00"), 120)).toEqual(club("13:13"));
    expect(minimumIntervalEnd(club("13:15"), 120)).toEqual(club("15:28"));
    expect(minimumIntervalEnd(club("15:30"), 120)).toEqual(club("17:43"));
    expect(minimumIntervalEnd(club("17:45"), 120)).toEqual(club("19:58"));
    // 30 needs it only after a run off the pinger's grid: a woken run at 10:05 goes to 10:45, not 11:00.
    expect(minimumIntervalEnd(club("10:05"), 30)).toEqual(club("10:43"));
  });

  it("never ends sooner than the interval minus the grace, nor more than the stretch past it, for a run at any moment", () => {
    for (const cadence of [15, 30, 60, 120] as const) {
      for (let at = club("00:00").getTime(); at < club("00:00", "2026-10-02").getTime(); at += 7 * MINUTE + 13_000) {
        const ranAt = new Date(at);
        const end = minimumIntervalEnd(ranAt, cadence).getTime();
        expect(end, `${cadence} ${ranAt.toISOString()}`).toBeGreaterThanOrEqual(at + cadence * MINUTE - GRACE);
        expect(end, `${cadence} ${ranAt.toISOString()}`).toBeLessThanOrEqual(at + (cadence + ALIGN_STRETCH_MINUTES) * MINUTE);
      }
    }
  });

  it("puts QA's two-hour runs on even hours under its hourly pinger, so the 00:02, 06:02, 12:02 and 18:02 checks share their wakes", () => {
    const every2h = (ranAt: Date) => idle(ranAt, 120);
    // QA's last real run on an odd hour, an even one, or off the hour altogether (a woken run).
    for (const start of [club("09:00"), club("10:00"), club("10:30"), club("11:15"), club("11:59:59.500")]) {
      // The first run after the start may still be on its way (10:30 goes to 13:00, then 16:00);
      // from the second on, every run is on an even hour, two hours after the one before.
      const runs = realRuns(start, club("12:30", "2026-10-02"), every2h, 60).slice(2);
      expect(runs.every((run) => onEvenHour(run.slot)), start.toISOString()).toBe(true);
      for (let index = 1; index < runs.length; index++) {
        expect(runs[index].slot.getTime() - runs[index - 1].slot.getTime()).toBe(120 * MINUTE);
      }
      // So the QA health monitor's four checks a day, at minute two, fall inside a run's wake.
      const slots = runs.map((run) => run.slot.getTime());
      for (const check of [club("18:00"), club("00:00", "2026-10-02"), club("06:00", "2026-10-02"), club("12:00", "2026-10-02")]) {
        expect(slots, start.toISOString()).toContain(check.getTime());
      }
    }
  });

  it("brings production's quarter-hour pinger onto the boundary within a few runs, never sooner than the interval", () => {
    for (const cadence of [30, 60, 120] as const) {
      const rule = (ranAt: Date) => idle(ranAt, cadence);
      const boundary = cadence === 120 ? onEvenHour : cadence === 60 ? onTheHour : (at: Date) => clubMinuteOfDay(at) % 30 === 0;
      /*
        From a run on the pinger's grid the boundary is at most the interval less one slot away,
        and each run gets one stretch closer: three runs for 60, seven for 120, one for 30. A start
        off the grid (a woken run at 08:05) spends one more run reaching it.
      */
      const most = cadence / PINGER_SLOT_MINUTES;
      for (let minute = 0; minute < 120; minute += 5) {
        const start = after(club("08:00"), minute);
        // Into the next evening: seven quarter-hour steps of two hours outlast one day's pinger.
        const runs = realRuns(start, club("22:00", "2026-10-02"), rule);
        for (let index = 1; index < runs.length; index++) {
          expect(runs[index].at.getTime() - runs[index - 1].at.getTime()).toBeGreaterThanOrEqual(cadence * MINUTE - GRACE);
        }
        const first = runs.findIndex((run, index) => index > 0 && boundary(run.slot));
        expect(first, `${cadence} ${start.toISOString()}`).toBeGreaterThan(0);
        expect(first, `${cadence} ${start.toISOString()}`).toBeLessThanOrEqual(most);
        expect(runs.slice(first).every((run) => boundary(run.slot)), `${cadence} ${start.toISOString()}`).toBe(true);
      }
    }
  });
});

describe("BR-REQ-090-03 criterion 14 (§NNN) daylight saving, Europe/Bucharest", () => {
  it("keeps the safety look on the hour across the autumn change", () => {
    // 25 October 2026: at 01:00Z the clocks go from 04:00 EEST back to 03:00 EET.
    const plan = idle(new Date("2026-10-25T00:15:00.000Z")); // 03:15 EEST
    expect(plan.quietUntil).toEqual(new Date("2026-10-25T00:58:00.000Z"));
    expect(verdict(early(new Date("2026-10-25T01:00:00.000Z")), plan)).toEqual({ run: true }); // 03:00 EET
  });

  it("keeps the safety look on the hour across the spring change", () => {
    // 28 March 2027: at 01:00Z the clocks go from 03:00 EET to 04:00 EEST.
    const plan = idle(new Date("2027-03-28T00:15:00.000Z")); // 02:15 EET
    expect(plan.quietUntil).toEqual(new Date("2027-03-28T00:58:00.000Z"));
    expect(verdict(early(new Date("2027-03-28T01:00:00.000Z")), plan)).toEqual({ run: true }); // 04:00 EEST
  });

  it("finds even hours on the club's clock, an hour apart in spring and three in autumn", () => {
    // Spring: 02:00 EET (00:00Z), then 04:00 EEST (01:00Z).
    expect(nextClubBoundary(new Date("2027-03-28T00:00:01.000Z"), 120)).toEqual(new Date("2027-03-28T01:00:00.000Z"));
    // Autumn: 02:00 EEST (23:00Z), then 04:00 EET (02:00Z); 03:00 happens twice and is odd both times.
    expect(nextClubBoundary(new Date("2026-10-24T23:00:01.000Z"), 120)).toEqual(new Date("2026-10-25T02:00:00.000Z"));
    expect(lastClubBoundary(new Date("2026-10-25T01:59:59.000Z"), 120)).toEqual(new Date("2026-10-24T23:00:00.000Z"));
  });

  it("never shortens two hours to the one the spring change leaves between 02:00 and 04:00", () => {
    const ranAt = new Date("2027-03-28T00:00:00.000Z"); // 02:00 EET
    const plan = idle(ranAt, 120);
    expect(plan.floorUntil!.getTime()).toBeGreaterThanOrEqual(ranAt.getTime() + 120 * MINUTE - GRACE);
    expect(verdict(new Date("2027-03-28T01:00:00.000Z"), plan)).toMatchObject({ run: false }); // 04:00 EEST, one hour on
    const runs = realRuns(ranAt, new Date("2027-03-28T08:00:00.000Z"), (at) => idle(at, 120));
    // Under the night pinger the next run is 06:00 EEST, three hours on, then even hours.
    expect(runs.slice(1, 4).map((run) => run.slot.toISOString())).toEqual([
      "2027-03-28T03:00:00.000Z",
      "2027-03-28T05:00:00.000Z",
      "2027-03-28T07:00:00.000Z",
    ]);
  });

  it("reaches 04:00 EET across the autumn change without ever running sooner than two hours", () => {
    const ranAt = new Date("2026-10-24T23:00:00.000Z"); // 02:00 EEST
    const runs = realRuns(ranAt, new Date("2026-10-25T08:00:00.000Z"), (at) => idle(at, 120));
    expect(runs[1].slot.toISOString()).toBe("2026-10-25T02:00:00.000Z"); // 04:00 EET, three hours on
    for (let index = 1; index < runs.length; index++) {
      expect(runs[index].at.getTime() - runs[index - 1].at.getTime()).toBeGreaterThanOrEqual(120 * MINUTE - GRACE);
      expect(onEvenHour(runs[index].slot)).toBe(true);
    }
  });
});

describe("BR-REQ-090-03 criterion 14 (§NNN) no health threshold is ever crossed", () => {
  const CADENCES = [0, 15, 30, 60, 120] as const;

  /**
   * For every pair of consecutive real runs, the job health's real-run threshold (`health.ts`:
   * max(cap, interval) plus twice the pinger cadence in force plus five) is not crossed at any
   * moment between them — checked just before every pinger slot in between, which is where the
   * gap is largest under each threshold, the day's ending at 23:00 included — and, with work
   * waiting at every run, the outbox's claim is never later than the email health's "overdue".
   * The job threshold also holds with any one call that would have run dropped, as its "one slow
   * run never flips the check" promises; two dropped in a row right after a stretched run are past
   * that promise, as three in a row were before alignment.
   */
  /** The threshold changes only on the hour, so each hour's is asked of `quiet-hours.ts` once. */
  const thresholds = new Map<string, number>();
  function stalenessAt(at: number, dayMinutes: number): number {
    const key = `${Math.floor(at / (60 * MINUTE))}:${dayMinutes}`;
    let threshold = thresholds.get(key);
    if (threshold === undefined) thresholds.set(key, (threshold = jobStalenessThresholdMs(new Date(at), dayMinutes)));
    return threshold;
  }

  /** The first moment in `runs` a health check would read `stale`, or null — so a failure names it. */
  function firstCrossing(runs: Call[], cadence: number, dayMinutes: number): string | null {
    const step = PINGER_SLOT_MINUTES * MINUTE;
    for (let index = 1; index < runs.length; index++) {
      const last = runs[index - 1].at.getTime();
      const next = runs[index].at.getTime();
      const checks = [next - 1];
      for (let slot = Math.ceil(last / step) * step; slot < next; slot += step) if (slot - 1 > last) checks.push(slot - 1);
      for (const at of checks) {
        if (at - last > Math.max(NEXT_DUE_CAP_MINUTES, cadence) * MINUTE + stalenessAt(at, dayMinutes)) {
          return `${new Date(last).toISOString()} → ${new Date(at).toISOString()}`;
        }
      }
    }
    return null;
  }

  /** Twelve starts across two evening hours, off the minute, so each simulated day crosses 23:00 and 07:00. */
  const STARTS = Array.from({ length: 12 }, (_, index) => new Date(after(club("21:00"), index * 10 + 3).getTime() + 17_000));
  const UNTIL = club("23:30", "2026-10-02");

  it.each([15, 60])("holds for a day of idle runs with a %i-minute day pinger, from any start", (dayMinutes) => {
    for (const cadence of CADENCES) {
      for (const start of STARTS) {
        const runs = realRuns(start, UNTIL, (ranAt) => idle(ranAt, cadence), dayMinutes);
        expect(firstCrossing(runs, cadence, dayMinutes), `${cadence} min from ${start.toISOString()}`).toBeNull();
      }
    }
  });

  it.each([15, 60])("keeps a retry that is always waiting inside the email health's overdue, with a %i-minute day pinger", (dayMinutes) => {
    for (const cadence of CADENCES) {
      const busy = (ranAt: Date) => planQuiet({ ranAt, nextWorkAt: after(ranAt, 1), cadenceMinutes: cadence, failed: false });
      for (const start of STARTS) {
        const runs = realRuns(start, UNTIL, busy, dayMinutes);
        expect(firstCrossing(runs, cadence, dayMinutes), `${cadence} min from ${start.toISOString()}`).toBeNull();
        // A retry due a minute after a run is claimed by the next run, inside "overdue".
        let longest = 0;
        for (let index = 1; index < runs.length; index++) {
          longest = Math.max(longest, runs[index].at.getTime() - after(runs[index - 1].at, 1).getTime());
        }
        expect(longest).toBeLessThan(EMAIL_HEALTH_THRESHOLDS.OVERDUE_AFTER_MS + cadence * MINUTE);
      }
    }
  });

  it("leaves the tightest job threshold room for one missed pinger call after a stretched run", () => {
    // Production by day: twice fifteen plus five past max(cap, interval) — "one slow run never
    // flips the check" (`health.ts`). A stretch of thirty left five minutes, not one call.
    const tightest = jobStalenessThresholdMs(club("12:00"), 15);
    expect(tightest).toBe(35 * MINUTE);
    expect((ALIGN_STRETCH_MINUTES + PINGER_SLOT_MINUTES + PLAN_GRACE_MINUTES) * MINUTE).toBeLessThan(tightest);
  });

  it("keeps production at an hour inside its threshold when the 13:00 call and then the stretched run's own call are missed", () => {
    // Aligned on the hour at 12:00; 13:00 never arrives, so 13:15 runs and stretches to 14:30;
    // 14:30 never arrives either, so 14:45 runs — ninety minutes, inside ninety-five — and 16:00
    // is back on the hour. Under a thirty-minute stretch the second gap was 13:15 → 15:00, 105.
    const every60 = (ranAt: Date) => idle(ranAt, 60);
    const runs = realRuns(club("12:00"), club("17:30"), every60, 15, new Set([0, 2]));
    expect(runs.map((run) => run.slot)).toEqual([club("12:00"), club("13:15"), club("14:45"), club("16:00"), club("17:00")]);
    expect(firstCrossing(runs, 60, 15)).toBeNull();
  });

  it.each([15, 60])("holds with any one call dropped while runs move onto the interval's marks, with a %i-minute day pinger", (dayMinutes) => {
    // Starts off the interval's marks by day — on the pinger's grid, and off it as a woken run is —
    // so the stretched runs are the ones a dropped call follows.
    const starts = [
      ...["08:15", "08:30", "08:45", "09:00", "09:15", "09:30", "09:45"].map((time) => club(time)),
      ...["08:05:17", "08:40:17", "09:20:17"].map((time) => club(time)),
    ];
    for (const cadence of CADENCES) {
      const plans: Rule[] = [
        (ranAt) => idle(ranAt, cadence),
        (ranAt) => planQuiet({ ranAt, nextWorkAt: after(ranAt, 1), cadenceMinutes: cadence, failed: false }),
      ];
      for (const plan of plans) {
        for (const start of starts) {
          for (let drop = 0; drop < 10; drop++) {
            const runs = realRuns(start, club("23:30"), plan, dayMinutes, new Set([drop]));
            expect(firstCrossing(runs, cadence, dayMinutes), `${cadence} min from ${start.toISOString()}, call ${drop} dropped`).toBeNull();
          }
        }
      }
    }
  });
});
