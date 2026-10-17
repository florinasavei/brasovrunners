/**
 * What the «Clasament» section's small filter decides (§NNN, race results part 2), pure so a unit test holds it without a browser.
 *
 * The table is drawn whole by the server; the filter only **hides** rows (`ResultsFilter`), so with no script every row shows.
 * A row carries two facts for it: its category key (`FEMALE:from30`, or none) and its race number as an integer.
 */

/** The state of the two controls: one category or all (`null`), and what was typed in the number box. */
export type ResultsFilterState = { category: string | null; bib: string };

/** What a row says of itself for the filter: the `data-category` and `data-bib` the section writes. */
export type ResultsFilterRow = { category: string | null; bib: number };

/** The age bands, youngest first, and the sexes in the order the club's statistics list them (`STATISTICS_AGE_BANDS`). */
const SEX_ORDER = ["FEMALE", "MALE"];
const BAND_ORDER = ["under18", "from18", "from30", "from40", "from50", "from60"];

/**
 * The categories present, in the order the club's own statistics read them — women then men, youngest band first — each once.
 * A key this version does not know sorts last, by its text, so a category stored by a later release still gets its chip.
 */
export function categoriesPresent(keys: readonly (string | null)[]): string[] {
  const present = [...new Set(keys.filter((key): key is string => typeof key === "string" && key !== ""))];
  const rank = (key: string) => {
    const [sex = "", band = ""] = key.split(":");
    const sexAt = SEX_ORDER.indexOf(sex);
    const bandAt = BAND_ORDER.indexOf(band);
    return sexAt < 0 || bandAt < 0 ? Number.MAX_SAFE_INTEGER : sexAt * BAND_ORDER.length + bandAt;
  };
  return present.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/**
 * The digits typed in the number box, without a leading zero: «007» finds number 7 as «7» does, the way the page writes it under
 * «pad3» (§735). Anything that is not a digit is dropped (a pasted «#42»); nothing left means no search at all (`null`).
 */
export function bibQuery(typed: string): string | null {
  const digits = typed.replace(/\D/g, "");
  if (digits === "") return null;
  return digits.replace(/^0+(?=\d)/, "");
}

/**
 * Whether a row stays: its category is the chosen one (or none is chosen) and its number contains what was typed. «Contains», not
 * «starts with»: a runner who remembers «42» finds 42 and 142, and the list narrows with every digit.
 */
export function rowMatches(row: ResultsFilterRow, state: ResultsFilterState): boolean {
  if (state.category !== null && row.category !== state.category) return false;
  const query = bibQuery(state.bib);
  return query === null || String(row.bib).includes(query);
}
