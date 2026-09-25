import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

/**
 * `DECISIONS.md` §NNN — the difficulty as a scale of dumbbells (the owner, 2026-09-25: "I want
 * also for the difficulty to have a better icon system, like weights or something"), replacing
 * the phone-signal bars §112 first chose.
 *
 * `DifficultyIcon.tsx` draws all three of the closed set's dumbbells in one `<svg>` for every
 * value — the first `level` lit (no `opacity` override, `currentColor`), the rest faint
 * (`theme.palette.action.disabledOpacity`) — so `GlyphChip`'s clone of the `icon` prop always
 * sees exactly one element, the same as every other glyph in the registry.
 */
const { EASY_DIFFICULTY_ICON, MODERATE_DIFFICULTY_ICON, HARD_DIFFICULTY_ICON } = await import("@/modules/events/ui/DifficultyIcon");
const { default: GlyphChip } = await import("@/modules/events/ui/GlyphChip");

function counts(html: string) {
  return {
    on: (html.match(/data-testid="difficulty-dumbbell-on"/g) ?? []).length,
    off: (html.match(/data-testid="difficulty-dumbbell-off"/g) ?? []).length,
  };
}

describe("§NNN DifficultyIcon — a scale of dumbbells, one through three lit", () => {
  it("EASY lights one dumbbell of three", () => {
    const html = renderToStaticMarkup(EASY_DIFFICULTY_ICON({}));
    expect(counts(html)).toEqual({ on: 1, off: 2 });
  });

  it("MODERATE lights two of three", () => {
    const html = renderToStaticMarkup(MODERATE_DIFFICULTY_ICON({}));
    expect(counts(html)).toEqual({ on: 2, off: 1 });
  });

  it("HARD lights all three", () => {
    const html = renderToStaticMarkup(HARD_DIFFICULTY_ICON({}));
    expect(counts(html)).toEqual({ on: 3, off: 0 });
  });

  it("draws exactly one <svg>, whichever level — what GlyphChip's clone and .MuiChip-icon expect", () => {
    for (const Icon of [EASY_DIFFICULTY_ICON, MODERATE_DIFFICULTY_ICON, HARD_DIFFICULTY_ICON]) {
      const html = renderToStaticMarkup(Icon({}));
      expect((html.match(/<svg\b/g) ?? []).length).toBe(1);
    }
  });

  it("is aria-hidden, so a screen reader hears none of the dumbbells", () => {
    const html = renderToStaticMarkup(EASY_DIFFICULTY_ICON({}));
    expect(html).toContain('aria-hidden="true"');
  });

  it("a pill with no ariaLabel keeps its word as its accessible name (§318)", () => {
    const html = renderToStaticMarkup(GlyphChip({ glyph: "type:RACE", label: "Cursă" }));
    // The chip carries no aria-label of its own: its accessible name is its text content, the
    // word — `.MuiChip-icon` is `aria-hidden` (every `SvgIcon` is, unless given a title).
    expect(html).not.toMatch(/aria-label="[^"]*Cursă/);
    expect(html).toContain(">Cursă<");
    const svgOpenTags = [...html.matchAll(/<svg\b[^>]*>/g)];
    for (const [tag] of svgOpenTags) expect(tag).toContain('aria-hidden="true"');
  });

  it("the difficulty pill's accessible name is «Dificultate: …», not the bare word (fix round, finding 3)", () => {
    const html = renderToStaticMarkup(
      GlyphChip({ glyph: "difficulty:MODERATE", label: "Mediu", ariaLabel: "Dificultate: Mediu" }),
    );
    expect(html).toContain('aria-label="Dificultate: Mediu"');
    expect(html).toContain(">Mediu<");
    const svgOpenTags = [...html.matchAll(/<svg\b[^>]*>/g)];
    for (const [tag] of svgOpenTags) expect(tag).toContain('aria-hidden="true"');
  });

  it("draws each of the scale's dumbbells as Material's own FitnessCenter path, one per level, in a wide viewBox", () => {
    const html = renderToStaticMarkup(HARD_DIFFICULTY_ICON({}));
    expect(html).toContain('viewBox="0 0 72 24"');
    expect((html.match(/<path/g) ?? []).length).toBe(3);
  });
});
