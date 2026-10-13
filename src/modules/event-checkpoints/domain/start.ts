import { blankStartParts } from "@/modules/events/domain/provisional-start";
import { toWallTimeInput } from "@/modules/events/domain/zoned-time";

/**
 * Where a checkpoint's cut-off is counted from, where the finish stands and how long a race's time
 * limit is (§NNN) — pure, so the writer (`checkpoints.ts`), the event page and the bib read one answer.
 */

/**
 * The start the cut-offs are counted from: the race's gun when it has one (§71), else the event's
 * start — and nothing while the start's date or hour was left blank (§545), when there is nothing to
 * count from and the rules that need it are not applied.
 */
export function checkpointStart(event: { startsAt: Date; raceStartsAt: Date | null; timezone: string }): Date | null {
  if (event.raceStartsAt) return event.raceStartsAt;
  const blank = blankStartParts(event.startsAt, event.timezone);
  return blank.date || blank.time ? null : event.startsAt;
}

/**
 * A race's «Timp limită» in whole minutes (§NNN; the owner, 2026-10-13: «trebuie să pot pune timp
 * limită»): from the gun — else the event's start — to the event's end, the instant the editor's box
 * stores (`content/events/duration.ts#durationBase`). Null for any other type, whose «Durata» is how
 * long it lasts and no limit, and for a race with no end. The length is said even while the start's
 * hour is to be announced: the box's minutes are the club's whatever the hour turns out to be.
 */
export function raceTimeLimitMinutes(event: { type: string; startsAt: Date; raceStartsAt: Date | null; endsAt: Date | null }): number | null {
  if (event.type !== "RACE" || !event.endsAt) return null;
  const from = event.raceStartsAt ?? event.startsAt;
  const minutes = Math.round((event.endsAt.getTime() - from.getTime()) / 60_000);
  return minutes > 0 ? minutes : null;
}

/**
 * The finish row of the page's table: the route's length when the club typed one, and — **for a race
 * with a time limit** — the time the finish closes, the event's end as `HH:MM` on the event's own clock,
 * when the start has an hour and the end is after it. Every other event's end is when it finishes, not
 * a limit anyone is held to, so its table has no finish row (`limit` null).
 */
export function checkpointFinish(event: {
  type: string;
  startsAt: Date;
  raceStartsAt: Date | null;
  endsAt: Date | null;
  timezone: string;
  distanceMeters: number | null;
}): { km: number | null; limit: string | null } {
  const start = checkpointStart(event);
  const limit =
    event.type === "RACE" && start && event.endsAt && event.endsAt.getTime() > start.getTime() ? toWallTimeInput(event.endsAt, event.timezone).slice(11, 16) : null;
  return { km: event.distanceMeters && event.distanceMeters > 0 ? Math.round(event.distanceMeters / 10) / 100 : null, limit };
}
