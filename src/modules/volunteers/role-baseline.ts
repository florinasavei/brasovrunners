import { canonicalDescription } from "./domain/volunteer";

/**
 * What a role was when the «Roluri» card's form was drawn (§NNN), posted back in the row's hidden `roles[<id>].was` box.
 *
 * «Salvează toate rolurile» posts every role, so it must know which of them the person touched: a role whose boxes still read what the form was
 * drawn with is not theirs to write, and a role someone else changed since is not theirs to overwrite. Comparing the posted boxes with the role as
 * it is stored NOW cannot tell the two apart — a form opened before another session's save would silently undo that save on every role it
 * carries. So the form carries the roles as they were drawn (the names, the number, the category, the band's colour, the place among the
 * category's roles and a short digest of each description), and the service compares the posted boxes with THAT, then refuses a touched role whose
 * stored values are no longer those.
 *
 * Pure: the card that draws it and the service that reads it share one spelling.
 */
export type RoleBaseline = {
  nameRo: string;
  nameEn: string;
  needed: number | null;
  categoryId: string | null;
  colour: string | null;
  /** The role's place among the roles of its category, from 1: what «Poziția» was drawn with. */
  rank: number;
  /** A digest of each description document (`descriptionDigest`). */
  descriptionRo: string;
  descriptionEn: string;
};

/** The saved role's values the baseline is made of; a database row fits. */
export type RoleBaselineSource = {
  nameRo: string;
  nameEn: string;
  needed: number | null;
  categoryId: string | null;
  colour: string | null;
  descriptionRoJson: unknown;
  descriptionEnJson: unknown;
};

/** A short, stable digest of a description document: 32-bit FNV-1a of its key-sorted JSON, with the length, so a hidden box stays a few dozen characters. */
export function descriptionDigest(document: unknown): string {
  const text = canonicalDescription(document);
  let hash = 0x811c9dc5;
  for (let at = 0; at < text.length; at++) {
    hash ^= text.charCodeAt(at);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(36)}.${text.length.toString(36)}`;
}

/** The baseline of a saved role drawn at `rank` (from 1) among the roles of its category. */
export function roleBaselineOf(role: RoleBaselineSource, rank: number): RoleBaseline {
  return {
    nameRo: role.nameRo,
    nameEn: role.nameEn,
    needed: role.needed,
    categoryId: role.categoryId,
    colour: role.colour,
    rank,
    descriptionRo: descriptionDigest(role.descriptionRoJson),
    descriptionEn: descriptionDigest(role.descriptionEnJson),
  };
}

/** The box's value. */
export function encodeRoleBaseline(baseline: RoleBaseline): string {
  return JSON.stringify(baseline);
}

const isText = (value: unknown): value is string => typeof value === "string";
const isTextOrNull = (value: unknown): value is string | null => value === null || typeof value === "string";

/** The baseline a box carries, or null when the row posted none or something that is not one (a script, a forged form): the row is then read against the stored role. */
export function decodeRoleBaseline(value: unknown): RoleBaseline | null {
  if (typeof value !== "string" || value.length > 4000) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const one = parsed as Record<string, unknown>;
  const needed = one.needed;
  const rank = one.rank;
  if (
    !isText(one.nameRo) ||
    !isText(one.nameEn) ||
    !(needed === null || (typeof needed === "number" && Number.isInteger(needed))) ||
    !isTextOrNull(one.categoryId) ||
    !isTextOrNull(one.colour) ||
    typeof rank !== "number" ||
    !Number.isInteger(rank) ||
    !isText(one.descriptionRo) ||
    !isText(one.descriptionEn)
  ) {
    return null;
  }
  return {
    nameRo: one.nameRo,
    nameEn: one.nameEn,
    needed: needed as number | null,
    categoryId: one.categoryId,
    colour: one.colour,
    rank,
    descriptionRo: one.descriptionRo,
    descriptionEn: one.descriptionEn,
  };
}
