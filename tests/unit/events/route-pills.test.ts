import { describe, expect, it } from "vitest";
import { orderRoutePills, type Pill } from "@/modules/events/ui/route-pills";

/**
 * BR-REQ-041-01 (`DECISIONS.md` §366, amended §NNN) — the route's pills read in one fixed order,
 * on the listing card and the event page alike.
 *
 * The owner, 2026-09-24, of the card's pills reading "8 km · 250 m D+ · Mediu · Trail": "The order
 * of this should be: terrain type, difficulty, distance, elevation." `orderRoutePills` is the one
 * function that decides it, so a caller cannot read the pills in a different order by mistake.
 */

const surface: Pill = { glyph: "surface:TRAIL", label: "Trail" };
const difficulty: Pill = { glyph: "difficulty:MODERATE", label: "Mediu" };
const distance: Pill = { glyph: "distance", label: "8 km" };
const elevation: Pill = { glyph: "elevation", label: "250 m D+" };

describe("§366 orderRoutePills — surface, difficulty, distance, elevation, and nothing else", () => {
  it("orders every pill: surface, difficulty, distance, elevation", () => {
    expect(orderRoutePills({ surface, difficulty, distance, elevation })).toEqual([surface, difficulty, distance, elevation]);
  });

  it("keeps the order whatever order the caller hands the pills in", () => {
    expect(orderRoutePills({ elevation, distance, difficulty, surface })).toEqual([surface, difficulty, distance, elevation]);
  });

  it("leaves an absent pill out rather than a gap in the order", () => {
    expect(orderRoutePills({ difficulty, distance, elevation })).toEqual([difficulty, distance, elevation]);
    expect(orderRoutePills({ surface, distance })).toEqual([surface, distance]);
    expect(orderRoutePills({ surface, elevation })).toEqual([surface, elevation]);
  });

  it("says nothing for null or undefined pills, and nothing at all when every pill is absent", () => {
    expect(orderRoutePills({ surface: null, difficulty: undefined, distance: null, elevation: undefined })).toEqual([]);
    expect(orderRoutePills({})).toEqual([]);
  });
});
