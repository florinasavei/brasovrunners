import { createElement } from "react";
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
const { DIFFICULTY_ICONS } = await import("@/modules/events/ui/difficulty-glyphs");
const { DIFFICULTY_LEVELS } = await import("@/modules/events/ui/difficulty-levels");
const { GLYPHS } = await import("@/modules/events/ui/glyphs");
const { EASY: EASY_DIFFICULTY_ICON, MODERATE: MODERATE_DIFFICULTY_ICON, HARD: HARD_DIFFICULTY_ICON } = DIFFICULTY_ICONS;
const { default: GlyphChip } = await import("@/modules/events/ui/GlyphChip");

function counts(html: string) {
  return {
    on: (html.match(/data-testid="difficulty-dumbbell-on"/g) ?? []).length,
    off: (html.match(/data-testid="difficulty-dumbbell-off"/g) ?? []).length,
  };
}

describe("§NNN DifficultyIcon — a scale of dumbbells, one through three lit", () => {
  it("EASY lights one dumbbell of three", () => {
    const html = renderToStaticMarkup(createElement(EASY_DIFFICULTY_ICON));
    expect(counts(html)).toEqual({ on: 1, off: 2 });
  });

  it("MODERATE lights two of three", () => {
    const html = renderToStaticMarkup(createElement(MODERATE_DIFFICULTY_ICON));
    expect(counts(html)).toEqual({ on: 2, off: 1 });
  });

  it("HARD lights all three", () => {
    const html = renderToStaticMarkup(createElement(HARD_DIFFICULTY_ICON));
    expect(counts(html)).toEqual({ on: 3, off: 0 });
  });

  it("draws exactly one <svg>, whichever level — what GlyphChip's clone and .MuiChip-icon expect", () => {
    for (const Icon of [EASY_DIFFICULTY_ICON, MODERATE_DIFFICULTY_ICON, HARD_DIFFICULTY_ICON]) {
      const html = renderToStaticMarkup(createElement(Icon));
      expect((html.match(/<svg\b/g) ?? []).length).toBe(1);
    }
  });

  it("is aria-hidden, so a screen reader hears none of the dumbbells", () => {
    const html = renderToStaticMarkup(createElement(EASY_DIFFICULTY_ICON));
    expect(html).toContain('aria-hidden="true"');
  });

  it("a pill with no srSuffix keeps its word as its accessible name (§318)", () => {
    const html = renderToStaticMarkup(GlyphChip({ glyph: "type:RACE", label: "Cursă" }));
    // The chip carries no aria-label of its own: its accessible name is its text content, the
    // word — `.MuiChip-icon` is `aria-hidden` (every `SvgIcon` is, unless given a title).
    expect(html).not.toMatch(/aria-label="[^"]*Cursă/);
    expect(html).toContain(">Cursă<");
    const svgOpenTags = [...html.matchAll(/<svg\b[^>]*>/g)];
    for (const [tag] of svgOpenTags) expect(tag).toContain('aria-hidden="true"');
  });

  // The pill's words for a screen reader — the level, then «— Dificultate» in a visually-hidden
  // span (`GlyphChip`'s `srSuffix`, the same one the external cost pill uses) — are tested through
  // `buildRoutePills` and `RoutePills` in `route-pills-build.test.ts`, for each level in both
  // locales, so a wrong key or a lost locale in `routePillParts` fails there.

  it("registers one difficulty glyph per level, mapped over DIFFICULTY_LEVELS", () => {
    expect(Object.keys(DIFFICULTY_ICONS)).toEqual([...DIFFICULTY_LEVELS]);
    DIFFICULTY_LEVELS.forEach((level, index) => {
      expect(GLYPHS[`difficulty:${level}`]).toBe(DIFFICULTY_ICONS[level]);
      expect(counts(renderToStaticMarkup(createElement(DIFFICULTY_ICONS[level])))).toEqual({ on: index + 1, off: DIFFICULTY_LEVELS.length - index - 1 });
    });
  });

  it("draws each of the scale's dumbbells as Material's own FitnessCenter path, one per level, in a wide viewBox", () => {
    const html = renderToStaticMarkup(createElement(HARD_DIFFICULTY_ICON));
    expect(html).toContain('viewBox="0 0 72 24"');
    expect((html.match(/<path/g) ?? []).length).toBe(3);
  });
});
