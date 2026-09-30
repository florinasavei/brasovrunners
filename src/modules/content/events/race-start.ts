/**
 * «Startul cursei nu e stabilit» (§NNN): the tick beside a race's gun time (`ui/RaceStartNotSet`).
 * Ticked, the race's start is saved empty — `race_starts_at` null, which every surface reads as
 * "not set yet" (`events/domain/when-times.ts`) — whatever its boxes still hold; unticked, the
 * boxes' own value, as before. A form without the tick (a series, an old page) posts nothing and
 * keeps the boxes' meaning.
 */
export const RACE_START_NOT_SET = "event.raceStartNotSet";

export function raceStartWallTime(form: FormData, typed: string): string {
  return form.get(RACE_START_NOT_SET) === "on" ? "" : typed;
}
