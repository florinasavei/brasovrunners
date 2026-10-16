/**
 * The names the event editor's «Roluri» card posts under (§NNN; the owner, 2026-10-16: «să pot face batch edit la roluri, nu să dau save de
 * fiecare dată, ci un Save All»): one form for every role, so every box carries the role it belongs to — `roles[<key>].nameRo`.
 *
 * The key of a saved role is its id; the blank row at the end of each category is `new-<category id>` (or `new-none` under «Alte roluri»).
 * The dot is the house's own spelling of a numbered row (`faq[3].questionEn`, §525), so the translate buttons find the Romanian twin of
 * `roles[<key>].nameEn` and `roles[<key>].descriptionEnBody` by their suffix (`translate/domain/fields.ts`), and a language strip's two
 * descriptions share one fold (`twinFoldKey`).
 *
 * Pure — no database, no React — so the card that draws the names, the action that reads them and the service that names a refused box
 * all spell them one way.
 */

/**
 * The boxes of one role's row, as the form posts them (the part after `roles[<key>].`). The description is the editor's two documents
 * (`descriptionRoBody` / `descriptionEnBody`); the two plain boxes are for a caller without the editor — a script, a test — and read as paragraphs.
 */
export const ROLE_ROW_BOXES = [
  "categoryId",
  "nameRo",
  "nameEn",
  "needed",
  "unlimited",
  "position",
  "descriptionRoBody",
  "descriptionEnBody",
  "descriptionRo",
  "descriptionEn",
  "colourChoice",
  "colourTyped",
] as const;

export type RoleRowBox = (typeof ROLE_ROW_BOXES)[number];

/** The prefix of a blank row's key: the role it would create, under the category that follows. */
export const NEW_ROLE_ROW_PREFIX = "new-";

/** The blank row of a category's key: its id, or `none` under «Alte roluri». */
export function newRoleRowKey(categoryId: string | null): string {
  return `${NEW_ROLE_ROW_PREFIX}${categoryId ?? "none"}`;
}

/** The name one box of one row posts under. */
export function roleBox(key: string, box: RoleRowBox): string {
  return `roles[${key}].${box}`;
}

/** The two boxes of a row's band colour, in the shape `RoleColourFields` and `checkedRoleColour` take. */
export function roleColourBoxesOf(key: string): { choice: string; typed: string } {
  return { choice: roleBox(key, "colourChoice"), typed: roleBox(key, "colourTyped") };
}

/** One row as the form posted it: its key, the saved role it is (null for a blank row) and its boxes by their short names. */
export type PostedRoleRow = {
  key: string;
  /** The saved role's id; null for a blank row, which `fields.categoryId` places. */
  id: string | null;
  fields: Record<string, string>;
};

const ROW_NAME = /^roles\[([^\]]{1,80})\]\.(\w{1,40})$/;
const BOXES: ReadonlySet<string> = new Set(ROLE_ROW_BOXES);

/**
 * Every row of the posted form, in the order its first box appears: the boxes grouped by key, a name that is not a row's box left alone.
 * A blank row's category is the one in its key unless the row's own «Categoria» box was posted. Nothing is checked here — a key that is
 * not an id is the service's NOT_FOUND, a box that is not a number its refusal.
 */
export function postedRoleRows(entries: Iterable<readonly [string, unknown]>): PostedRoleRow[] {
  const rows = new Map<string, PostedRoleRow>();
  for (const [name, value] of entries) {
    const match = ROW_NAME.exec(name);
    if (!match || typeof value !== "string" || !BOXES.has(match[2])) continue;
    const key = match[1];
    let row = rows.get(key);
    if (!row) {
      const isNew = key.startsWith(NEW_ROLE_ROW_PREFIX);
      const under = key.slice(NEW_ROLE_ROW_PREFIX.length);
      row = { key, id: isNew ? null : key, fields: isNew ? { categoryId: under === "none" ? "" : under } : {} };
      rows.set(key, row);
    }
    row.fields[match[2]] = value;
  }
  // «Nelimitat» is the house's tick: unticked it posts nothing, so a row that drew its number box and posted no tick says so (§784's rule).
  for (const row of rows.values()) {
    if ("needed" in row.fields) row.fields.unlimited = row.fields.unlimited === "on" ? "on" : "";
  }
  return [...rows.values()];
}
