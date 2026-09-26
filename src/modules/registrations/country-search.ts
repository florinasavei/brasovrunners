/**
 * Finding a country by typing part of it (§NNN): the one rule both country pickers on the
 * registration form search with — the telephone prefix and the citizenship.
 *
 * The owner: "în dropdown-urile de telefon și cetățenie, vreau searchbox să pot găsi țara". Two
 * hundred and fifty names are a scroll nobody wants, and a native `<select>` whose options begin
 * with a flag cannot even jump to a letter.
 *
 * Plain data in, plain data out, so it is the same answer in Node and in the browser and a unit
 * test can hold it. What matches:
 *
 * - **The name, without its accents and its case.** "romania" finds "România", "turkiye" finds
 *   "Türkiye", "cote" finds "Côte d’Ivoire" — a phone keyboard offers no diacritics by default,
 *   and nobody should need them to find their own country.
 * - **The start of any word first.** "ger" puts Germania before Algeria; then any other place in
 *   the name, so "land" still finds "Olanda" and "Finlanda".
 * - **The ISO code, typed whole.** "GB", "US", "MD" — what people write on forms.
 * - **The dialling code, for the telephone.** "+40", "40" or "0040" finds Romania; a prefix of
 *   the digits narrows as it is typed ("+3" → every +3x).
 *
 * The given order is kept inside each tier, so Romania stays first on an empty search and the
 * rest stay in the reader's own alphabetical order — the server's order (§324), never re-sorted
 * here with the browser's own collation.
 */

export type SearchableCountry = {
  code: string;
  label: string;
  /** The E.164 country code without its `+`, where the picker is a telephone prefix. */
  dialingCode?: string;
};

/** Lower case, accents and punctuation-like apostrophes gone: what a search compares. */
export function foldForSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’'`´]/g, "")
    .toLowerCase()
    .trim();
}

/** The typed digits of a dialling code: "+40", "0040", "40 " → "40"; nothing when it is not one. */
function dialingDigits(query: string): string | null {
  const compact = query.replace(/[\s()-]/g, "");
  const match = compact.match(/^(?:\+|00)?(\d{1,4})$/);
  if (!match) return null;
  return match[1];
}

/**
 * The countries a query finds, best first. An empty query finds every country, in the order given.
 */
export function searchCountries<T extends SearchableCountry>(countries: readonly T[], query: string): T[] {
  const folded = foldForSearch(query);
  if (folded === "") return [...countries];

  const digits = dialingDigits(query);
  const upper = query.trim().toUpperCase();

  const exact: T[] = [];
  const wordStart: T[] = [];
  const inside: T[] = [];

  for (const country of countries) {
    if (digits !== null) {
      // A number is a dialling code or nothing: "40" is never half of a name.
      if (country.dialingCode === digits) exact.push(country);
      else if (country.dialingCode?.startsWith(digits)) wordStart.push(country);
      continue;
    }
    const name = foldForSearch(country.label);
    if (country.code === upper || name === folded) exact.push(country);
    else if (name.startsWith(folded) || name.split(/[\s\-–(),.]+/).some((word) => word.startsWith(folded))) wordStart.push(country);
    else if (name.includes(folded)) inside.push(country);
  }

  return [...exact, ...wordStart, ...inside];
}
