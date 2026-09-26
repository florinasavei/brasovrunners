import type { HtmlConstraints } from "@/shared/forms/constraints";

/**
 * «Durata» as two boxes, hours and minutes (§433, amending §71's single minutes box).
 *
 * §71 asked how long an event takes, in minutes — "90, say". Nobody counts a trail race or a
 * camp in minutes: "3 hours 30" is how the club says it, and 210 is arithmetic the organizer had
 * to do in their head. The editor now asks the two numbers side by side; underneath nothing
 * changed — `fields.ts` still reads one `durationMinutes` string and the service still derives
 * `ends_at` from the start plus that many minutes (an instant plus a duration, right across a
 * clock change).
 *
 * The join is `admin/actions.ts#eventFieldsFrom`'s, like the date and time boxes of a
 * `WallTimeField` (§70): the two boxes post `event.durationHours` and `event.durationMinutesPart`
 * (the names written out where they are posted and read, so `event-form-together.test.ts` can see
 * that every box read is a box drawn). The limits are here once, for the boxes' HTML attributes and for the join, so the browser refuses
 * exactly what the server would; the week's ceiling on the total stays the schema's.
 */

/** A week, the schema's ceiling on the total (`fields.ts`, §71). */
export const DURATION_MAX_MINUTES = 7 * 24 * 60;

/**
 * The hours box: a whole number up to a week's worth, 168 — the schema's ceiling on the total
 * (§71), not a round 99, so a multi-day camp the schema accepts is never refused by the box.
 */
export const DURATION_HOURS_CONSTRAINTS: HtmlConstraints = { type: "number", min: 0, max: DURATION_MAX_MINUTES / 60, step: 1 };

/** The minutes box: what is left past the hours, so never an hour or more. */
export const DURATION_MINUTES_CONSTRAINTS: HtmlConstraints = { type: "number", min: 0, max: 59, step: 1 };

const WHOLE = /^\d+$/;

/**
 * The two boxes as the one string `fields.ts` reads: "" for no duration (both boxes empty), the
 * total in minutes otherwise — "3" and "30" are "210", "" and "45" are "45", "2" and "" are
 * "120". Anything the boxes' own rules refuse (not a whole number, sixty minutes or more) comes
 * back as a string that is not a whole number, so the schema refuses it with its one message
 * and the refusal names the hours box (`form-names.ts`). Zero hours and zero minutes is "0",
 * which the schema refuses as it always did.
 */
export function joinDuration(hours: string, minutes: string): string {
  const h = hours.trim();
  const m = minutes.trim();
  if (!h && !m) return "";
  if ((h && !WHOLE.test(h)) || (m && !WHOLE.test(m)) || Number(m || "0") > (DURATION_MINUTES_CONSTRAINTS.max ?? 59)) {
    return `${h}h${m}m`;
  }
  return String(Number(h || "0") * 60 + Number(m || "0"));
}

/** A stored duration back into the two boxes: 210 is "3" and "30"; none is two empty boxes. */
export function splitDuration(totalMinutes: number | null | undefined): { hours: string; minutes: string } {
  if (!totalMinutes || totalMinutes <= 0 || !Number.isFinite(totalMinutes)) return { hours: "", minutes: "" };
  const whole = Math.round(totalMinutes);
  return { hours: String(Math.floor(whole / 60)), minutes: String(whole % 60) };
}

/**
 * The saved duration of an event, from its start and its end: whole minutes, or null when there
 * is no end or it is not after the start.
 */
export function savedDurationMinutes(startsAt: Date | null | undefined, endsAt: Date | null | undefined): number | null {
  if (!startsAt || !endsAt) return null;
  const minutes = Math.round((endsAt.getTime() - startsAt.getTime()) / 60_000);
  return minutes > 0 ? minutes : null;
}
