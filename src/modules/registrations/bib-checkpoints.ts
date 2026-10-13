import { BIB_LAYOUT } from "./bib-geometry";
import type { BibProfile } from "./bib-profile";

/**
 * The route's checkpoints on a race number (§NNN; the owner, 2026-10-13: «I need to put checkpoints and
 * limit times», the trail example's profile with its points marked): a small ring at each checkpoint's
 * kilometre on the profile's line, a tick down to the chart's foot, and — where it fits — the
 * cut-off in small type under it.
 *
 * Pure and importing nothing but the geometry: no storage, no React. The decisions — which marks fit,
 * whether the times fit — are made **once, here**, and both renderers draw what this hands them
 * (`bibs-pdf.ts` with vector paths, `bib-image.tsx` with an SVG), so the sheet and the picture cannot
 * disagree about which cut-offs a number carries.
 *
 * **The crowding rule**, said where it is applied: the strip is `profileChartWidth` points wide and a
 * race may have thirty points. (1) A mark closer than `checkpointMinGap` points to the one before it
 * is not drawn — the first of two that close stays, with its time. (2) The cut-offs are written only
 * when **every** one of them has room: each time's box clear of the next by `checkpointTimeGap` points
 * and clear of the words «Start» and «Sosire» at the two ends. One that does not fit takes **all** the
 * times with it and the marks stay — a bib that says some cut-offs and not the others is read as the
 * others having none, and the table on the event's page says them all. The times go before the marks.
 */

/** One checkpoint on the strip: where it stands on the chart (shares, 0 to 1) and its cut-off, or null. */
export type BibCheckpointMark = {
  /** The share of the route's distance, 0 at the start, 1 at the finish. */
  x: number;
  /** Where the profile's line is at that distance, 0 at its lowest, 1 at its highest. */
  y: number;
  /** The cut-off as `HH:MM`, when it is written. */
  time: string | null;
};

export type BibCheckpointsDrawing = { marks: BibCheckpointMark[]; timesShown: boolean };

/** Roboto's digits and colon, about: the average advance of a small-type character as a share of its size. */
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
const textWidth = (text: string): number => text.length * BIB_LAYOUT.profileLabelSize * CHARACTER_EM;

/**
 * The marks to draw for a route's checkpoints, or null when none is drawn: no checkpoint within
 * the route's length, or no length to place them by. `routeKm` is the distance the bib prints (the
 * club's own figure first, §750), so the finish is the strip's right end whatever the track's own
 * length; a checkpoint beyond it is not on this strip.
 */
export function bibCheckpointMarks(input: {
  checkpoints: ReadonlyArray<{ km: number; cutoff: string | null }>;
  routeKm: number;
  points: BibProfile["points"];
  /** The words under the strip's two ends, whose room the times must not take. */
  startWord: string;
  finishWord: string;
}): BibCheckpointsDrawing | null {
  const L = BIB_LAYOUT;
  if (!(input.routeKm > 0) || input.points.length < 2) return null;
  const width = L.profileChartWidth;
  const sorted = input.checkpoints
    .filter((row) => row.km >= 0 && row.km <= input.routeKm)
    .map((row, at) => ({ row, at }))
    .sort((a, b) => a.row.km - b.row.km || a.at - b.at)
    .map(({ row }) => row);

  // (1) The marks: a mark too close to the one kept before it is not drawn.
  const kept: { x: number; cutoff: string | null }[] = [];
  for (const row of sorted) {
    const x = Math.min(1, row.km / input.routeKm);
    const last = kept[kept.length - 1];
    if (last && (x - last.x) * width < L.checkpointMinGap) continue;
    kept.push({ x, cutoff: row.cutoff });
  }
  if (kept.length === 0) return null;

  // (2) The times: each one's box, against the next and against the two end words.
  const boxes = kept
    .filter((mark) => mark.cutoff !== null)
    .map((mark) => ({ from: mark.x * width - textWidth(mark.cutoff as string) / 2, to: mark.x * width + textWidth(mark.cutoff as string) / 2 }));
  const startEnds = textWidth(input.startWord) + L.checkpointTimeGap;
  const finishFrom = width - textWidth(input.finishWord) - L.checkpointTimeGap;
  let fits = true;
  boxes.forEach((box, at) => {
    const next = boxes[at + 1];
    if (next && next.from - box.to < L.checkpointTimeGap) fits = false;
    if (box.from < startEnds || box.to > finishFrom) fits = false;
  });
  const timesShown = fits && boxes.length > 0;

  return {
    marks: kept.map((mark) => ({ x: round(mark.x), y: round(profileHeightAt(input.points, mark.x)), time: timesShown ? mark.cutoff : null })),
    timesShown,
  };
}

const round = (value: number): number => Math.round(value * 1000) / 1000;
