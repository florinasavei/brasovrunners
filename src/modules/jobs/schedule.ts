/**
 * When a job has to look at the database again — the arithmetic of "a ping with nothing to do
 * does not wake PostgreSQL" (§334), pure, so every rule below is a test rather than a hope.
 *
 * The owner, 2026-09-23: "I've spent 1 dollar in Neon in 2 days, I think I need to throttle".
 * Neon Launch bills a compute from the first query until five idle minutes later, and the
 * external pinger posts both job endpoints every fifteen minutes by day: the operations log
 * showed production awake 25 hours out of 37, three wakes in five at exactly :00/:15/:30/:45,
 * and almost every one of those runs found nothing to do.
 *
 * So each real run works out, from the database it already has awake, the earliest instant it
 * will next have anything to do — the soonest hold or offer deadline, the next reminder, the
 * next window to open, the next outbox retry — and leaves that instant in Next's data cache
 * (`schedule-cache.ts`). A ping that arrives before it answers from the cache and never opens a
 * connection. Two rules bound how wrong that can be:
 *
 * - **The cap.** Whatever the computation says, the job looks for real at least once an hour
 *   (`NEXT_DUE_CAP_MINUTES`). A duty this file forgot, a write path that forgot to say it made
 *   work, a clock that moved: each costs at most an hour, never "never".
 * - **Nothing here is correctness.** A hold that lapses is lapsed on every read, whether or not
 *   the job has run (AGENTS.md §10.6, `repository.ts#countOccupied`); a skipped run delays a
 *   message or a hand-over to the waiting list and cannot give a place twice.
 *
 * The Administrator may slow it further (`platform_settings.jobCadence`, `cadence.ts`): a
 * minimum number of minutes between two real runs of each job, whatever the pinger does. A
 * minimum longer than the cap wins over the cap — the owner asked for a throttle, and a
 * throttle the platform overrides every hour is not one.
 *
 * ## On the pinger's hour, not an hour after the last run (§NNN)
 *
 * The owner, 2026-09-24, with Neon at $1.54 for 14.7 CU-hours in 2.3 days. After the release
 * above the operations log still showed production waking at 10:00, 10:15, 11:02, 12:02, 12:15,
 * 13:02, 13:15 and 14:15: the cap and the minimum interval were measured from the previous real
 * run, so each job's forced run drifted to wherever its last one happened — maintenance at :15
 * after a woken run, the outbox at :00 — and the health monitor's GET at :02 woke the database a
 * third time. Each separate wake is five billed minutes.
 *
 * So both now END on the pinger's own slots in the club's clock (`CLUB_TIME_ZONE`), and both
 * jobs' safety runs land on the same :00 call as the health check's wake:
 *
 * - **The cap** ends on the latest top of the hour no more than sixty minutes after the run
 *   (`safetyCapEnd`): a run at 10:15 looks again at the 11:00 call, never later than before.
 * - **A minimum interval** ends on the first boundary of its own length at least that many
 *   minutes after the run (`minimumIntervalEnd`: quarter-hours for 15, :00/:30 for 30, the hour
 *   for 60, even hours for 120) — a minimum stays a minimum, so it may only come later, and at
 *   most `ALIGN_STRETCH_MINUTES` (one pinger period) later, which leaves the job health's
 *   threshold room for one missed pinger call after the stretched run.
 * - **A deadline the work itself has** (`nextWorkAt`) is never moved: before it there is nothing
 *   to do, and after it the next call runs, exactly as before.
 */

import { CLUB_TIME_ZONE } from "@/i18n/dates";

export const JOB_NAMES = ["registration-maintenance", "email-outbox"] as const;
export type JobName = (typeof JOB_NAMES)[number];

export function isJobName(value: string): value is JobName {
  return (JOB_NAMES as readonly string[]).includes(value);
}

/** The safety net: at worst one real look an hour, whatever the computation said. */
export const NEXT_DUE_CAP_MINUTES = 60;

/**
 * The choices the Administrator has (`cadence.ts`), in minutes; zero is "only when something is
 * due" — the next-due rule and the cap, nothing more. Here rather than in the setting's module
 * because the longest of them bounds every cached quiet period (`MAX_QUIET_MINUTES`).
 */
export const JOB_CADENCE_CHOICES = [0, 15, 30, 60, 120] as const;
export type JobCadenceMinutes = (typeof JOB_CADENCE_CHOICES)[number];

/**
 * How much later than the owner's minimum interval its aligned end may come (§NNN), so that a
 * run off the interval's boundary moves toward it without ever tripping a health threshold. The
 * tightest one is production's by day, twice the fifteen-minute pinger plus five minutes past
 * max(cap, interval) (`quiet-hours.ts`, `health.ts`), and its promise is that one slow run never
 * flips it: one pinger period of stretch, one missed call after it and the grace come to 32 of
 * those 35 minutes. Thirty would leave five, and a stretched run followed by a single missed call
 * would read `stale` on `/api/health`. A boundary further than this is reached over several runs,
 * each at most this late: up to three under sixty minutes, seven under two hours.
 */
export const ALIGN_STRETCH_MINUTES = 15;

/**
 * No cached quiet period that a wake could shorten ends later than this after the run that wrote
 * it: the cap, or the longest minimum interval when that is longer. `wakeJobs` leans on it — work
 * due further away than this is found by a real run before it is due, with no invalidation needed.
 *
 * An interval's alignment may end its quiet up to `ALIGN_STRETCH_MINUTES` later (§NNN), and that
 * is still covered: an interval at least as long as the cap ends the quiet exactly where its floor
 * ends, and a wake forgets the quiet but never the floor, so work due in those extra minutes waits
 * for the owner's interval whether or not anything was invalidated.
 */
export const MAX_QUIET_MINUTES = Math.max(NEXT_DUE_CAP_MINUTES, ...JOB_CADENCE_CHOICES);

/**
 * The width of one cache slot. A slot is written once and never overwritten (see
 * `schedule-cache.ts` for why), so a run leaves one slot per five minutes of quiet ahead of it,
 * and a ping reads the one slot its own minute falls in.
 */
export const SLOT_MINUTES = 5;
const SLOT_MS = SLOT_MINUTES * 60_000;
const MINUTE = 60_000;

/**
 * How much earlier than their boundary the cap and the minimum interval end — a whole number of
 * minutes after the run under §334, the pinger's slot since §NNN — so the pinger's call on the
 * boundary runs rather than skipping.
 *
 * `ranAt` is taken when the handler starts, after whatever cold start that invocation paid, and
 * the next on-schedule ping lands a pinger period later give or take the same latency — a few
 * hundred milliseconds either side of "exactly an hour". Without this, a ping that landed early
 * read the old slot and skipped, and the next real run was a whole pinger period late: at night,
 * with the hourly pinger, "at least once every sixty minutes" came out as every sixty *or* every
 * hundred and twenty, at random, and an outbox retry could sit long enough for `/api/health` to
 * call email stalled. Two minutes absorbs any latency the platform has and is well under one
 * slot and one pinger period, so it never lets a ping that is really early through. Deadlines the
 * work itself has (`nextWorkAt`) get no grace: before them there is genuinely nothing to do.
 */
export const PLAN_GRACE_MINUTES = 2;
const GRACE_MS = PLAN_GRACE_MINUTES * MINUTE;

/**
 * The pinger's grid (§NNN): it calls both endpoints on the quarter-hours of the club's clock by
 * day and on the hour at night (§68, §280). Every boundary an alignment aims at is one of these
 * instants, which in the club's zone — two or three hours from UTC — are UTC's quarter-hours too.
 */
export const PINGER_SLOT_MINUTES = 15;
const PINGER_SLOT_MS = PINGER_SLOT_MINUTES * MINUTE;
/** Four hours of candidates: two even hours are at most three apart, on the autumn change. */
const BOUNDARY_SEARCH_STEPS = (4 * 60) / PINGER_SLOT_MINUTES;

/** The club's wall clock, hour and minute — read by the scheduler, never shown. Built once. */
const clubClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: CLUB_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Minutes since midnight on the club's wall clock at `at`, 0 to 1439, through daylight saving. */
export function clubMinuteOfDay(at: Date | number): number {
  let hour = 0;
  let minute = 0;
  for (const part of clubClock.formatToParts(at)) {
    // `% 24`: an engine that still writes midnight as "24" under h23 reads as 0.
    if (part.type === "hour") hour = Number(part.value) % 24;
    else if (part.type === "minute") minute = Number(part.value);
  }
  return hour * 60 + minute;
}

/** Whether the pinger-grid instant `at` is a boundary of `lengthMinutes` on the club's clock. */
function onClubBoundary(at: number, lengthMinutes: number): boolean {
  return clubMinuteOfDay(at) % lengthMinutes === 0;
}

/**
 * The first instant at or after `at` that is a boundary of `lengthMinutes` on the club's clock —
 * a quarter-hour for 15, :00 or :30 for 30, the top of the hour for 60, an even hour for 120 — or
 * null when none falls within four hours, which no real zone does. On the club's clock, so an
 * even hour stays even through daylight saving: 02:00 and 04:00 local are one hour apart on the
 * spring change and three on the autumn one.
 */
export function nextClubBoundary(at: Date, lengthMinutes: number): Date | null {
  const first = Math.ceil(at.getTime() / PINGER_SLOT_MS) * PINGER_SLOT_MS;
  for (let step = 0; step <= BOUNDARY_SEARCH_STEPS; step++) {
    const candidate = first + step * PINGER_SLOT_MS;
    if (onClubBoundary(candidate, lengthMinutes)) return new Date(candidate);
  }
  return null;
}

/** The latest boundary of `lengthMinutes` on the club's clock at or before `at`, or null (see `nextClubBoundary`). */
export function lastClubBoundary(at: Date, lengthMinutes: number): Date | null {
  const first = Math.floor(at.getTime() / PINGER_SLOT_MS) * PINGER_SLOT_MS;
  for (let step = 0; step <= BOUNDARY_SEARCH_STEPS; step++) {
    const candidate = first - step * PINGER_SLOT_MS;
    if (onClubBoundary(candidate, lengthMinutes)) return new Date(candidate);
  }
  return null;
}

/**
 * Where the safety cap ends after a run at `ranAt` (§NNN): two minutes before the latest top of
 * the hour on the club's clock that is at most sixty minutes after the run — the pinger's :00
 * call, whose wake the health monitor's :02 check shares. A run at 10:15 looks again at 11:00
 * (45 minutes), a run at 10:00:20 at 11:00.
 *
 * - **Never later than §334's rule**, `ranAt + 60 − grace`: it is the minimum of the two, so
 *   every threshold measured against the cap (`health.ts`, `quiet-hours.ts`, the email health)
 *   holds exactly as it did.
 * - **The hour is looked for up to the grace past the sixty minutes**, so a run whose :00 call
 *   landed a few hundred milliseconds early still counts as that hour's run and is next due at
 *   the following :00, not at the :00 two minutes after it.
 * - **Always after `ranAt`**, and only minutes after it when the run itself came shortly before
 *   an hour: that call finds the database still awake from the run, and from it the job is on
 *   the hour.
 */
export function safetyCapEnd(ranAt: Date): Date {
  const run = ranAt.getTime();
  const plain = run + NEXT_DUE_CAP_MINUTES * MINUTE - GRACE_MS;
  const hour = lastClubBoundary(new Date(run + NEXT_DUE_CAP_MINUTES * MINUTE + GRACE_MS), NEXT_DUE_CAP_MINUTES);
  return new Date(hour === null ? plain : Math.min(plain, hour.getTime() - GRACE_MS));
}

/**
 * Where the Administrator's minimum interval of `minutes` ends after a run at `ranAt` (§NNN). The
 * exact rule:
 *
 * 1. `earliest` is §334's end, `ranAt + minutes − grace`, and the soonest it may ever be: a
 *    minimum is a minimum, so alignment only ever moves the end later.
 * 2. The target is the first boundary of the interval's own length at or after `earliest`
 *    (`nextClubBoundary`: the quarter-hours for 15, :00/:30 for 30, the hour for 60, even hours
 *    for 120) — so QA's two-hour runs land on 00, 02, …, 22, and its health checks at 00:02,
 *    06:02, 12:02 and 18:02 ride their wakes.
 * 3. When that boundary is more than `ALIGN_STRETCH_MINUTES` (and the grace) past
 *    `ranAt + minutes`, the target is instead the latest pinger slot within that stretch: this
 *    run moves the job a quarter of an hour toward the boundary and later ones reach it. From a
 *    run on the pinger's grid only 60 and 120 ever need it — a run at 10:15 under 60 goes to
 *    11:30, 12:45, then 14:00; a run off the grid (a woken one at 10:05) may need it under 30.
 * 4. The end is two minutes before the target, so the target's call runs even when it lands
 *    early — but never before `earliest`.
 */
export function minimumIntervalEnd(ranAt: Date, minutes: number): Date {
  const run = ranAt.getTime();
  const earliest = run + minutes * MINUTE - GRACE_MS;
  const latest = run + (minutes + ALIGN_STRETCH_MINUTES) * MINUTE + GRACE_MS;
  let target = nextClubBoundary(new Date(earliest), minutes);
  if (target === null || target.getTime() > latest) target = lastClubBoundary(new Date(latest), PINGER_SLOT_MINUTES);
  return new Date(target === null ? earliest : Math.max(earliest, target.getTime() - GRACE_MS));
}

/** The start of the slot `at` falls in, as the cache key names it. */
export function slotStart(at: Date): Date {
  return new Date(Math.floor(at.getTime() / SLOT_MS) * SLOT_MS);
}

/**
 * Every slot a ping could fall in while it should still wait: from the slot of `from` to the
 * last slot that begins before `until`. Empty when `until` is not after `from`.
 */
export function slotsBetween(from: Date, until: Date): Date[] {
  const slots: Date[] = [];
  if (until.getTime() <= from.getTime()) return slots;
  for (let at = slotStart(from).getTime(); at < until.getTime(); at += SLOT_MS) slots.push(new Date(at));
  return slots;
}

/** The slots a lookback of `horizonMs` ending at `now` touches, newest first. */
export function slotsBack(now: Date, horizonMs: number): Date[] {
  const slots: Date[] = [];
  const oldest = slotStart(new Date(now.getTime() - horizonMs)).getTime();
  for (let at = slotStart(now).getTime(); at >= oldest; at -= SLOT_MS) slots.push(new Date(at));
  return slots;
}

/** What a real run leaves behind for the pings after it. */
export type QuietPlan = {
  ranAt: Date;
  /** Until when a ping answers "nothing due" without the database. Equal to `ranAt`: the next ping runs. */
  quietUntil: Date;
  /** Until when the Administrator's minimum interval holds every ping back, or null when there is none. */
  floorUntil: Date | null;
  cadenceMinutes: JobCadenceMinutes;
};

/**
 * The quiet a finished run may promise.
 *
 * - `nextWorkAt` is the earliest instant the job will have something to do, from the database
 *   (`next-work.ts`); null when nothing at all is waiting. It is never aligned (§NNN): before it
 *   there is nothing to do, and after it the next ping runs.
 * - The cap ends on the pinger's top of the hour, at most an hour after the run
 *   (`safetyCapEnd`) — or where the minimum interval ends, when the Administrator chose one at
 *   least as long as the cap.
 * - The minimum interval ends on a boundary of its own length, never sooner than the interval
 *   (`minimumIntervalEnd`).
 * - A run that could not do everything (`failed`) promises nothing: the next ping tries again.
 *   The minimum interval still holds, because that is the Administrator's rule, not the job's.
 * - The cap and the interval both end `PLAN_GRACE_MINUTES` before their boundary, so the ping on
 *   it — early or late by its latency — is the one that runs.
 */
export function planQuiet(input: {
  ranAt: Date;
  nextWorkAt: Date | null;
  cadenceMinutes: JobCadenceMinutes;
  failed: boolean;
}): QuietPlan {
  const ranAt = input.ranAt.getTime();
  const floorUntil = input.cadenceMinutes > 0 ? minimumIntervalEnd(input.ranAt, input.cadenceMinutes).getTime() : null;
  const capAt =
    floorUntil !== null && input.cadenceMinutes >= NEXT_DUE_CAP_MINUTES ? floorUntil : safetyCapEnd(input.ranAt).getTime();
  const next = input.nextWorkAt === null ? capAt : Math.min(input.nextWorkAt.getTime(), capAt);
  const quietUntil = input.failed ? ranAt : Math.max(next, ranAt);
  return {
    ranAt: input.ranAt,
    quietUntil: new Date(quietUntil),
    floorUntil: floorUntil === null ? null : new Date(floorUntil),
    cadenceMinutes: input.cadenceMinutes,
  };
}

/** A slot saying "nothing due until", written by a real run for each five minutes of its quiet. */
export type DueSlot = { quietUntil: string; ranAt: string; cadenceMinutes: number };
/** A slot saying "the minimum interval holds until", written only when the Administrator set one. */
export type FloorSlot = { until: string; ranAt: string; cadenceMinutes: number };
/** A slot saying "a ping arrived", for `/api/health`: the first ping of its five minutes. */
export type PingSlot = { at: string; ran: boolean };

export type PingVerdict =
  | { run: true }
  | { run: false; reason: "nothing-due" | "cadence"; until: Date; ranAt: Date; cadenceMinutes: number };

/**
 * Whether a ping at `now` does the work, from the two slots its minute falls in.
 *
 * A missing slot means run: nothing written (a fresh deployment, an evicted entry), or written
 * and then forgotten because a write path said new work exists (`wakeJobs`). The due slot is
 * asked first because it is the usual answer; the floor only matters once the due slot is gone
 * or has passed — which is exactly when a fresh registration made the job want to run, and the
 * Administrator's interval says not yet.
 */
export function decidePing(now: Date, due: DueSlot | null, floor: FloorSlot | null): PingVerdict {
  if (due && now.getTime() < Date.parse(due.quietUntil)) {
    return {
      run: false,
      reason: "nothing-due",
      until: new Date(due.quietUntil),
      ranAt: new Date(due.ranAt),
      cadenceMinutes: due.cadenceMinutes,
    };
  }
  if (floor && now.getTime() < Date.parse(floor.until)) {
    return {
      run: false,
      reason: "cadence",
      until: new Date(floor.until),
      ranAt: new Date(floor.ranAt),
      cadenceMinutes: floor.cadenceMinutes,
    };
  }
  return { run: true };
}

/**
 * The earliest instant a change to a registration on this event can have given the maintenance
 * job something to do — what the write paths hand `wakeJobs`, so that the ordinary case (a hold
 * that lapses in days, an email link that lapses in two, a reminder a day away) invalidates
 * nothing and the next scheduled look finds it anyway.
 *
 * The deadlines the change itself created — a hold, an offer; one already behind counts as now —
 * and the instants still ahead that the job acts on for the event: the start (holds and the
 * waiting list close), the registration close (the numbers settle), two days before the start
 * (the reminders), the participation window's opening (§104). An instant already behind is left
 * out: the run that passed it has done its work, and counting it as "now" would wake the job on
 * every signature of race week for nothing. Null when nothing the change touches is ahead.
 */
export function maintenanceDueFor(
  event: {
    startsAt: Date;
    registrationClosesAt: Date | null;
    confirmationOpensDaysBefore?: number | null;
    confirmationDeadlineDaysBefore?: number | null;
  },
  now: Date,
  ...deadlines: (Date | null | undefined)[]
): Date | null {
  const at = now.getTime();
  const day = 24 * 60 * MINUTE;
  const candidates: number[] = [];
  for (const deadline of deadlines) if (deadline) candidates.push(Math.max(deadline.getTime(), at));
  const start = event.startsAt.getTime();
  const close = (event.registrationClosesAt ?? event.startsAt).getTime();
  const opens = event.confirmationOpensDaysBefore ?? 0;
  const deadlineDays = event.confirmationDeadlineDaysBefore ?? 0;
  const instants = [start, close, start - 48 * 60 * MINUTE];
  if (opens > 0 && opens > deadlineDays) instants.push(start - opens * day);
  for (const instant of instants) if (instant > at) candidates.push(instant);
  return candidates.length > 0 ? new Date(Math.min(...candidates)) : null;
}
