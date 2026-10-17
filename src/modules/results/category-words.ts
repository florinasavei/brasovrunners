import { splitCategoryKey } from "./domain/ranking";

/**
 * A stored category (`FEMALE:from30`) in words (§NNN): «Feminin, 30-39 ani» — the Excel's own footer's words (§787,
 * `Admin.registrations.statistics`: `sexFemale`, `sexMale`, `bandUnder18` … `bandFrom60`, joined by `category`), so a race's
 * category reads the same on the results page, in the CSV and in the club's statistics.
 *
 * `read` answers a key of that namespace (`getTranslations({ namespace: "Admin.registrations.statistics" })`). A row with no category
 * — no sex or no birth date — is the empty string, never a guess; a key a later version stored and this one does not know is the key
 * itself, so a cell is never blank by accident.
 */
export function categoryLabelOf(key: string | null | undefined, read: (statisticsKey: string) => string): string {
  const parts = splitCategoryKey(key);
  if (!parts) return key ?? "";
  const sex = read(parts.sex === "FEMALE" ? "sexFemale" : "sexMale");
  const band = read(`band${parts.band.charAt(0).toUpperCase()}${parts.band.slice(1)}`);
  return read("category").replace("{sex}", sex).replace("{band}", band);
}
