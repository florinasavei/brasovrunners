import { type AnyColumn, type SQL, sql } from "drizzle-orm";

/**
 * Searching a person by name, the way the registrations list has done it since §312 and the volunteers list since §NNN: the
 * stored name and the typed term are both lowered and stripped of the Romanian diacritics before `LIKE`, so `stefan` finds
 * «Ștefan» and `Tanase` finds «Tănase» — an organizer at a desk types what they hear. Every `%` and `_` of the term is a
 * literal; the pattern's own wildcards are the two around it.
 */
const DIACRITICS = "ăâîșțşţĂÂÎȘȚŞŢ";
const PLAIN = "aaiststAAISTST";

/** The column lowered and folded, for the `LIKE`'s left side. */
export function foldedName(column: SQL | AnyColumn): SQL {
  return sql`lower(translate(${column}, ${DIACRITICS}, ${PLAIN}))`;
}

/** The typed term lowered and folded the same way. */
export function foldTerm(term: string): string {
  const lowered = term.toLowerCase();
  let folded = "";
  for (const character of lowered) {
    const index = DIACRITICS.indexOf(character);
    folded += index === -1 ? character : PLAIN[index].toLowerCase();
  }
  return folded;
}

/** The term's `%`, `_` and `\` escaped, for a `LIKE … ESCAPE '\'`. */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/** `name LIKE %term%`, folded on both sides: one condition for a list's «Caută după nume». */
export function nameMatches(column: SQL | AnyColumn, term: string): SQL {
  return sql`${foldedName(column)} LIKE ${`%${escapeLike(foldTerm(term))}%`} ESCAPE '\\'`;
}
