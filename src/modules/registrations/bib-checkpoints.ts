import { BIB_LAYOUT } from "./bib-geometry";
import type { BibProfile } from "./bib-profile";

/**
 * The route's checkpoints on a race number's profile strip (§757, amending §750; the owner, 2026-10-13:
 * «I need to put checkpoints and limit times», and on the bib: «nu pot să văd unde e punctul de
 * alimentare pe acel număr»).
 *
 * At each checkpoint's kilometre on the strip:
 *
 * - **an aid station** — water or food — is a small drawn glyph beside the profile's line: a cup where
 *   there is water, a fork where there is food alone. It stands above the line, or under it where the
 *   line runs too close to the chart's top for the glyph to fit, so it never leaves the profile's own
 *   row (`profileHeight`, taken from the number's area — it cannot cover the number or the name);
 * - **any other point** (first aid, timing, or nothing said) is a small dot on the line;
 * - every point has a thin tick from the line (or from its glyph) down to the chart's foot;
 * - under the tick, in the labels' row of «Start» and «Sosire», **«km 12»** where there is room, and
 *   with the second tick «…cu orele limită» **«km 12 · 11:30»** — the cut-off beside the point.
 *
 * Pure and importing nothing but the geometry: no storage, no React. Every decision — which marks are
 * drawn, where each glyph stands, which words fit — is made **once, here**, and both renderers draw what
 * this hands them (`bibs-pdf.ts` with vector paths, `bib-image.tsx` with an SVG) at the same points, so
 * the sheet and the picture cannot disagree.
 *
 * **The crowding rule** — the strip is `profileChartWidth` points wide and a route may have thirty
 * points; the words go before the marks, the times before the kilometres:
 *
 * 1. A mark closer than `checkpointMinGap` points to the one kept before it is not drawn; the first of
 *    two that close stays — unless the later one is an aid station and the earlier is not, when the aid
 *    station takes its place (the water is what a runner looks for on the number).
 * 2. The cut-offs are printed only when the tick asks for them and **every** label then fits — each
 *    clear of the next by `checkpointTimeGap` points and clear of the words «Start» and «Sosire» at the
 *    two ends. One that does not fit takes **all** the times with it: a bib that says some cut-offs and
 *    not the others is read as the others having none, and the event's page says them all.
 * 3. Without the times, each «km 12» is printed where it has room — left to right, a label that would
 *    touch the one kept before it or an end word is left out — so a crowded strip keeps the marks and
 *    loses words first.
 */

/** What a point offers, as far as the strip draws it: the glyph of an aid station, or none. */
export type BibCheckpointGlyph = "water" | "food" | null;

/** One checkpoint on the strip, in the chart's own box (x, y: shares from 0 to 1; offsets in points). */
export type BibCheckpointMark = {
  /** The share of the route's distance, 0 at the start, 1 at the finish. */
  x: number;
  /** Where the profile's line is at that distance, 0 at its lowest, 1 at its highest. */
  y: number;
  /** The aid station's glyph, or null for a dot. */
  glyph: BibCheckpointGlyph;
  /**
   * The glyph's centre in points from the chart's top (`checkpointGlyphHeight` tall), above the line
   * or under it; null without a glyph.
   */
  glyphY: number | null;
  /** Where the tick starts, in points from the chart's top: under the dot, or under a glyph that stands below the line. */
  tickFrom: number;
  /** The words under the tick — «km 12» or «km 12 · 11:30» — or null where they do not fit. */
  label: string | null;
};

export type BibCheckpointsDrawing = { marks: BibCheckpointMark[]; timesShown: boolean };

/** A checkpoint as the strip reads it: where, what, and by when. */
export type BibCheckpointSource = { km: number; kinds: readonly string[]; cutoff: string | null };

/** Roboto's digits and letters, about: the average advance of a small-type character as a share of its size. */
const CHARACTER_EM = 0.6;

/** The profile's height at a share of the distance, by linear interpolation between its points. */
export function profileHeightAt(points: BibProfile["points"], share: number): number {
  const x = Math.min(1, Math.max(0, share));
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    if (x <= x1) return x1 === x0 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return points[points.length - 1][1];
}

/** The width a piece of small type takes, estimated the same for both renderers. */
export const bibLabelWidth = (text: string): number => text.length * BIB_LAYOUT.profileLabelSize * CHARACTER_EM;

/** The glyph a point's kinds give it: water first (a cup), else food (a fork), else none. */
export function checkpointGlyph(kinds: readonly string[]): BibCheckpointGlyph {
  return kinds.includes("WATER") ? "water" : kinds.includes("FOOD") ? "food" : null;
}

/**
 * The glyphs' strokes, in a box centred on (0, 0), `checkpointGlyphWidth` × `checkpointGlyphHeight`
 * points: each a list of polylines, stroked `checkpointGlyphWeight` by both renderers.
 */
export function checkpointGlyphLines(glyph: Exclude<BibCheckpointGlyph, null>): Array<ReadonlyArray<readonly [number, number]>> {
  const w = BIB_LAYOUT.checkpointGlyphWidth / 2;
  const h = BIB_LAYOUT.checkpointGlyphHeight / 2;
  if (glyph === "water") {
    // A cup: open at the top, narrower at its foot.
    return [
      [
        [-w, -h],
        [-w * 0.65, h],
        [w * 0.65, h],
        [w, -h],
      ],
    ];
  }
  // A fork: three tines joined by a bar, and the handle under it.
  const bar = -h * 0.15;
  return [
    [
      [-w * 0.8, -h],
      [-w * 0.8, bar],
      [w * 0.8, bar],
      [w * 0.8, -h],
    ],
    [
      [0, -h],
      [0, h],
    ],
  ];
}

type Box = { from: number; to: number };

/** Whether a row of label boxes, left to right, keeps its gaps and leaves the two end words alone. */
function allFit(boxes: readonly Box[], startEnds: number, finishFrom: number): boolean {
  return boxes.every((box, at) => box.from >= startEnds && box.to <= finishFrom && (at === 0 || box.from - boxes[at - 1].to >= BIB_LAYOUT.checkpointTimeGap));
}

/**
 * The marks to draw for a route's checkpoints, or null when none is drawn: no checkpoint within the
 * route's length, or no length to place them by. `routeKm` is the distance the bib prints (the club's
 * own figure first, §750), so the finish is the strip's right end whatever the track's own length; a
 * checkpoint beyond it is not on this strip. `label` says a point's words in the sheet's language —
 * «km 12», or with `withTime` «km 12 · 11:30».
 */
export function bibCheckpointMarks(input: {
  checkpoints: readonly BibCheckpointSource[];
  routeKm: number;
  points: BibProfile["points"];
  /** «…cu orele limită»: print the cut-offs beside the points, where every one fits. */
  showTimes: boolean;
  /** The words under the strip's two ends, whose room the labels must not take. */
  startWord: string;
  finishWord: string;
  label: (row: BibCheckpointSource, withTime: boolean) => string;
  /**
   * The chart's width in points (§NNN): `profileChartWidth` beside the figures, the strip's whole width
   * with «Arată distanța și diferența de nivel lângă profil» off (`bib-geometry.ts#bibProfileChartWidth`)
   * — the crowding rule measures in it. Absent, the chart beside the figures.
   */
  chartWidth?: number;
}): BibCheckpointsDrawing | null {
  const L = BIB_LAYOUT;
  if (!(input.routeKm > 0) || input.points.length < 2) return null;
  const width = input.chartWidth ?? L.profileChartWidth;
  const sorted = input.checkpoints
    .filter((row) => row.km >= 0 && row.km <= input.routeKm)
    .map((row, at) => ({ row, at }))
    .sort((a, b) => a.row.km - b.row.km || a.at - b.at)
    .map(({ row }) => row);

  // (1) The marks: one too close to the one kept before it is not drawn — an aid station wins the place.
  const kept: { x: number; row: BibCheckpointSource; glyph: BibCheckpointGlyph }[] = [];
  for (const row of sorted) {
    const x = Math.min(1, row.km / input.routeKm);
    const glyph = checkpointGlyph(row.kinds);
    const last = kept[kept.length - 1];
    if (last && (x - last.x) * width < L.checkpointMinGap) {
      if (glyph !== null && last.glyph === null) kept[kept.length - 1] = { x, row, glyph };
      continue;
    }
    kept.push({ x, row, glyph });
  }
  if (kept.length === 0) return null;

  // (2) and (3) The words: with the times when all of them fit, else each «km» where it has room.
  const startEnds = bibLabelWidth(input.startWord) + L.checkpointTimeGap;
  const finishFrom = width - bibLabelWidth(input.finishWord) - L.checkpointTimeGap;
  const boxOf = (x: number, text: string): Box => ({ from: x * width - bibLabelWidth(text) / 2, to: x * width + bibLabelWidth(text) / 2 });
  const anyTime = kept.some((mark) => mark.row.cutoff !== null);
  let labels: (string | null)[] = kept.map(() => null);
  let timesShown = false;
  if (input.showTimes && anyTime) {
    const withTimes = kept.map((mark) => input.label(mark.row, mark.row.cutoff !== null));
    if (allFit(withTimes.map((text, at) => boxOf(kept[at].x, text)), startEnds, finishFrom)) {
      labels = withTimes;
      timesShown = true;
    }
  }
  if (!timesShown) {
    let previous: Box | null = null;
    labels = kept.map((mark) => {
      const text = input.label(mark.row, false);
      const box = boxOf(mark.x, text);
      if (box.from < startEnds || box.to > finishFrom || (previous && box.from - previous.to < L.checkpointTimeGap)) return null;
      previous = box;
      return text;
    });
  }

  return {
    marks: kept.map((mark, at) => {
      const y = profileHeightAt(input.points, mark.x);
      const lineY = (1 - y) * L.profileChartHeight;
      const reach = L.checkpointGlyphGap + L.checkpointGlyphHeight;
      // Above the line where the chart has room for it, else under the line: never out of the row.
      const above = lineY - reach >= 0;
      const glyphY = mark.glyph === null ? null : round(above ? lineY - reach + L.checkpointGlyphHeight / 2 : lineY + reach - L.checkpointGlyphHeight / 2);
      const tickFrom = mark.glyph !== null && !above ? lineY + reach : lineY + L.checkpointDot;
      return { x: round(mark.x), y: round(y), glyph: mark.glyph, glyphY, tickFrom: round(Math.min(tickFrom, L.profileChartHeight)), label: labels[at] };
    }),
    timesShown,
  };
}

const round = (value: number): number => Math.round(value * 1000) / 1000;
