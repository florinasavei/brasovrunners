import type { GlyphName } from "./glyphs";

/**
 * A pill's content: its glyph by name, for `GlyphChip` to make on its own side of the boundary
 * (§112), and its words. `srSuffix` adds extra words a screen reader reads right after `label`,
 * never shown, while the visible word stays the closed set's own — the listing card's cost pill
 * on an `EXTERNAL`-registration `PAID` event still reads "Cu taxă" so every card's pill says the
 * same short word, and a screen reader alone is told the fee goes to the organizer (`DECISIONS.md`
 * §NNN). Content, not an `aria-label` override: MUI's `Chip` is a plain, roleless `<div>` when it
 * is not clickable, and ARIA 1.2 does not allow naming a generic element, so the extra words have
 * to be in the chip's own text (visually hidden) rather than on the attribute.
 */
export type Pill = { glyph: GlyphName; label: string; srSuffix?: string };

/**
 * The route's pills, in one fixed order (§366, amended §375 — the owner, 2026-09-24, of the
 * card's pills reading "8 km · 250 m D+ · Mediu · Trail": "The order of this should be: terrain
 * type, difficulty, distance, elevation"): **surface, difficulty, distance, elevation**, then the
 * **headlamp** (§382) — what to bring for that route, after what the route is — then the cost
 * pill after them wherever a caller adds one.
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
  headlamp?: Pill | null;
}): Pill[] {
  return [pills.surface, pills.difficulty, pills.distance, pills.elevation, pills.headlamp].filter((pill): pill is Pill => pill != null);
}
