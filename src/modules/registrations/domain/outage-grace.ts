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
 * **While a `dns` window is open** the run lapses nothing — no address link, no hold, no offer, no
 * invitation, no family form — because nobody can reach the page that would act on them. **Once a
 * window is over**, every deadline still running at its start moves later by its length, capped by
 * the club's «Termene» number; a deadline that passed before the window started never moves.
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
 * The silences in the pings longer than the pinger's threshold. `evidence` is every instant the
 * platform is known to have been reached between the anchor and now, both included: the remembered
 * pings of both jobs and the real runs of both. A silence between two of them is judged with the
 * larger of the two thresholds and the larger of the two cadences, so a stretch that spans the
 * quiet hours' start is measured as the night would — the conservative reading: fewer windows,
 * shorter ones.
 */
export function findPingGaps(evidence: readonly Date[], dayCadence: number): WindowSpan[] {
  const sorted = [...new Set(evidence.map((at) => at.getTime()))].sort((a, b) => a - b);
  const gaps: WindowSpan[] = [];
  for (let index = 1; index < sorted.length; index += 1) {
    const from = new Date(sorted[index - 1]);
    const to = new Date(sorted[index]);
    const threshold = Math.max(jobStalenessThresholdMs(from, dayCadence), jobStalenessThresholdMs(to, dayCadence));
    if (to.getTime() - from.getTime() <= threshold) continue;
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
 * Where one deadline moves for a window, or null when it stays as it is.
 *
 * - A deadline that passed at or before the window started never moves: the door was open then.
 * - Later, never earlier, by what the window gives back alone, then capped as the allocator caps it —
 *   a hold or an offer by the close and the start (`capHoldExpiry`), an invitation by the start alone
 *   (§647); a link is not capped by the event, as it never was (§513).
 * - A move that still leaves the deadline behind `now` writes nothing: it would change no answer.
 */
export function movedDeadline(input: {
  stored: Date;
  windowStartedAt: Date;
  grantedMs: number;
  now: Date;
  cap?: { registrationClosesAt: Date | null; startsAt: Date } | null;
}): Date | null {
  const { stored, windowStartedAt, grantedMs, now, cap } = input;
  if (grantedMs < OUTAGE_MIN_MS) return null;
  if (stored.getTime() <= windowStartedAt.getTime()) return null;
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

export type UnreachableWindowState = "open" | "stuck" | "outside" | "clear";

/**
 * What «Sarcini» says of the windows (§NNN): `open` while a window is open; `stuck` while a window
 * closed more than `PENDING_HOLD_MS` ago still has deadlines it could not move; `outside` while the
 * newest closed window seated anyone outside the places — somebody must look at them; `clear`
 * otherwise. A suspicion is no window and changes nothing here.
 */
export function unreachableWindowState(
  windows: readonly { endedAt: Date | null; confirmedAt: Date | null; appliedAt: Date | null; placesOutside: number }[],
  now: Date,
): UnreachableWindowState {
  const confirmed = windows.filter((window) => window.confirmedAt !== null);
  if (confirmed.some((window) => window.endedAt === null)) return "open";
  if (confirmed.some((window) => window.endedAt && window.appliedAt === null && now.getTime() - window.endedAt.getTime() >= PENDING_HOLD_MS)) return "stuck";
  const newest = confirmed.reduce<(typeof confirmed)[number] | null>(
    (latest, window) => (window.endedAt && (!latest?.endedAt || window.endedAt > latest.endedAt) ? window : latest),
    null,
  );
  return newest && newest.placesOutside > 0 ? "outside" : "clear";
}
