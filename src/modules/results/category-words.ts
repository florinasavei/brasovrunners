import { type BandWords, bandLabelOf, DEFAULT_AGE_BAND_STARTS, splitCategoryKey } from "./domain/age-bands";

/**
 * A stored category (`FEMALE:from30`) in words (§808): «Feminin, 30-39 ani» — the Excel's own footer's words (§787,
 * `Admin.registrations.statistics`: `sexFemale`, `sexMale`, the three band sentences, joined by `category`), so a race's
 * category reads the same on the results page, in the CSV and in the club's statistics. The band's end comes from the race's
 * own list of starts (§850): the key says only where the band begins.
 *
 * `read` answers a key of that namespace (`getTranslations({ namespace: "Admin.registrations.statistics" })`). A row with no category
 * — no sex or no birth date — is the empty string, never a guess; a key a later version stored and this one does not know is the key
 * itself, so a cell is never blank by accident.
 */
export function categoryLabelOf(key: string | null | undefined, read: (statisticsKey: string) => string, starts: readonly number[] = DEFAULT_AGE_BAND_STARTS): string {
  const parts = splitCategoryKey(key);
  if (!parts) return key ?? "";
  const sex = read(parts.sex === "FEMALE" ? "sexFemale" : "sexMale");
  const band = bandLabelOf(parts.band, starts, bandWordsFrom(read));
  return read("category").replace("{sex}", sex).replace("{band}", band);
}

/** The three band sentences of the catalogue, read raw: their placeholders are filled by `bandLabelOf`. */
export function bandWordsFrom(read: (statisticsKey: string) => string): BandWords {
  return { under: read("bandUnder"), between: read("bandBetween"), open: read("bandOpen") };
}
