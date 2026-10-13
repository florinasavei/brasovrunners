/**
 * The route's profile on a race number (§750; the owner, 2026-10-13: the elevation over distance, with
 * the distance and the gain): a few dozen points computed once on the server from the event's route
 * GPX (§718), and the two facts beside them.
 *
 * Pure, importing nothing: no `node:` builtin, no storage, no React — the reader of the file is
 * `bib-extras.ts`, the two renderers draw what this hands them (`bibs-pdf.ts` with vector paths,
 * `bib-image.tsx` with an SVG, at the points `bib-geometry.ts` gives both).
 *
 * `events/domain/route-gpx.ts` holds the checks the upload applies (`checkGpx`) and has no reader of
 * the track, so the reader is here, next to the only thing that needs one. It is not a validating
 * XML parse: it reads the `<trkpt lat lon>` (else `<rtept>`) elements that carry an `<ele>`, which
 * is all a profile is made of; a file with fewer than two of them, or a track shorter than
 * `MIN_TRACK_METERS`, has no profile.
 */

import type { BibCheckpointsDrawing } from "./bib-checkpoints";

/** A track shorter than this has no profile worth drawing. */
export const MIN_TRACK_METERS = 50;

/** The points a drawing holds: enough for a smooth line at 250 points of width, never the file. */
export const PROFILE_POINTS = 64;
/** The finer series the gain is summed over, so the figure does not depend on the drawing's coarseness. */
const GAIN_SAMPLES = 200;
/** A route that climbs less than this across its whole length is drawn flat, not stretched to the box. */
const MIN_SPAN_METERS = 20;

/** One profile: `[x, y]` pairs, both from 0 to 1 — x the share of the distance, y the share of the elevation span. */
export type BibProfile = { points: ReadonlyArray<readonly [number, number]>; distanceMeters: number; gainMeters: number };

const EARTH_RADIUS_M = 6_371_000;

function haversine(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

type TrackPoint = { lat: number; lon: number; ele: number };

function pointsOf(text: string, element: "trkpt" | "rtept"): TrackPoint[] {
  const found: TrackPoint[] = [];
  const pattern = new RegExp(`<(?:\\w+:)?${element}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</(?:\\w+:)?${element}\\s*>)`, "g");
  for (const match of text.matchAll(pattern)) {
    const attributes = match[1] ?? "";
    const lat = /\blat\s*=\s*["']\s*(-?\d+(?:\.\d+)?)\s*["']/.exec(attributes)?.[1];
    const lon = /\blon\s*=\s*["']\s*(-?\d+(?:\.\d+)?)\s*["']/.exec(attributes)?.[1];
    const ele = /<(?:\w+:)?ele>\s*(-?\d+(?:\.\d+)?)\s*<\/(?:\w+:)?ele>/.exec(match[2] ?? "")?.[1];
    if (lat === undefined || lon === undefined || ele === undefined) continue;
    const point = { lat: Number(lat), lon: Number(lon), ele: Number(ele) };
    if (Math.abs(point.lat) <= 90 && Math.abs(point.lon) <= 180 && Number.isFinite(point.ele)) found.push(point);
  }
  return found;
}

/** The profile of a GPX document's text, or null when it has none (§750). */
export function parseGpxProfile(text: string): BibProfile | null {
  let track = pointsOf(text, "trkpt");
  if (track.length < 2) track = pointsOf(text, "rtept");
  if (track.length < 2) return null;
  const along = [0];
  for (let i = 1; i < track.length; i++) along.push(along[i - 1] + haversine(track[i - 1], track[i]));
  const total = along[along.length - 1];
  if (!(total >= MIN_TRACK_METERS)) return null;

  // The elevation at an even step of distance, by linear interpolation between the track's points.
  const resample = (count: number): number[] => {
    const series: number[] = [];
    let at = 0;
    for (let i = 0; i < count; i++) {
      const target = (total * i) / (count - 1);
      while (at < along.length - 2 && along[at + 1] < target) at++;
      const span = along[at + 1] - along[at];
      const share = span > 0 ? Math.min(1, Math.max(0, (target - along[at]) / span)) : 0;
      series.push(track[at].ele + (track[at + 1].ele - track[at].ele) * share);
    }
    return series;
  };
  // A three-point mean takes the GPS's jitter out of the climb without flattening a hill.
  const smooth = (series: number[]) => series.map((_, i) => (series[Math.max(0, i - 1)] + series[i] + series[Math.min(series.length - 1, i + 1)]) / 3);

  const fine = smooth(resample(GAIN_SAMPLES));
  let gain = 0;
  for (let i = 1; i < fine.length; i++) gain += Math.max(0, fine[i] - fine[i - 1]);

  const drawn = smooth(resample(PROFILE_POINTS));
  const low = Math.min(...drawn);
  const span = Math.max(Math.max(...drawn) - low, MIN_SPAN_METERS);
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return {
    points: drawn.map((ele, i) => [round(i / (PROFILE_POINTS - 1)), round((ele - low) / span)] as const),
    distanceMeters: Math.round(total),
    gainMeters: Math.round(gain),
  };
}

/**
 * Which figures the bib prints (§750): **the event's own win** — «Distanță» and «Diferență de nivel»
 * as the club typed them (§598, §585), the numbers its page and its emails say — and the GPX's
 * computed ones fill what the club left empty. A track recorded by a watch carries its own noise;
 * a figure the club typed is a figure it stands behind, and the bib must say what the page says.
 */
export function bibProfileFigures(
  profile: Pick<BibProfile, "distanceMeters" | "gainMeters">,
  own: { distanceMeters?: number | null; elevationGainMeters?: number | null },
): { distanceMeters: number; gainMeters: number } {
  return {
    distanceMeters: own.distanceMeters && own.distanceMeters > 0 ? own.distanceMeters : profile.distanceMeters,
    gainMeters: own.elevationGainMeters !== null && own.elevationGainMeters !== undefined && own.elevationGainMeters >= 0 ? own.elevationGainMeters : profile.gainMeters,
  };
}

/** What a renderer draws: the points, and the four lines of words, already in the sheet's language. */
export type BibProfileDrawing = {
  points: BibProfile["points"];
  /** «Start» and «Sosire», under the chart's two ends. */
  start: string;
  finish: string;
  /** «Distanță: 12,4 km» and «Diferență de nivel: +640 m». */
  distance: string;
  gain: string;
  /**
   * The route's checkpoints on the strip (§NNN, `bib-checkpoints.ts`): the marks and whether their
   * cut-offs fit, decided once by `bib-extras.ts` for both renderers. Absent or null: none drawn.
   */
  checkpoints?: BibCheckpointsDrawing | null;
};

/** The words a drawing is made of, from the caller's catalogue (`Admin.bibs.profile*`). */
export type BibProfileSay = (key: "start" | "finish" | "distance" | "gain", values?: { km?: string; m?: string }) => string;

export function bibProfileDrawing(
  profile: BibProfile,
  own: { distanceMeters?: number | null; elevationGainMeters?: number | null },
  locale: string,
  say: BibProfileSay,
): BibProfileDrawing {
  const figures = bibProfileFigures(profile, own);
  const km = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(figures.distanceMeters / 1000);
  const metres = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(figures.gainMeters);
  return {
    points: profile.points,
    start: say("start"),
    finish: say("finish"),
    distance: say("distance", { km }),
    gain: say("gain", { m: metres }),
  };
}

/** The line and the area under it as SVG path data, in a box `width` × `height` — what the picture draws and the test reads. */
export function bibProfilePaths(points: BibProfile["points"], width: number, height: number): { line: string; area: string } {
  const at = (point: readonly [number, number]) => `${(point[0] * width).toFixed(2)} ${((1 - point[1]) * height).toFixed(2)}`;
  const line = points.map((point, index) => `${index === 0 ? "M" : "L"}${at(point)}`).join(" ");
  const last = points[points.length - 1];
  const first = points[0];
  return { line, area: `${line} L${(last[0] * width).toFixed(2)} ${height} L${(first[0] * width).toFixed(2)} ${height} Z` };
}
