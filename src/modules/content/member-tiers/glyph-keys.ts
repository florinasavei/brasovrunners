/**
 * The glyphs a member tier may wear (§811): a closed set of names, never a typed one. Since §817 the card no
 * longer offers the choice: the `glyph` column is a leftover (default `star`), drawn only on «Echipa»'s chip,
 * for a later contract migration to drop. The names only — no icon is imported here, so a service
 * that validates a posted name does not load a picture. The pictures are in
 * `modules/events/ui/tier-glyphs.ts` (drawn by `GlyphChip` as `tier:<name>`), typed by this list so the
 * two cannot drift: a name here with no picture there does not compile.
 *
 * One metaphor each, written down: a star (the default), a medal, a trophy, a diamond, a heart, a
 * bolt, a shield, a runner, a flag, a flame, a seal with a tick, a mountain.
 */
export const TIER_GLYPH_KEYS = ["star", "medal", "trophy", "diamond", "heart", "bolt", "shield", "runner", "flag", "flame", "verified", "mountain"] as const;

export type TierGlyphKey = (typeof TIER_GLYPH_KEYS)[number];

export const DEFAULT_TIER_GLYPH: TierGlyphKey = "star";

/** Whether `value` is one of the names above — the only way a stored or posted glyph is accepted. */
export function isTierGlyphKey(value: unknown): value is TierGlyphKey {
  return typeof value === "string" && (TIER_GLYPH_KEYS as readonly string[]).includes(value);
}
