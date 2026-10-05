import { describe, expect, it } from "vitest";
import {
  holdsMovedByWindowChange,
  isWindowGivenInstant,
  windowHoldInstant,
  windowHoldMoves,
  windowHoldTarget,
} from "@/modules/registrations/domain/window-holds";

/**
 * BR-REQ-033-01 (`DECISIONS.md` §NNN, amending §104 and §407): a changed participation window moves
 * the holds it gave — the pure rules. The race of the brief: 21 Nov 2026 at 10:00 Romania time
 * (08:00 UTC), its window 15 / 5.
 */
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const START = new Date("2026-11-21T08:00:00.000Z");
const at = (daysBefore: number) => new Date(START.getTime() - daysBefore * DAY);
const event = (opens: number, deadline: number, startsAt = START) => ({ startsAt, confirmationOpensDaysBefore: opens, confirmationDeadlineDaysBefore: deadline });
const NOW = new Date("2026-10-05T09:00:00.000Z");

describe("§NNN the instant a window gives a hold taken before it opens", () => {
  it("is the deadline, the start at a deadline of 0, and the start with no window", () => {
    expect(windowHoldInstant(event(15, 5))).toEqual(at(5));
    expect(windowHoldInstant(event(15, 0))).toEqual(START);
    // Switched off (0 to open), or the numbers in the wrong order: no window, the place waits until the start (§160).
    expect(windowHoldInstant(event(0, 5))).toEqual(START);
    expect(windowHoldInstant(event(5, 5))).toEqual(START);
  });

  it("tells a window's hold from the club's minutes by the whole days before the start", () => {
    expect(isWindowGivenInstant(at(5), START)).toBe(true);
    expect(isWindowGivenInstant(START, START)).toBe(true);
    expect(isWindowGivenInstant(at(60), START)).toBe(true);
    expect(isWindowGivenInstant(at(61), START)).toBe(false);
    expect(isWindowGivenInstant(new Date(at(5).getTime() + 30 * MINUTE), START)).toBe(false);
    expect(isWindowGivenInstant(new Date(START.getTime() + DAY), START)).toBe(false);
  });
});

describe("§NNN holdsMovedByWindowChange", () => {
  const holdMinutes = 30;

  it("moves a deadline of 0 to 5 days before the start", () => {
    expect(holdsMovedByWindowChange({ before: event(15, 0), after: event(15, 5), now: NOW, holdMinutes })).toEqual({ from: START, to: at(5) });
  });

  it("moves 5 days before to 2 days before", () => {
    expect(holdsMovedByWindowChange({ before: event(15, 5), after: event(15, 2), now: NOW, holdMinutes })).toEqual({ from: at(5), to: at(2) });
  });

  it("switched off: to the start; switched on: from the start to the deadline", () => {
    expect(holdsMovedByWindowChange({ before: event(15, 5), after: event(0, 5), now: NOW, holdMinutes })).toEqual({ from: at(5), to: START });
    expect(holdsMovedByWindowChange({ before: event(0, 5), after: event(15, 5), now: NOW, holdMinutes })).toEqual({ from: START, to: at(5) });
  });

  it("moves nothing on a save that leaves the window's instant where it was", () => {
    expect(holdsMovedByWindowChange({ before: event(15, 5), after: event(15, 5), now: NOW, holdMinutes })).toBeNull();
    // Only the opening moved: the deadline the holds were given stays.
    expect(holdsMovedByWindowChange({ before: event(15, 5), after: event(10, 5), now: NOW, holdMinutes })).toBeNull();
  });

  it("never earlier than now plus the club's minutes: a save after the new deadline passed", () => {
    const now = at(3);
    expect(holdsMovedByWindowChange({ before: event(15, 0), after: event(15, 5), now, holdMinutes })).toEqual({
      from: START,
      to: new Date(now.getTime() + 30 * MINUTE),
    });
  });

  it("never after the start, and nothing once the event has started", () => {
    const now = new Date(START.getTime() - 10 * MINUTE);
    expect(holdsMovedByWindowChange({ before: event(15, 2), after: event(15, 5), now, holdMinutes })).toEqual({ from: at(2), to: START });
    expect(holdsMovedByWindowChange({ before: event(15, 2), after: event(15, 5), now: START, holdMinutes })).toBeNull();
  });

  it("says when the floor decided the target", () => {
    expect(windowHoldTarget(event(15, 5), NOW, holdMinutes)).toEqual({ to: at(5), floored: false });
    expect(windowHoldTarget(event(15, 5), at(4), holdMinutes)).toEqual({ to: new Date(at(4).getTime() + 30 * MINUTE), floored: true });
  });
});

describe("§NNN windowHoldMoves — which rows move", () => {
  const holdMinutes = 30;
  const clubMinutes = new Date(NOW.getTime() - 10 * MINUTE);
  const holds = [
    { id: "start", holdExpiresAt: START },
    { id: "two-days", holdExpiresAt: at(2) },
    { id: "five-days", holdExpiresAt: at(5) },
    { id: "club-minutes", holdExpiresAt: clubMinutes },
    { id: "none", holdExpiresAt: null },
  ];
  const ids = (moves: { id: string }[]) => moves.map((move) => move.id).sort();

  it("the old instant's rows, and every other window-given hold, to the new deadline — never the club's minutes", () => {
    const moves = windowHoldMoves({ holds, before: event(15, 0), after: event(15, 5), now: NOW, holdMinutes, registrationClosesAt: null });
    expect(ids(moves)).toEqual(["start", "two-days"]);
    expect(moves.every((move) => move.to.getTime() === at(5).getTime())).toBe(true);
  });

  it("a save that changes nothing aligns the rows the stored window disagrees with, once", () => {
    const first = windowHoldMoves({ holds, before: event(15, 5), after: event(15, 5), now: NOW, holdMinutes, registrationClosesAt: null });
    expect(ids(first)).toEqual(["start", "two-days"]);
    const aligned = holds.map((row) => (first.some((move) => move.id === row.id) ? { ...row, holdExpiresAt: at(5) } : row));
    expect(windowHoldMoves({ holds: aligned, before: event(15, 5), after: event(15, 5), now: NOW, holdMinutes, registrationClosesAt: null })).toEqual([]);
  });

  it("leaves a hold at the registration close alone unless it is the old instant itself", () => {
    const moves = windowHoldMoves({ holds, before: event(15, 0), after: event(15, 5), now: NOW, holdMinutes, registrationClosesAt: at(2) });
    expect(ids(moves)).toEqual(["start"]);
  });

  it("past the new deadline: only the old instant's rows, and only when the window changed", () => {
    const now = at(3);
    const moved = windowHoldMoves({ holds, before: event(15, 0), after: event(15, 5), now, holdMinutes, registrationClosesAt: null });
    expect(ids(moved)).toEqual(["start"]);
    expect(moved[0].to).toEqual(new Date(now.getTime() + 30 * MINUTE));
    expect(windowHoldMoves({ holds, before: event(15, 5), after: event(15, 5), now, holdMinutes, registrationClosesAt: null })).toEqual([]);
  });

  it("a moved start carries the holds given against the old one", () => {
    const later = new Date(START.getTime() + 7 * DAY);
    const moves = windowHoldMoves({ holds: [{ id: "five-days", holdExpiresAt: at(5) }], before: event(15, 5), after: event(15, 5, later), now: NOW, holdMinutes, registrationClosesAt: null });
    expect(moves).toEqual([{ id: "five-days", from: at(5), to: new Date(later.getTime() - 5 * DAY) }]);
  });
});
