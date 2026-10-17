import type { ImportedResultRow } from "./results";
import { formatResultTime } from "./domain/result-time";
import { registeredRowKey, resultBox, typedRowCountOf, typedRowKey } from "./rows";

/**
 * «Importă din CSV» puts what a file says into the boxes of the table (§NNN), and saves nothing.
 *
 * `values` is what the form posted (`keptValuesOf`), by box name; the rows are the file's, already matched by number
 * (`importResultsCsv`). The merge, pure so a test can walk it:
 *
 * - a number the table has a line for (`r[<bib>].time` was posted) gets «Timp», «Status» and «Timp cip» from the file — the line's
 *   «Notă» and everything else stays as typed;
 * - a number a typed row already holds (`n[<i>].bib`) gets the same boxes in that row;
 * - any other number becomes a **new typed row** at the end, with its number, its times and its status, and the name left for the club
 *   to write — a runner no registration holds the number of cannot be saved nameless.
 *
 * A number the file names overrides the boxes it fills even when they held something: the file is the newer word, and nothing is
 * saved until «Salvează tot clasamentul» — the club reads the table first.
 */
export function mergeImportedRows(
  values: Readonly<Record<string, readonly string[]>>,
  rows: readonly ImportedResultRow[],
): { values: Record<string, string[]>; placed: number; added: number } {
  const next: Record<string, string[]> = Object.fromEntries(Object.entries(values).map(([name, list]) => [name, [...list]]));
  let typedCount = typedRowCountOf(Object.keys(next));
  const typedByBib = new Map<number, string>();
  for (let index = 0; index < typedCount; index += 1) {
    const bib = Number(next[resultBox(typedRowKey(index), "bib")]?.[0] ?? "");
    if (bib > 0) typedByBib.set(bib, typedRowKey(index));
  }

  let placed = 0;
  let added = 0;
  for (const row of rows) {
    const registeredKey = registeredRowKey(row.bibNumber);
    let key: string;
    if (resultBox(registeredKey, "time") in next) {
      key = registeredKey;
      placed += 1;
    } else if (typedByBib.has(row.bibNumber)) {
      key = typedByBib.get(row.bibNumber) as string;
      placed += 1;
    } else {
      key = typedRowKey(typedCount);
      typedCount += 1;
      next[resultBox(key, "bib")] = [String(row.bibNumber)];
      typedByBib.set(row.bibNumber, key);
      added += 1;
    }
    next[resultBox(key, "time")] = [formatResultTime(row.gunTimeMs)];
    next[resultBox(key, "chip")] = [formatResultTime(row.chipTimeMs)];
    next[resultBox(key, "status")] = [row.status];
  }
  return { values: next, placed, added };
}
