import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

/**
 * `DECISIONS.md` §412 — five levels and a gauge (the owner, 2026-09-25: "vreau să fie foarte
 * ușor, ușor, mediu, greu și foarte greu — sau un gauge icon custom mai degrabă"), replacing §399's
 * scale of weights.
 *
 * `DifficultyGaugeIcon.tsx` draws one half-dial in one `<svg>` for every level: five arc segments,
 * the first `level` lit (`currentColor`, no opacity override) and the rest faint
 * (`theme.palette.action.disabledOpacity`), and a needle at the middle of the level's own segment
 * — so `GlyphChip`'s clone of the `icon` prop always sees exactly one element, one icon wide.
 */
const { DIFFICULTY_ICONS } = await import("@/modules/events/ui/difficulty-glyphs");
const { DIFFICULTY_LEVELS } = await import("@/modules/events/domain/difficulty");
const { eventDifficulty } = await import("@/db/schema/events");
const { GLYPHS } = await import("@/modules/events/ui/glyphs");
const { default: DifficultyGaugeIcon, needleAngle } = await import("@/modules/events/ui/DifficultyGaugeIcon");
const { default: GlyphChip } = await import("@/modules/events/ui/GlyphChip");

function counts(html: string) {
  return {
    on: (html.match(/data-testid="difficulty-gauge-on"/g) ?? []).length,
    off: (html.match(/data-testid="difficulty-gauge-off"/g) ?? []).length,
  };
}

/** The needle's tip, from its `d="M12 19L<x> <y>"`. */
function needleTip(html: string) {
  const match = /data-testid="difficulty-gauge-needle" d="M12 19L([\d.-]+) ([\d.-]+)"/.exec(html);
  if (!match) throw new Error("no needle");
  return { x: Number(match[1]), y: Number(match[2]) };
}

describe("§412 the difficulty's five levels, one ordered list", () => {
  it("is the database enum's own values, in the enum's own order — very easy to very hard", () => {
    expect([...DIFFICULTY_LEVELS]).toEqual(["VERY_EASY", "EASY", "MODERATE", "HARD", "VERY_HARD"]);
    expect([...eventDifficulty.enumValues]).toEqual([...DIFFICULTY_LEVELS]);
  });
});

describe("§412 DifficultyGaugeIcon — a half-dial, the needle at one of five positions", () => {
  it.each(DIFFICULTY_LEVELS.map((level, index) => [level, index + 1] as const))("%s lights %i of five segments", (level, lit) => {
    const html = renderToStaticMarkup(createElement(DIFFICULTY_ICONS[level]));
    expect(counts(html)).toEqual({ on: lit, off: DIFFICULTY_LEVELS.length - lit });
    expect(html).toContain(`data-level="${lit}"`);
  });

  it("swings the needle left to right, one position per level: left of centre for the easy ones, upright for the middle, right for the hard ones", () => {
    const tips = DIFFICULTY_LEVELS.map((level) => needleTip(renderToStaticMarkup(createElement(DIFFICULTY_ICONS[level]))));
    for (let index = 1; index < tips.length; index++) expect(tips[index]!.x, DIFFICULTY_LEVELS[index]).toBeGreaterThan(tips[index - 1]!.x);
    expect(tips[0]!.x).toBeLessThan(12);
    expect(tips[2]!.x).toBe(12);
    expect(tips[4]!.x).toBeGreaterThan(12);
    // Every tip above the hub: a half-dial, never pointing down.
    for (const tip of tips) expect(tip.y).toBeLessThan(19);
    expect(DIFFICULTY_LEVELS.map((_, index) => needleAngle(index + 1))).toEqual([162, 126, 90, 54, 18]);
  });

  it("draws exactly one <svg> on the 24-unit grid, one icon wide, whichever level — what GlyphChip's clone and .MuiChip-icon expect", () => {
    for (const level of DIFFICULTY_LEVELS) {
      const html = renderToStaticMarkup(createElement(DIFFICULTY_ICONS[level]));
      expect((html.match(/<svg\b/g) ?? []).length).toBe(1);
      expect(html).toContain('viewBox="0 0 24 24"');
      // No width of its own: §399's scale of weights widened its chip clone to `3em`; the gauge is one glyph.
      expect(html).not.toMatch(/width:\s*(?!1em)[\d.]+em/);
    }
  });

  it("carries no colour of its own — every stroke and fill is the chip's ink (§112)", () => {
    const html = renderToStaticMarkup(createElement(DIFFICULTY_ICONS.VERY_HARD));
    const paints = [...html.matchAll(/\b(?:stroke|fill)="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(paints)).toEqual(new Set(["currentColor", "none"]));
  });

  it("is aria-hidden, so a screen reader hears none of the dial", () => {
    const html = renderToStaticMarkup(createElement(DIFFICULTY_ICONS.EASY));
    expect(html).toContain('aria-hidden="true"');
  });

  it("refuses a level outside the scale", () => {
    expect(() => renderToStaticMarkup(createElement(DifficultyGaugeIcon, { level: 0 }))).toThrow(RangeError);
    expect(() => renderToStaticMarkup(createElement(DifficultyGaugeIcon, { level: 6 }))).toThrow(RangeError);
    expect(() => renderToStaticMarkup(createElement(DifficultyGaugeIcon, { level: 2.5 }))).toThrow(RangeError);
  });

  it("a pill with no srSuffix keeps its word as its accessible name (§318)", () => {
    const html = renderToStaticMarkup(GlyphChip({ glyph: "type:RACE", label: "Cursă" }));
    expect(html).not.toMatch(/aria-label="[^"]*Cursă/);
    expect(html).toContain(">Cursă<");
    const svgOpenTags = [...html.matchAll(/<svg\b[^>]*>/g)];
    for (const [tag] of svgOpenTags) expect(tag).toContain('aria-hidden="true"');
  });

  it("draws the gauge inside a difficulty pill, beside the word", () => {
    const html = renderToStaticMarkup(GlyphChip({ glyph: "difficulty:VERY_HARD", label: "Foarte greu", srSuffix: "Dificultate" }));
    expect(html).toContain('data-testid="difficulty-gauge"');
    expect(html).toMatch(/<svg\b[^>]*MuiChip-icon/);
    expect(html).toContain(">Foarte greu<");
  });

  // The pill's words for a screen reader — the level, then «— Dificultate» in a visually-hidden
  // span (`GlyphChip`'s `srSuffix`) — are tested through `buildRoutePills` and `RoutePills` in
  // `route-pills-build.test.ts`, for each of the five levels in both locales.

  it("registers one difficulty glyph per level, mapped over DIFFICULTY_LEVELS", () => {
    expect(Object.keys(DIFFICULTY_ICONS)).toEqual([...DIFFICULTY_LEVELS]);
    for (const level of DIFFICULTY_LEVELS) expect(GLYPHS[`difficulty:${level}`]).toBe(DIFFICULTY_ICONS[level]);
  });
});
