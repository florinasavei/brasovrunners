import type { HtmlConstraints } from "@/shared/forms/constraints";

/**
 * «Durata» as two boxes, hours and minutes (§433). Underneath it is still one `durationMinutes`
 * string (`fields.ts`); the join is `admin/actions.ts#eventFieldsFrom`'s. The limits live here so
 * the boxes' HTML attributes and the join refuse the same thing.
 */

/** A week, the schema's ceiling on the total (`fields.ts`, §71). */
export const DURATION_MAX_MINUTES = 7 * 24 * 60;

/** Up to 168 hours, the schema's ceiling (§71), so a multi-day camp is never refused by the box. */
export const DURATION_HOURS_CONSTRAINTS: HtmlConstraints = { type: "number", min: 0, max: DURATION_MAX_MINUTES / 60, step: 1 };

/** The minutes box: what is left past the hours, so never an hour or more. */
export const DURATION_MINUTES_CONSTRAINTS: HtmlConstraints = { type: "number", min: 0, max: 59, step: 1 };

const WHOLE = /^\d+$/;

/**
 * The two boxes as the one string `fields.ts` reads: "" when both are empty, else the total in
 * minutes ("3" + "30" → "210"). Anything the boxes refuse comes back as a non-integer string, so
 * the schema refuses it and the refusal names the hours box (`form-names.ts`).
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

/** Whole minutes from start to end, or null when there is no end or it is not after the start. */
export function savedDurationMinutes(startsAt: Date | null | undefined, endsAt: Date | null | undefined): number | null {
  if (!startsAt || !endsAt) return null;
  const minutes = Math.round((endsAt.getTime() - startsAt.getTime()) / 60_000);
  return minutes > 0 ? minutes : null;
}
