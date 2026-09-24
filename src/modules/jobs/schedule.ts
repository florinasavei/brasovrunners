/**
 * When a job has to look at the database again — the arithmetic of "a ping with nothing to do
 * does not wake PostgreSQL" (§NNN), pure, so every rule below is a test rather than a hope.
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
 */

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
 * No cached quiet period can end later than this after the run that wrote it: the cap, or the
 * longest minimum interval when that is longer. `wakeJobs` leans on it — work due further away
 * than this is found by a real run before it is due, with no invalidation needed.
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
 *   (`next-work.ts`); null when nothing at all is waiting.
 * - The cap is an hour — or the minimum interval, when the Administrator chose a longer one.
 * - A run that could not do everything (`failed`) promises nothing: the next ping tries again.
 *   The minimum interval still holds, because that is the Administrator's rule, not the job's.
 */
export function planQuiet(input: {
  ranAt: Date;
  nextWorkAt: Date | null;
  cadenceMinutes: JobCadenceMinutes;
  failed: boolean;
}): QuietPlan {
  const ranAt = input.ranAt.getTime();
  const capAt = ranAt + Math.max(NEXT_DUE_CAP_MINUTES, input.cadenceMinutes) * MINUTE;
  const next = input.nextWorkAt === null ? capAt : Math.min(input.nextWorkAt.getTime(), capAt);
  const quietUntil = input.failed ? ranAt : Math.max(next, ranAt);
  return {
    ranAt: input.ranAt,
    quietUntil: new Date(quietUntil),
    floorUntil: input.cadenceMinutes > 0 ? new Date(ranAt + input.cadenceMinutes * MINUTE) : null,
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
