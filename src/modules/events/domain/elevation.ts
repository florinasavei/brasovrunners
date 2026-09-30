/**
 * The words for the event's elevation gain, for every surface that says it (§585, amending §388
 * and §392; the owner, 2026-09-30: «la elevație, trebuie să pot pune "estimativ"»).
 *
 * Two forms, and an estimate is never a bare number in either:
 *
 * - **short** — the route pill on the listing card and the event page (§388): «350 m D+», or
 *   «≈ 350 m D+» when the club ticked «Estimativ»;
 * - **long** — where the words stand alone, with no chip to hover: the pill's tooltip and what a
 *   screen reader hears, the emails' facts block and its plain-text twin (§392), the calendar
 *   entry's facts line (§107) and the share picture: «350 m diferență de nivel», or «circa 350 m
 *   diferență de nivel (estimativ)».
 *
 * `null` when the club stated no climb — a null, and a 0 as every surface has always read it — so
 * a tick with no number says nothing anywhere (the editor saves it false: `estimatedElevation`).
 *
 * The translator is the `Event` catalogue's, narrow like `route-pills.ts`'s, so the page (through
 * `getTranslations`), the emails (outside a request, `createTranslator`) and the pictures call the
 * same function with the translator they already have.
 */

type Translate = (key: string, values?: Record<string, string | number>) => string;

/** What an event carries for its climb; the flag optional, for a cached row from before it (§585). */
export type ElevationSource = {
  elevationGainMeters?: number | null;
  elevationGainEstimated?: boolean | null;
};

export type ElevationWords = {
  /** The pill's words: «350 m D+» / «≈ 350 m D+». */
  short: string;
  /** The words on their own: «350 m diferență de nivel» / «circa 350 m diferență de nivel (estimativ)». */
  long: string;
  estimated: boolean;
};

export function elevationWords(event: ElevationSource, t: Translate, formatNumber: (value: number) => string): ElevationWords | null {
  const meters = event.elevationGainMeters;
  if (!meters || meters <= 0) return null;
  const m = formatNumber(meters);
  const estimated = event.elevationGainEstimated === true;
  return estimated
    ? { short: t("elevationShortEstimated", { m }), long: t("elevationMEstimated", { m }), estimated }
    : { short: t("elevationShort", { m }), long: t("elevationM", { m }), estimated };
}

/**
 * What the editor saves for the tick: «Estimativ» is meaningless without a number, so a tick
 * beside an empty «Diferență de nivel (m)» is dropped quietly — saved false, never a refusal.
 */
export function estimatedElevation(meters: number | null | undefined, ticked: boolean): boolean {
  return ticked && meters !== null && meters !== undefined && meters > 0;
}
