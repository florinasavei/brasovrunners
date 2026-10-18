/**
 * The names the «Niveluri de membru» card posts under (§NNN): one form for every level, so every box
 * carries the level it belongs to — `tiers[<key>].nameRo` — the way the volunteers' «Roluri» card does
 * (`volunteers/role-rows.ts`, §791).
 *
 * The key of a saved level is its id; the blank row at the end is `new`. The dot is the house's own
 * spelling of a numbered row, so the translate buttons find the Romanian twin of `tiers[<key>].nameEn`
 * and `tiers[<key>].descriptionEn` by their suffix (`translate/domain/fields.ts`).
 *
 * Pure — no database, no React — so the card that draws the names, the action that reads them and the
 * service that names a refused box all spell them one way.
 */

/** The boxes of one level's row, as the form posts them (the part after `tiers[<key>].`). */
export const TIER_ROW_BOXES = [
  "nameRo",
  "nameEn",
  "descriptionRo",
  "descriptionEn",
  "glyph",
  "position",
  "hidden",
  // The place the level was drawn at (from 1): a saved level's hidden box, never typed — what «Poziția» is compared with.
  "was",
] as const;

export type TierRowBox = (typeof TIER_ROW_BOXES)[number];

/** The key of the blank row that adds a level. */
export const NEW_TIER_ROW_KEY = "new";

/** The name one box of one row posts under. */
export function tierBox(key: string, box: TierRowBox): string {
  return `tiers[${key}].${box}`;
}

/** One row as the form posted it: its key, the saved level it is (null for the blank row) and its boxes by their short names. */
export type PostedTierRow = {
  key: string;
  /** The saved level's id; null for the blank row. */
  id: string | null;
  fields: Record<string, string>;
};

const ROW_NAME = /^tiers\[([^\]]{1,80})\]\.(\w{1,40})$/;
const BOXES: ReadonlySet<string> = new Set(TIER_ROW_BOXES);

/**
 * Every row of the posted form, in the order its first box appears: the boxes grouped by key, a name
 * that is not a row's box left alone. Nothing is checked here — a key that is not an id is the
 * service's NOT_FOUND, a position that is not a number its refusal.
 *
 * «Ascuns» is the house's tick: unticked it posts nothing, so a row that posted its names and no tick
 * says «not hidden». A row with no name box at all (a caller leaving the row's words out) keeps the
 * level's tick as it is: `hidden` is then absent from `fields`.
 */
export function postedTierRows(entries: Iterable<readonly [string, unknown]>): PostedTierRow[] {
  const rows = new Map<string, PostedTierRow>();
  for (const [name, value] of entries) {
    const match = ROW_NAME.exec(name);
    if (!match || typeof value !== "string" || !BOXES.has(match[2])) continue;
    const key = match[1];
    let row = rows.get(key);
    if (!row) {
      row = { key, id: key === NEW_TIER_ROW_KEY ? null : key, fields: {} };
      rows.set(key, row);
    }
    row.fields[match[2]] = value;
  }
  for (const row of rows.values()) {
    if ("nameRo" in row.fields || "nameEn" in row.fields) row.fields.hidden = row.fields.hidden === "on" ? "on" : "";
  }
  return [...rows.values()];
}

/**
 * The order the posted numbers ask for (§791's rule, for a list without categories). Every saved row has
 * its place now (`was`, from 1) and may carry a typed number. A row that left its number alone keeps its
 * place; one that took a lower number goes before the row that holds it, one that took a higher number
 * goes after it. A new row (no `was`) with no number goes last, one with a number goes before the row
 * that holds it. Ties keep the order they had. Returns the keys in the new order.
 */
export function orderTierRows(rows: readonly { key: string; was: number | null; typed: number | null }[]): string[] {
  const scored = rows.map((row, index) => {
    let score: number;
    if (row.typed === null || row.typed === row.was) score = row.was === null ? Number.POSITIVE_INFINITY : row.was * 2;
    else if (row.was === null || row.typed < row.was) score = row.typed * 2 - 1;
    else score = row.typed * 2 + 1;
    return { key: row.key, score, index };
  });
  scored.sort((a, b) => (a.score === b.score ? a.index - b.index : a.score < b.score ? -1 : 1));
  return scored.map((row) => row.key);
}
