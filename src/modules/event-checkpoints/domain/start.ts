import { blankStartParts } from "@/modules/events/domain/provisional-start";
import { toWallTimeInput } from "@/modules/events/domain/zoned-time";

/**
 * Where a checkpoint's cut-off is counted from, and where the finish stands (§NNN) — pure, so the
 * writer (`checkpoints.ts`), the event page and the bib read one answer.
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
 * The finish row of the page's table: the route's length when the club typed one, and the time
 * limit — the event's end («Durata») as `HH:MM` on the event's own clock — when the start has an
 * hour and the end is after it. Both null when the event says neither.
 */
export function checkpointFinish(event: {
  startsAt: Date;
  raceStartsAt: Date | null;
  endsAt: Date | null;
  timezone: string;
  distanceMeters: number | null;
}): { km: number | null; limit: string | null } {
  const start = checkpointStart(event);
  const limit = start && event.endsAt && event.endsAt.getTime() > start.getTime() ? toWallTimeInput(event.endsAt, event.timezone).slice(11, 16) : null;
  return { km: event.distanceMeters && event.distanceMeters > 0 ? Math.round(event.distanceMeters / 10) / 100 : null, limit };
}
