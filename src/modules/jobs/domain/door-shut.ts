import type { DoorShutSource } from "@/db/schema/door-shut-windows";
import { capHoldExpiry } from "@/modules/registrations/domain/hold-deadlines";
import { jobStalenessThresholdMs, pingerCadenceMinutes } from "../quiet-hours";

/**
 * The clock stops while the door is shut (§NNN). The owner, after the registrar held the club's
 * domain for about seven hours on 2026-10-03: «DO IT! Make it super safe!».
 *
 * That day the site, the backoffice, QA and the email subdomain were unreachable by name, and the
 * two pingers call the public name, so no job ran — while every participant's deadline kept running.
 * Nobody lost a place only because no sweep ran before the name came back. This file decides, from
 * what the maintenance run can see, whether the door was shut, from when to when, and where each
 * deadline moves; `registrations/door-shut.ts` reads and writes.
 *
 * **Two signals, one window.**
 * - **The pings.** The pinger calls every job at the deployment's cadence (`quiet-hours.ts`), and
 *   every call — answered from the cache or run for real — is remembered (`schedule-cache.ts`). A
 *   silence longer than the pinger's own threshold (`jobStalenessThresholdMs`: twice the cadence plus
 *   five minutes, 125 minutes at night) is a door that was shut: from the call that should have come
 *   (the last one plus the cadence) to the first that came. The same threshold the health check pages
 *   on — never a second one.
 * - **The name.** When the job is reached by another address while the public name does not resolve
 *   (`resilience/domain/name-probe.ts`), the door is shut now: a window opens and stays open until the
 *   name answers again.
 *
 * **While a window is open** the run lapses nothing — no address link, no hold, no offer, no
 * invitation, no family form — because nobody can reach the page that would act on them. **Once it is
 * over**, every deadline still running at its start moves later by its length, capped by the club's
 * «Termene» number; a deadline that passed before the window started never moves.
 */

export type NameProbeStatus = "resolves" | "unresolved" | "unknown" | "skipped";

export type DoorWindowSpan = { startedAt: Date; endedAt: Date };

/** A window already written, as the planner needs it: when, and whether it is still open. */
export type KnownWindow = { id: string; startedAt: Date; endedAt: Date | null };

const MINUTE = 60_000;

/** A window shorter than this moves nothing: deadlines are stated to the minute. */
export const DOOR_SHUT_MIN_MS = MINUTE;

/** The club's cap on one window's stop, in milliseconds; zero is "switched off". */
export function doorShutMaxMs(deadlines: { doorShutMaxHours: number }): number {
  return Math.max(0, deadlines.doorShutMaxHours) * 60 * MINUTE;
}

/**
 * The silences in the pings longer than the pinger's threshold. `evidence` is every instant the
 * platform is known to have been reached between the anchor and now, both included: the remembered
 * pings of both jobs and the real runs of both. A silence between two of them is judged with the
 * larger of the two thresholds and the larger of the two cadences, so a stretch that spans the
 * quiet hours' start is measured as the night would — the conservative reading: fewer windows,
 * shorter ones.
 */
export function findPingGaps(evidence: readonly Date[], dayCadence: number): DoorWindowSpan[] {
  const sorted = [...new Set(evidence.map((at) => at.getTime()))].sort((a, b) => a - b);
  const gaps: DoorWindowSpan[] = [];
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

export type DoorPlan = {
  /** A window to open now (the name does not resolve and none is open). */
  open: { startedAt: Date; source: DoorShutSource } | null;
  /** The open window to close, at this instant. */
  close: { id: string; endedAt: Date } | null;
  /** Past silences of the pings to write as closed windows, none overlapping a window already written. */
  record: DoorWindowSpan[];
  /** Whether the door is shut now: the run lapses nothing while it is (within the club's cap). */
  shut: boolean;
};

/**
 * What this run does about the door. `windows` are the windows already written that may overlap a
 * silence (the open one among them); `gaps` the silences `findPingGaps` found since the anchor.
 *
 * - Switched off (`maxMs` zero): nothing opens, nothing is recorded, an open window closes now.
 * - The name does not resolve: the open window stays open, or one opens — from the silence that ends
 *   now, when the pings were silent up to this run, else from now.
 * - The name resolves, or is not asked here (a laptop, a test, an address that is not a name): an
 *   open window closes now.
 * - No answer (a timeout, a resolver that failed): nothing opens and nothing closes on it.
 *
 * A window open longer than the club's cap no longer holds the sweeps: beyond it the clock runs again,
 * as the cap says, and the window still closes when the name answers.
 */
export function planDoor(input: {
  now: Date;
  probe: NameProbeStatus;
  windows: readonly KnownWindow[];
  gaps: readonly DoorWindowSpan[];
  maxMs: number;
}): DoorPlan {
  const { now, probe, maxMs } = input;
  const openWindow = input.windows.find((window) => window.endedAt === null) ?? null;
  const within = (startedAt: Date) => now.getTime() - startedAt.getTime() <= maxMs;

  if (maxMs <= 0) {
    return { open: null, close: openWindow ? { id: openWindow.id, endedAt: now } : null, record: [], shut: false };
  }

  // The silence that ends at this very run, when the name is gone: the window starts there.
  const endingNow = input.gaps.find((gap) => gap.endedAt.getTime() >= now.getTime()) ?? null;
  let open: DoorPlan["open"] = null;
  let close: DoorPlan["close"] = null;
  let shut = false;

  if (probe === "unresolved") {
    if (openWindow) shut = within(openWindow.startedAt);
    else {
      open = { startedAt: endingNow ? endingNow.startedAt : now, source: "name" };
      shut = within(open.startedAt);
    }
  } else if (probe === "unknown") {
    if (openWindow) shut = within(openWindow.startedAt);
  } else if (openWindow) {
    close = { id: openWindow.id, endedAt: now };
  }

  const taken: { startedAt: Date; endedAt: Date | null }[] = [...input.windows, ...(open ? [{ startedAt: open.startedAt, endedAt: null }] : [])];
  const record: DoorWindowSpan[] = [];
  for (const gap of input.gaps) {
    if (open && endingNow && gap === endingNow) continue;
    if (gap.endedAt.getTime() - gap.startedAt.getTime() < DOOR_SHUT_MIN_MS) continue;
    if (taken.some((window) => overlaps(gap, window, now))) continue;
    record.push(gap);
    taken.push(gap);
  }
  return { open, close, record, shut };
}

/** How long a closed window stops the clock: its length, capped by the club's number. */
export function stoppedMs(window: DoorWindowSpan, maxMs: number): number {
  return Math.max(0, Math.min(window.endedAt.getTime() - window.startedAt.getTime(), maxMs));
}

/**
 * Where one deadline moves for a window, or null when it stays as it is.
 *
 * - A deadline that passed at or before the window started never moves: the door was open then.
 * - Later, never earlier, by the window's stop alone, then capped as the allocator caps it — a hold
 *   or an offer by the close and the start (`capHoldExpiry`), an invitation by the start alone (§647);
 *   a link is not capped by the event, as it never was (§513).
 * - A move that still leaves the deadline behind `now` writes nothing: it would change no answer.
 */
export function movedDeadline(input: {
  stored: Date;
  windowStartedAt: Date;
  stopMs: number;
  now: Date;
  cap?: { registrationClosesAt: Date | null; startsAt: Date } | null;
}): Date | null {
  const { stored, windowStartedAt, stopMs, now, cap } = input;
  if (stopMs < DOOR_SHUT_MIN_MS) return null;
  if (stored.getTime() <= windowStartedAt.getTime()) return null;
  let next = new Date(stored.getTime() + stopMs);
  if (cap) next = capHoldExpiry({ naiveExpiresAt: next, registrationClosesAt: cap.registrationClosesAt, eventStartsAt: cap.startsAt });
  if (next.getTime() <= stored.getTime() || next.getTime() <= now.getTime()) return null;
  return next;
}

/** How long «Sarcini» keeps a window that is over in front of the club (§NNN): a week to read what moved. */
export const DOOR_SHUT_RECENT_DAYS = 7;

/**
 * What «Sarcini» and `/devs` say of the door: `shut` while a window is open, `recent` for a week after
 * the latest one ended, `clear` otherwise.
 */
export function doorShutState(windows: readonly { startedAt: Date; endedAt: Date | null }[], now: Date): "shut" | "recent" | "clear" {
  if (windows.some((window) => window.endedAt === null)) return "shut";
  const latest = windows.reduce<Date | null>((newest, window) => (window.endedAt && (!newest || window.endedAt > newest) ? window.endedAt : newest), null);
  return latest && now.getTime() - latest.getTime() <= DOOR_SHUT_RECENT_DAYS * 24 * 60 * MINUTE ? "recent" : "clear";
}
