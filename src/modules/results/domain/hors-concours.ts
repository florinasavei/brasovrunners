/**
 * «Apare în clasament» (§910; the owner, 2026-11-04: «per elite, two ticks: „Apare în clasament" and „Apare pe site"»): the elites the
 * Administrator left out of the ranking run **hors concours** — their result is on the backoffice's «Clasament», marked «în afara
 * clasamentului», and nowhere else: not in the public results, and not in anybody's position, the others ranked as if they had not run.
 *
 * Pure — no database, no React. The service (`../results.ts`) reads the two ticks and hands them here with every list it ranks, so the
 * backoffice, the public page, the file and the stored positions all leave out the same rows.
 *
 * **Which row is an elite's** — the results module's own link, nothing guessed beyond it:
 *
 * 1. A row filed under a registration (`registration_id`) is that registration's: out when the registration is marked «Elită» or
 *    «Ambasador» (§NNN: the club's second mark has the same pair of ticks) with «Apare în clasament» unticked
 *    (`(registrations.elite OR registrations.ambassador) AND registrations.elite_hidden_from_results`).
 * 2. A row the club typed (no registration) whose number a **confirmed** registration holds is that runner's, as «Clasament» draws it
 *    (`claimOf`): out exactly as in 1, never by an elite line.
 * 3. Any other typed row is a separate-list elite's when **its number is the number of a line of the race's elite list** (§895) — a
 *    number is one person's at an event: the list refuses a number somebody wears, and no draw hands out a line's number
 *    (`bibs.ts#bibNumberInUse`, `wornNumbers`). Out when that line's «Apare în clasament» is unticked (`in_results` false).
 * 4. For a line with **no number** only: a typed row whose name is the line's name — both folded as the list stores a name (spaces
 *    trimmed and collapsed to one), compared without case and without diacritics — and only when exactly one typed row of the race,
 *    whose number is no line's number (that row is its line's, by rule 3), carries that name. Two rows with that name match neither:
 *    leaving a stranger out of the ranking takes their place from them, so an ambiguous name stays ranked and the club types the
 *    number on the line instead.
 */

/**
 * What the two ticks leave out: registrations, by id; the separate list's unticked lines, by number (`bibs`), and by folded name for an
 * unticked line with none (`names`); and every line's number, ticked or not (`listedBibs`), so a row its own line holds is never taken
 * for another line by name.
 */
export type OutOfRanking = {
  registrations: ReadonlySet<string>;
  bibs: ReadonlySet<number>;
  names: ReadonlySet<string>;
  listedBibs: ReadonlySet<number>;
};

export const NOBODY_OUT: OutOfRanking = { registrations: new Set(), bibs: new Set(), names: new Set(), listedBibs: new Set() };

/** A name as the elite list and a typed result are compared: spaces trimmed and collapsed, no case, no diacritics. */
export function foldEliteName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
}

/** One result row, as the ranking holds it: its number, the registration it is filed under (null when typed) and a typed row's name. */
export type HorsConcoursRow = { bibNumber: number; registrationId: string | null; displayName: string | null };

/**
 * The numbers of `rows` that run hors concours, by the four rules above. `confirmedHolderOf` names the confirmed registration that holds
 * a number at the event, if any (rule 2); `out` is what the ticks leave out.
 */
export function horsConcoursBibs(rows: readonly HorsConcoursRow[], out: OutOfRanking, confirmedHolderOf: (bibNumber: number) => string | null): Set<number> {
  const found = new Set<number>();
  if (out.registrations.size === 0 && out.bibs.size === 0 && out.names.size === 0) return found;
  // Rule 4 reads only the typed rows no registration and no elite number claims: they are counted by name first.
  const byName = new Map<string, number[]>();
  for (const row of rows) {
    if (row.registrationId !== null) {
      if (out.registrations.has(row.registrationId)) found.add(row.bibNumber);
      continue;
    }
    const holder = confirmedHolderOf(row.bibNumber);
    if (holder !== null) {
      if (out.registrations.has(holder)) found.add(row.bibNumber);
      continue;
    }
    // A number on the list is that line's row (rule 3): out with its line, and never matched to another line by name.
    if (out.bibs.has(row.bibNumber)) found.add(row.bibNumber);
    if (out.bibs.has(row.bibNumber) || out.listedBibs.has(row.bibNumber)) continue;
    if (row.displayName === null) continue;
    const name = foldEliteName(row.displayName);
    if (name === "") continue;
    byName.set(name, [...(byName.get(name) ?? []), row.bibNumber]);
  }
  for (const name of out.names) {
    const matched = byName.get(name);
    if (matched && matched.length === 1) found.add(matched[0]);
  }
  return found;
}
