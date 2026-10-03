import type { UnreachableSource } from "@/db/schema/unreachable-windows";
import { jobStalenessThresholdMs, pingerCadenceMinutes } from "@/modules/jobs/quiet-hours";
import type { NameProbeStatus } from "@/modules/resilience/domain/name-probe";
import { capHoldExpiry } from "./hold-deadlines";

/**
 * The clock stops while the door is shut (§NNN): the outage grace's rules, without a database. On
 * 2026-10-03 the registrar held the club's domain for its contact verification, from about 11:04 to
 * 18:24 UTC; the owner, the same day: «DO IT! Make it super safe!».
 *
 * That day the site, the backoffice, QA and the email subdomain were unreachable by name, and the two
 * pingers call the public name, so no job ran — while every participant's deadline kept running.
 * Nobody lost a place only because no sweep ran before the name came back. This file decides, from
 * what the maintenance run can see, whether the platform was unreachable, from when to when, and where
 * each deadline moves; `registrations/outage-grace.ts` reads and writes.
 *
 * **Two signals, one kind of window.**
 * - **`pings`.** The pinger calls every job at the deployment's cadence (`quiet-hours.ts`), and every
 *   call — answered from the cache or run for real — is remembered (`schedule-cache.ts`). A silence
 *   longer than the pinger's own threshold (`jobStalenessThresholdMs`: twice the cadence plus five
 *   minutes, 125 minutes at night) is a window: from the call that should have come (the last one plus
 *   the cadence) to the first that came. The same threshold the health check pages on — never a
 *   second one. It cannot tell a dead pinger from a dead name, and takes the participant's side.
 * - **`dns`.** When the job is reached by another address while the public name answers «no such
 *   name» (`resilience/domain/name-probe.ts`) on two probes at least ten minutes apart, a window opens
 *   at the first probe's instant and stays open until the name answers again. One such answer alone is
 *   a suspicion: it holds nothing and tells nobody, so one transient «no such name» from a resolver
 *   moves no deadline.
 *
 * **While a `dns` window is open** every real run moves the running deadlines later by the time since
 * the run before (`grownGrant`), within the club's «Termene» number, so none reads as lapsed and none
 * frees its place while nobody can reach the page that would act on it; the sweeps are held as well,
 * belt and braces. **Once a window is over**, every deadline still running at its start has been moved
 * later by its length, within the same cap, one written inside it by what was left of it, and one
 * written after it not at all; a deadline that passed before the window started never moves. A claim whose deadline passed while the door was shut and whose counted place was given
 * meanwhile is not revived (`registrations/outage-grace.ts`): the job seats nobody.
 */

/** A window's span, closed. */
export type WindowSpan = { startedAt: Date; endedAt: Date };

/** A window already written, as the planner needs it. `confirmedAt` null: a `dns` suspicion (one probe so far). */
export type KnownWindow = { id: string; source: UnreachableSource; startedAt: Date; endedAt: Date | null; confirmedAt: Date | null };

const MINUTE = 60_000;

/** A window shorter than this moves nothing: deadlines are stated to the minute. */
export const OUTAGE_MIN_MS = MINUTE;

/** How far apart the two «no such name» probes that open a `dns` window must be, at least. */
export const DNS_CONFIRM_MS = 10 * MINUTE;

/** The club's cap on what one window gives back, in milliseconds; zero switches the moving off (the windows are still recorded and announced). */
export function outageGraceMaxMs(deadlines: { outageGraceMaxHours: number }): number {
  return Math.max(0, deadlines.outageGraceMaxHours) * 60 * MINUTE;
}

/**
 * The silences in the pings longer than the pinger's threshold. `byJob` holds, for each job, every
 * instant the platform is known to have been reached by that job's calls between the anchor and now:
 * its remembered pings and its real runs (the maintenance's own anchor and this run among them). A
 * silence between two instants of all of them together is judged with the larger of the two
 * thresholds and the larger of the two cadences, so a stretch that spans the quiet hours' start is
 * measured as the night would — the conservative reading: fewer windows, shorter ones.
 *
 * **Both pingers' calls must be missing together** (two independent monitors call the two jobs), and
 * each job must have a call remembered before the silence: a silence read where one job's calls are
 * absent altogether is the cache's, not the door's. So one evicted slot opens nothing — the other
 * job's call covers it, and even both jobs' slots of one quarter of an hour leave a gap of two
 * cadences, under the threshold — and the cache must lose both jobs' calls for longer than the
 * threshold in a row, or a whole job's, to be read as a silence, which the second rule refuses.
 */
export function findPingGaps(byJob: readonly (readonly Date[])[], dayCadence: number): WindowSpan[] {
  const series = byJob.map((instants) => instants.map((at) => at.getTime()));
  const sorted = [...new Set(series.flat())].sort((a, b) => a - b);
  const gaps: WindowSpan[] = [];
  for (let index = 1; index < sorted.length; index += 1) {
    const from = new Date(sorted[index - 1]);
    const to = new Date(sorted[index]);
    const threshold = Math.max(jobStalenessThresholdMs(from, dayCadence), jobStalenessThresholdMs(to, dayCadence));
    if (to.getTime() - from.getTime() <= threshold) continue;
    // Each job heard before the silence: otherwise the cache, not the pinger, is what fell silent.
    if (!series.every((instants) => instants.some((at) => at <= from.getTime()))) continue;
    const cadence = Math.max(pingerCadenceMinutes(from, dayCadence), pingerCadenceMinutes(to, dayCadence));
    // The window is the silence less the one call that was not yet due: `gap − cadence`.
    gaps.push({ startedAt: new Date(from.getTime() + cadence * MINUTE), endedAt: to });
  }
  return gaps;
}

function overlaps(span: { startedAt: Date; endedAt: Date | null }, other: { startedAt: Date; endedAt: Date | null }, now: Date): boolean {
  const aEnd = (span.endedAt ?? now).getTime();
  const bEnd = (other.endedAt ?? now).getTime();
  return span.startedAt.getTime() < bEnd && other.startedAt.getTime() < aEnd;
}

export type OutagePlan = {
  /** A first «no such name»: write a `dns` suspicion at this instant. It holds nothing and tells nobody. */
  suspect: { startedAt: Date } | null;
  /** A second «no such name» at least ten minutes after the suspicion: the window opens, from the first probe's instant. */
  confirm: { id: string; startedAt: Date } | null;
  /** The name answered while only suspected: the suspicion is dropped, nothing ever happened. */
  clear: { id: string } | null;
  /** The open window to close, at this instant. */
  close: { id: string; endedAt: Date } | null;
  /** Past silences of the pings to write as closed windows, none overlapping a window already written. */
  record: WindowSpan[];
  /** Whether this run holds every lapse: a `dns` window is open, within the club's cap. Never while the cap is 0. */
  holding: boolean;
};

/**
 * What this run does about the door. `windows` are the windows already written that may overlap a
 * silence (the open one and a suspicion among them); `gaps` the silences `findPingGaps` found since
 * the anchor.
 *
 * - «No such name» with nothing open: a suspicion at this run's instant. With a suspicion at least ten
 *   minutes old: the window opens from its instant (from the end of a window already recorded inside
 *   it, if one is). With a window open: it stays open.
 * - The name resolves, or is not asked here (a laptop, a test, an address that is not a name): an
 *   open window closes now, a suspicion is dropped.
 * - No answer (a timeout, a resolver that failed): nothing opens, closes or is dropped on it.
 *
 * The cap at 0 switches the moving off, never the seeing: windows are still recorded, opened, closed
 * and announced; only the sweeps are no longer held. A window open longer than the club's cap no longer
 * holds the sweeps either: beyond it the clock runs again, as the cap says.
 */
export function planOutage(input: {
  now: Date;
  probe: NameProbeStatus;
  windows: readonly KnownWindow[];
  gaps: readonly WindowSpan[];
  maxMs: number;
}): OutagePlan {
  const { now, probe, maxMs } = input;
  const open = input.windows.find((window) => window.endedAt === null && window.confirmedAt !== null) ?? null;
  const suspicion = input.windows.find((window) => window.endedAt === null && window.confirmedAt === null) ?? null;
  const holds = (startedAt: Date) => maxMs > 0 && now.getTime() - startedAt.getTime() <= maxMs;

  const plan: OutagePlan = { suspect: null, confirm: null, clear: null, close: null, record: [], holding: false };
  if (probe === "unresolved") {
    if (open) plan.holding = holds(open.startedAt);
    else if (suspicion) {
      if (now.getTime() - suspicion.startedAt.getTime() >= DNS_CONFIRM_MS) {
        // From the first probe — or from the end of a `pings` window already recorded inside the suspicion, so no stretch is given back twice.
        const covered = input.windows
          .filter((window) => window.endedAt !== null && window.endedAt > suspicion.startedAt && window.endedAt <= now)
          .map((window) => (window.endedAt as Date).getTime());
        const startedAt = new Date(Math.max(suspicion.startedAt.getTime(), ...covered));
        plan.confirm = { id: suspicion.id, startedAt };
        plan.holding = holds(startedAt);
      }
    } else plan.suspect = { startedAt: now };
  } else if (probe === "unknown") {
    if (open) plan.holding = holds(open.startedAt);
  } else {
    if (open) plan.close = { id: open.id, endedAt: now };
    if (suspicion) plan.clear = { id: suspicion.id };
  }

  // A suspicion is no window: a silence inside it is recorded unless the suspicion is confirmed this run.
  const taken: { startedAt: Date; endedAt: Date | null }[] = [
    ...input.windows.filter((window) => window.confirmedAt !== null),
    ...(plan.confirm ? [{ startedAt: plan.confirm.startedAt, endedAt: null }] : []),
  ];
  for (const gap of input.gaps) {
    if (gap.endedAt.getTime() - gap.startedAt.getTime() < OUTAGE_MIN_MS) continue;
    if (taken.some((window) => overlaps(gap, window, now))) continue;
    plan.record.push(gap);
    taken.push(gap);
  }
  return plan;
}

/** What a window gives back to the deadlines: its length, capped by the club's number (0: the moving is off). */
export function grantedMsFor(window: WindowSpan, maxMs: number): number {
  return Math.max(0, Math.min(window.endedAt.getTime() - window.startedAt.getTime(), maxMs));
}

/**
 * What a window gives back once it has lasted until `until` — while a `dns` window is open, `until` is
 * this run; once closed, its end — never less than it already gave: time given is never taken back,
 * even when the club lowers the cap meanwhile.
 */
export function grownGrant(window: { startedAt: Date; grantedMs: number }, until: Date, maxMs: number): number {
  return Math.max(window.grantedMs, grantedMsFor({ startedAt: window.startedAt, endedAt: until }, maxMs));
}

/**
 * Where one deadline moves for one step of a window, or null when it stays as it is. `since` is the
 * window's start plus what earlier steps already gave back (`applied_ms`), `grantedMs` this step's
 * amount: a `pings` window has one step, from its start; an open `dns` window one per run.
 *
 * - A deadline that passed at or before `since` never moves: the door was open then, or the deadline
 *   was not revived by an earlier step.
 * - Of a closed window (`endedAt`), only what was running inside it: a deadline written after the
 *   window ended (`writtenAt`, the row's own instant) never moves — a `pings` window is seen at the
 *   first real run after it, which may come hours later, when the pings went on being answered from
 *   the cache — and one written inside it moves by what was left of it (`endedAt − writtenAt`), never
 *   by more. `writtenAt` is an instant at or before the deadline's write, never after it, so a deadline
 *   that was running is never denied its move. An open window has no end yet: its steps move what is
 *   running at `since`, as before.
 * - Later, never earlier, by the step's amount alone, then capped as the allocator caps it —
 *   a hold or an offer by the close and the start (`capHoldExpiry`), an invitation by the start alone
 *   (§647); a link is not capped by the event, as it never was (§513).
 * - A move that still leaves the deadline behind `now` writes nothing: it would change no answer.
 */
export function movedDeadline(input: {
  stored: Date;
  since: Date;
  grantedMs: number;
  now: Date;
  cap?: { registrationClosesAt: Date | null; startsAt: Date } | null;
  /** When the deadline was written, or an instant before it — never after; null when the row cannot say (then the step's whole amount). */
  writtenAt?: Date | null;
  /** The window's end, once it is over; null while it is open. */
  endedAt?: Date | null;
}): Date | null {
  const { stored, since, now, cap, writtenAt, endedAt } = input;
  let grantedMs = input.grantedMs;
  if (endedAt && writtenAt && writtenAt.getTime() > since.getTime()) grantedMs = Math.min(grantedMs, endedAt.getTime() - writtenAt.getTime());
  if (grantedMs < OUTAGE_MIN_MS) return null;
  if (stored.getTime() <= since.getTime()) return null;
  let next = new Date(stored.getTime() + grantedMs);
  if (cap) next = capHoldExpiry({ naiveExpiresAt: next, registrationClosesAt: cap.registrationClosesAt, eventStartsAt: cap.startsAt });
  if (next.getTime() <= stored.getTime() || next.getTime() <= now.getTime()) return null;
  return next;
}

/**
 * A window closed this long ago whose moves still fail stops holding the sweeps and stops counting as
 * an error the next ping can repair: a step that fails on every run must not freeze every deadline for
 * good, nor keep every ping running for real. «Sarcini» shows it red instead (`stuck`).
 */
export const PENDING_HOLD_MS = 2 * 60 * MINUTE;

export type UnreachableWindowState = "open" | "stuck" | "notRevived" | "clear";

/**
 * What «Sarcini» says of the windows (§NNN): `open` while a window is open — nobody reaches the site
 * by its name; `stuck` while a window closed more than `PENDING_HOLD_MS` ago still has deadlines it
 * could not move; `notRevived` while the newest closed window left a claim it did not revive still
 * lapsed on an event that has not started (`notRevivedWaiting`, read by `jobs/unreachable-windows.ts`)
 * — an Administrator decides whether to seat that person through a confirmed supplementary place;
 * `clear` otherwise. A suspicion is no window and changes nothing here.
 */
export function unreachableWindowState(
  windows: readonly { endedAt: Date | null; confirmedAt: Date | null; appliedAt: Date | null }[],
  now: Date,
  notRevivedWaiting: number,
): UnreachableWindowState {
  const confirmed = windows.filter((window) => window.confirmedAt !== null);
  if (confirmed.some((window) => window.endedAt === null)) return "open";
  if (confirmed.some((window) => window.endedAt && window.appliedAt === null && now.getTime() - window.endedAt.getTime() >= PENDING_HOLD_MS)) return "stuck";
  return notRevivedWaiting > 0 ? "notRevived" : "clear";
}
