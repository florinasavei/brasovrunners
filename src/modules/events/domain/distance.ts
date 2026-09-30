import { distanceInKm } from "./event-type";

/**
 * The words for the event's distance, for every surface that says it (§NNN, the twin of §585's
 * `elevationWords`, amending §388 and §392; the owner, 2026-09-30: «la distanță vreau să pot pune
 * aproximativ, ca și la elevație, tot așa cu bifă»).
 *
 * Two forms, and an approximate distance is never a bare number in either:
 *
 * - **short** — the route pill on the listing card and the event page (§388): «10 km», or «≈ 10 km»
 *   when the club ticked «Aproximativ»;
 * - **long** — where the words stand alone, with no chip to hover: the pill's tooltip and what a
 *   screen reader hears, the emails' facts block and its plain-text twin (§392), the calendar
 *   entry's facts line (§107) and the share picture: «10 km», or «circa 10 km (aproximativ)».
 *
 * An exact distance reads exactly as before, «10 km» in both forms. `null` when the club stated no
 * distance (`distanceInKm`: a null or a 0), so a tick with no distance says nothing anywhere (the
 * editor saves it false: `estimatedDistance`). The structured data (JSON-LD) names no distance.
 *
 * The translator is the `Event` catalogue's, narrow like `elevation.ts`'s; `formatKm` is the
 * caller's own number formatter (one decimal, the locale's separator — «10,5 km» / "10.5 km").
 */

type Translate = (key: string, values?: Record<string, string | number>) => string;

/** What an event carries for its distance; the flag optional, for a cached row from before it (§NNN). */
export type DistanceSource = {
  distanceMeters?: number | null;
  distanceEstimated?: boolean | null;
};

export type DistanceWords = {
  /** The pill's words: «10 km» / «≈ 10 km». */
  short: string;
  /** The words on their own: «10 km» / «circa 10 km (aproximativ)». */
  long: string;
  estimated: boolean;
};

export function distanceWords(event: DistanceSource, t: Translate, formatKm: (km: number) => string): DistanceWords | null {
  const kmNumber = distanceInKm(event.distanceMeters ?? null);
  if (kmNumber === null) return null;
  const km = formatKm(kmNumber);
  const estimated = event.distanceEstimated === true;
  if (!estimated) {
    const exact = t("distanceKm", { km });
    return { short: exact, long: exact, estimated };
  }
  return { short: t("distanceKmApproximate", { km }), long: t("distanceKmApproximateLong", { km }), estimated };
}

/**
 * What the editor saves for the tick: «Aproximativ» is meaningless without a distance, so a tick
 * beside an empty «Distanță (m)» is dropped quietly — saved false, never a refusal.
 */
export function estimatedDistance(meters: number | null | undefined, ticked: boolean): boolean {
  return ticked && meters !== null && meters !== undefined && meters > 0;
}
