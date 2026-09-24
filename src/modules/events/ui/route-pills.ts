import type { GlyphName } from "./glyphs";

/** A pill's content: its glyph by name, for `GlyphChip` to make on its own side of the boundary (§112), and its words. */
export type Pill = { glyph: GlyphName; label: string };

/**
 * The route's pills, in one fixed order (§366, amended §375 — the owner, 2026-09-24, of the
 * card's pills reading "8 km · 250 m D+ · Mediu · Trail": "The order of this should be: terrain
 * type, difficulty, distance, elevation"): **surface, difficulty, distance, elevation**, then the
 * cost pill after them wherever a caller adds one.
 *
 * One function decides the order for both surfaces that draw route pills — the listing card
 * (`EventFacts`'s compact form) and the event page (`EventFacts`'s stacked form, §356) — so
 * neither can drift from the other. Each caller builds its own pills (a pill exists only for
 * what the club stated) and hands them here; a pill the caller leaves out (`null` or
 * `undefined`) is simply absent from the result, never a gap in the order.
 */
export function orderRoutePills(pills: {
  surface?: Pill | null;
  difficulty?: Pill | null;
  distance?: Pill | null;
  elevation?: Pill | null;
}): Pill[] {
  return [pills.surface, pills.difficulty, pills.distance, pills.elevation].filter((pill): pill is Pill => pill != null);
}
