import { confirmationWindow } from "./hold-deadlines";

/**
 * A changed participation window moves the holds it gave (§665, amending §104, §407).
 *
 * A hold taken before an event's window opens ends where the window says — its deadline, or the
 * start when the deadline is 0 (`computeDeclarationHoldExpiry`) — and that instant is written on the
 * row once. Until §665 a later change of the two numbers on the event moved nothing: the rows kept
 * the deadline of the window they were given under, while the editor, the emails and the job read
 * the new one. These are the pure rules of the move; `registrations/window-holds.ts` performs it in
 * the save's transaction, under the event lock.
 *
 * Pure and client-safe: no database, no clock.
 */

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/**
 * The most days before the start a window's deadline can be (`fields.ts`: 0–60). A hold further out
 * than that was not given by a window.
 */
export const WINDOW_DEADLINE_MAX_DAYS = 60;

/** The event's start and its two window numbers, as stored. */
export type WindowedEvent = {
  startsAt: Date;
  confirmationOpensDaysBefore?: number | null;
  confirmationDeadlineDaysBefore?: number | null;
};

/**
 * The instant a window gives a hold taken before it opens: the window's deadline, never after the
 * start (`computeDeclarationHoldExpiry` as if confirmed before the opening) — and with no window at
 * all (switched off, or the numbers in the wrong order), the start: §160's lenient rule, a place that
 * waits for its declaration until the race begins.
 */
export function windowHoldInstant(event: WindowedEvent): Date {
  const start = event.startsAt.getTime();
  const window = confirmationWindow(event);
  return new Date(window ? Math.min(window.deadline.getTime(), start) : start);
}

/**
 * Whether a stored hold is one a window gave: a whole number of days before the start, between the
 * start itself (a deadline of 0) and `WINDOW_DEADLINE_MAX_DAYS`. The club's minutes (§377) are counted
 * from a click, to the millisecond, and an outage's move (§657) by the time the door was shut; neither
 * lands on a whole day before the start by anything but chance, and the one cap that can — the
 * registration close — is set apart by the caller.
 */
export function isWindowGivenInstant(at: Date, startsAt: Date): boolean {
  const before = startsAt.getTime() - at.getTime();
  return before >= 0 && before % DAY === 0 && before / DAY <= WINDOW_DEADLINE_MAX_DAYS;
}

/**
 * Where a window-given hold goes after a save: the new window's instant (`windowHoldInstant`), never
 * earlier than now plus the club's hold minutes — a save at the last minute expires nobody on the spot,
 * and the person has the time the club gives anybody to sign — and never after the start. `floored` says
 * the floor decided it (the new deadline has passed, or is within the minutes). Null once the event has
 * started: nothing is held then (§160).
 */
export function windowHoldTarget(after: WindowedEvent, now: Date, holdMinutes: number): { to: Date; floored: boolean } | null {
  const start = after.startsAt.getTime();
  if (start <= now.getTime()) return null;
  const natural = windowHoldInstant(after).getTime();
  const floor = now.getTime() + holdMinutes * MINUTE;
  if (natural >= floor) return { to: new Date(natural), floored: false };
  return { to: new Date(Math.min(floor, start)), floored: true };
}

/**
 * The move a save makes of the holds the OLD window gave: from its instant to the new one's (floored by
 * now plus the club's minutes, capped by the start) — or null when the save leaves the window's instant
 * where it was (a second identical save moves nothing), or the event has started.
 */
export function holdsMovedByWindowChange(input: {
  before: WindowedEvent;
  after: WindowedEvent;
  now: Date;
  holdMinutes: number;
}): { from: Date; to: Date } | null {
  const target = windowHoldTarget(input.after, input.now, input.holdMinutes);
  if (!target) return null;
  const from = windowHoldInstant(input.before);
  if (windowHoldInstant(input.after).getTime() === from.getTime()) return null;
  if (target.to.getTime() === from.getTime()) return null;
  return { from, to: target.to };
}

/** A `PENDING_DECLARATION` row as the move reads it. */
export type HeldRow = { id: string; holdExpiresAt: Date | null };

/**
 * Which rows a save moves, each from and to.
 *
 * - Every row at the old window's instant (`holdsMovedByWindowChange`), to the new one.
 * - While the new instant is still ahead of the floor, also every other window-given hold
 *   (`isWindowGivenInstant`, counted from the start as it stood before the save) — a hold given under a
 *   window older than the one stored, the deadline of 0 the event had before somebody set 5 included —
 *   to the same instant: the rows say what the event says, and a save that changes nothing aligns them
 *   once and then finds nothing to do. A hold at the registration close — the close as saved, and the
 *   close as it stood before the save — is left alone unless it is the old instant itself: the club's
 *   minutes are capped by the close (`capHoldExpiry`), a close may fall a whole number of days before
 *   the start, and a save that moves the close must not take the holds capped at the old one for a
 *   window's.
 * - Once the new instant is behind the floor, only the old instant's rows, and only when the window
 *   changed: an unchanged window never shortens a kept hold to the club's minutes.
 *
 * A hold the club's minutes gave inside the window is neither, and stays. Offers are not rows here: the
 * caller reads `PENDING_DECLARATION` only. `kind` is not read (§30): a test row moves like a real one.
 */
export function windowHoldMoves(input: {
  holds: readonly HeldRow[];
  /** The event as it stood before the save, its registration close with it (the cap the old holds were given under). */
  before: WindowedEvent & { registrationClosesAt?: Date | null };
  after: WindowedEvent;
  now: Date;
  holdMinutes: number;
  /** The registration close as the save leaves it. */
  registrationClosesAt: Date | null;
}): { id: string; from: Date; to: Date }[] {
  const target = windowHoldTarget(input.after, input.now, input.holdMinutes);
  if (!target) return [];
  const exact = holdsMovedByWindowChange(input);
  const closes = new Set([input.registrationClosesAt, input.before.registrationClosesAt].flatMap((close) => (close ? [close.getTime()] : [])));
  return input.holds.flatMap((row) => {
    const at = row.holdExpiresAt;
    if (!at) return [];
    if (exact && at.getTime() === exact.from.getTime()) return [{ id: row.id, from: at, to: exact.to }];
    if (target.floored || at.getTime() === target.to.getTime()) return [];
    if (!isWindowGivenInstant(at, input.before.startsAt)) return [];
    if (closes.has(at.getTime())) return [];
    return [{ id: row.id, from: at, to: target.to }];
  });
}
