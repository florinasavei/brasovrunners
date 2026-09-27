import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

/**
 * `DECISIONS.md` §412 — five bands and a gauge (the owner, 2026-09-25: "vreau să fie foarte
 * ușor, ușor, mediu, greu și foarte greu — sau un gauge icon custom mai degrabă"), replacing §399's
 * scale of weights; and §NNN — three steps inside each band, fifteen levels, the step as dots.
 *
 * `DifficultyGaugeIcon.tsx` draws one half-dial in one `<svg>`: five arc segments, the first
 * `band` lit (`currentColor`, no opacity override) and the rest faint
 * (`theme.palette.action.disabledOpacity`), a needle inside the band's own segment — at its middle
 * for a band alone, at the step's third of it for a level — and, for a level, three dots under the
 * hub with the step's lit. `GlyphChip`'s clone of the `icon` prop always sees exactly one element.
 */
const { DIFFICULTY_ICONS, DIFFICULTY_LEVEL_ICONS, difficultyLevelGlyph } = await import("@/modules/events/ui/difficulty-glyphs");
const { DIFFICULTY_BANDS, DIFFICULTY_STEPS, DIFFICULTY_LEVEL_COUNT } = await import("@/modules/events/domain/difficulty");
const { eventDifficulty } = await import("@/db/schema/events");
const { GLYPHS } = await import("@/modules/events/ui/glyphs");
const { default: DifficultyGaugeIcon, needleAngle } = await import("@/modules/events/ui/DifficultyGaugeIcon");
const { default: GlyphChip } = await import("@/modules/events/ui/GlyphChip");

function counts(html: string) {
  return {
    on: (html.match(/data-testid="difficulty-gauge-on"/g) ?? []).length,
    off: (html.match(/data-testid="difficulty-gauge-off"/g) ?? []).length,
    stepOn: (html.match(/data-testid="difficulty-step-on"/g) ?? []).length,
    stepOff: (html.match(/data-testid="difficulty-step-off"/g) ?? []).length,
  };
}

/** The needle's tip, from its `d="M12 16L<x> <y>"`. */
function needleTip(html: string) {
  const match = /data-testid="difficulty-gauge-needle" d="M12 16L([\d.-]+) ([\d.-]+)"/.exec(html);
  if (!match) throw new Error("no needle");
  return { x: Number(match[1]), y: Number(match[2]) };
}

const LEVELS = Array.from({ length: DIFFICULTY_LEVEL_COUNT }, (_, index) => index + 1);
const levelHtml = (level: number) => renderToStaticMarkup(createElement(GLYPHS[difficultyLevelGlyph(level)]));

describe("§412 the difficulty's five bands, one ordered list", () => {
  it("is the database enum's own values, in the enum's own order — very easy to very hard", () => {
    expect([...DIFFICULTY_BANDS]).toEqual(["VERY_EASY", "EASY", "MODERATE", "HARD", "VERY_HARD"]);
    expect([...eventDifficulty.enumValues]).toEqual([...DIFFICULTY_BANDS]);
  });
});

describe("§412 DifficultyGaugeIcon for a band — a half-dial, the needle at the band's middle, no dots", () => {
  it.each(DIFFICULTY_BANDS.map((band, index) => [band, index + 1] as const))("%s lights %i of five segments", (band, lit) => {
    const html = renderToStaticMarkup(createElement(DIFFICULTY_ICONS[band]));
    expect(counts(html)).toEqual({ on: lit, off: DIFFICULTY_BANDS.length - lit, stepOn: 0, stepOff: 0 });
    expect(html).toContain(`data-band="${lit}"`);
    expect(html).not.toContain("data-step");
  });

  it("swings the needle left to right, one position per band: left of centre for the easy ones, upright for the middle, right for the hard ones", () => {
    const tips = DIFFICULTY_BANDS.map((band) => needleTip(renderToStaticMarkup(createElement(DIFFICULTY_ICONS[band]))));
    for (let index = 1; index < tips.length; index++) expect(tips[index]!.x, DIFFICULTY_BANDS[index]).toBeGreaterThan(tips[index - 1]!.x);
    expect(tips[0]!.x).toBeLessThan(12);
    expect(tips[2]!.x).toBe(12);
    expect(tips[4]!.x).toBeGreaterThan(12);
    for (const tip of tips) expect(tip.y).toBeLessThan(16);
    expect(DIFFICULTY_BANDS.map((_, index) => needleAngle(index + 1))).toEqual([162, 126, 90, 54, 18]);
  });
});

describe("§NNN DifficultyGaugeIcon for a level — the band's segments, the needle at the step, the step's dots", () => {
  it("registers one glyph per level of the fifteen, named by band and step", () => {
    expect(Object.keys(DIFFICULTY_LEVEL_ICONS)).toHaveLength(15);
    expect(difficultyLevelGlyph(1)).toBe("difficulty:VERY_EASY-1");
    expect(difficultyLevelGlyph(8)).toBe("difficulty:MODERATE-2");
    expect(difficultyLevelGlyph(15)).toBe("difficulty:VERY_HARD-3");
    for (const level of LEVELS) expect(GLYPHS[difficultyLevelGlyph(level)], String(level)).toBeDefined();
  });

  it.each(LEVELS)("level %i lights its band's segments and its step's dots", (level) => {
    const band = Math.ceil(level / 3);
    const step = ((level - 1) % 3) + 1;
    const html = levelHtml(level);
    expect(counts(html)).toEqual({ on: band, off: 5 - band, stepOn: step, stepOff: 3 - step });
    expect(html).toContain(`data-level="${level}"`);
    expect(html).toContain(`data-band="${band}"`);
    expect(html).toContain(`data-step="${step}"`);
  });

  it("moves the needle right at every one of the fifteen levels, and step 2 stands where the band alone does", () => {
    const tips = LEVELS.map((level) => needleTip(levelHtml(level)));
    for (let index = 1; index < tips.length; index++) expect(tips[index]!.x, `level ${index + 1}`).toBeGreaterThan(tips[index - 1]!.x);
    for (const [index, band] of DIFFICULTY_BANDS.entries()) {
      expect(needleAngle(index + 1, 2)).toBeCloseTo(needleAngle(index + 1));
      expect(needleTip(levelHtml(index * 3 + 2))).toEqual(needleTip(renderToStaticMarkup(createElement(DIFFICULTY_ICONS[band]))));
    }
    // Every step's needle stays inside its band's drawn segment (the 3° gaps left blank).
    for (let band = 1; band <= 5; band++) {
      for (const step of DIFFICULTY_STEPS) {
        const angle = needleAngle(band, step);
        expect(angle).toBeLessThan(180 - (band - 1) * 36 - 3);
        expect(angle).toBeGreaterThan(180 - band * 36 + 3);
      }
    }
  });
});

describe("§412/§NNN one glyph, drawn in the chip's ink", () => {
  it("draws exactly one <svg> on the 24-unit grid, one icon wide, whichever band or level", () => {
    const all = [
      ...DIFFICULTY_BANDS.map((band) => renderToStaticMarkup(createElement(DIFFICULTY_ICONS[band]))),
      ...LEVELS.map(levelHtml),
    ];
    for (const html of all) {
      expect((html.match(/<svg\b/g) ?? []).length).toBe(1);
      expect(html).toContain('viewBox="0 0 24 24"');
      expect(html).not.toMatch(/width:\s*(?!1em)[\d.]+em/);
    }
  });

  it("carries no colour of its own — every stroke and fill is the chip's ink (§112)", () => {
    const html = levelHtml(15);
    const paints = [...html.matchAll(/\b(?:stroke|fill)="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(paints)).toEqual(new Set(["currentColor", "none"]));
  });

  it("keeps the dots inside the 24-unit grid", () => {
    const html = levelHtml(8);
    for (const match of html.matchAll(/<circle[^>]*cx="([\d.]+)"[^>]*cy="([\d.]+)"[^>]*r="([\d.]+)"/g)) {
      const [cx, cy, r] = [Number(match[1]), Number(match[2]), Number(match[3])];
      expect(cx - r).toBeGreaterThanOrEqual(0);
      expect(cx + r).toBeLessThanOrEqual(24);
      expect(cy + r).toBeLessThanOrEqual(24);
    }
  });

  it("is aria-hidden, so a screen reader hears none of the dial", () => {
    expect(levelHtml(5)).toContain('aria-hidden="true"');
  });

  it("refuses a band or a step outside the scale", () => {
    expect(() => renderToStaticMarkup(createElement(DifficultyGaugeIcon, { band: 0 }))).toThrow(RangeError);
    expect(() => renderToStaticMarkup(createElement(DifficultyGaugeIcon, { band: 6 }))).toThrow(RangeError);
    expect(() => renderToStaticMarkup(createElement(DifficultyGaugeIcon, { band: 2.5 }))).toThrow(RangeError);
    expect(() => renderToStaticMarkup(createElement(DifficultyGaugeIcon, { band: 2, step: 0 }))).toThrow(RangeError);
    expect(() => renderToStaticMarkup(createElement(DifficultyGaugeIcon, { band: 2, step: 4 }))).toThrow(RangeError);
  });

  it("a pill with no srSuffix keeps its word as its accessible name (§318)", () => {
    const html = renderToStaticMarkup(GlyphChip({ glyph: "type:RACE", label: "Cursă" }));
    expect(html).not.toMatch(/aria-label="[^"]*Cursă/);
    expect(html).toContain(">Cursă<");
    for (const [tag] of html.matchAll(/<svg\b[^>]*>/g)) expect(tag).toContain('aria-hidden="true"');
  });

  it("draws the level's gauge inside a difficulty pill, beside the word", () => {
    const html = renderToStaticMarkup(GlyphChip({ glyph: "difficulty:VERY_HARD-3", label: "Foarte greu", srSuffix: "Dificultate, treapta 3 din 3" }));
    expect(html).toContain('data-testid="difficulty-gauge"');
    expect(html).toContain('data-level="15"');
    expect(html).toMatch(/<svg\b[^>]*MuiChip-icon/);
    expect(html).toContain(">Foarte greu<");
  });

  it("registers one band glyph per band, mapped over DIFFICULTY_BANDS", () => {
    expect(Object.keys(DIFFICULTY_ICONS)).toEqual([...DIFFICULTY_BANDS]);
    for (const band of DIFFICULTY_BANDS) expect(GLYPHS[`difficulty:${band}`]).toBe(DIFFICULTY_ICONS[band]);
  });
});
