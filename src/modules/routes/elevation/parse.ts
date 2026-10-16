/**
 * The route's elevation profile, read from a GPX document's text (§NNN, amending §718 and §757; the owner,
 * 2026-10-16: «I would like to have a widget actually! And read it from the GPX»): the distance along the
 * track and the altitude at that distance — the one series the event page's chart, the editor's preview and
 * the race number's strip all draw.
 *
 * **Pure, importing nothing**: no `node:` builtin, no storage, no React, and nothing from `registrations/`
 * or `content/` — so a Server Component, a client island, a PDF writer and a test all read it the same way.
 * The reader of the file from the store is `public-cache/reads.ts#cachedRouteElevation`; the picture's
 * geometry is `geometry.ts`.
 *
 * It is not a validating XML parse: it reads the `<trkpt lat lon>` (else `<rtept>`) elements that carry an
 * `<ele>`, which is all a profile is made of. A file with fewer than two of them, or a track shorter than
 * `MIN_TRACK_METERS`, has no profile (null) — and a chart is then simply not drawn.
 *
 * The race number's strip reads through this parser too (`registrations/bib-extras.ts` by `read.ts`); its own
 * reader is gone.
 */

/** A track shorter than this has no profile worth drawing. */
export const MIN_TRACK_METERS = 50;

/** The most points a profile holds: a smooth line over any screen, never the file's tens of thousands. */
export const ELEVATION_MAX_POINTS = 400;
/** The fewest a profile holds, so a track of a handful of fixes still resamples to a line that follows them. */
const MIN_POINTS = 64;
/** The finer series the gain is summed over, so the figure does not depend on how many points are drawn. */
const GAIN_SAMPLES = 200;

/**
 * One profile: `[metres from the start, altitude in metres]` pairs, evenly spaced by distance, the first at 0 and the
 * last at `distanceMeters`; the lowest and highest altitude of the drawn line; the climb along the track. Plain
 * numbers only, so the public cache keeps it as JSON and a client island takes it as props.
 */
export type ElevationProfileData = {
  points: ReadonlyArray<readonly [number, number]>;
  distanceMeters: number;
  minAltitude: number;
  maxAltitude: number;
  gainMeters: number;
};

const EARTH_RADIUS_M = 6_371_000;

function haversine(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** An xsd:decimal as a GPX writes it: an optional sign, then digits with an optional fraction — «600», «-3.5», «+600», «.5», «600.». */
const DECIMAL = "[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)";
// Built once: a track has tens of thousands of points, and none of these keeps state between calls (no `g` flag).
const LAT = new RegExp(`\\blat\\s*=\\s*["']\\s*(${DECIMAL})\\s*["']`);
const LON = new RegExp(`\\blon\\s*=\\s*["']\\s*(${DECIMAL})\\s*["']`);
const ELE = new RegExp(`<(?:\\w+:)?ele>\\s*(${DECIMAL})\\s*</(?:\\w+:)?ele>`);

type TrackPoint ={ lat: number; lon: number; ele: number };

function pointsOf(text: string, element: "trkpt" | "rtept"): TrackPoint[] {
  const found: TrackPoint[] = [];
  const pattern = new RegExp(`<(?:\\w+:)?${element}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</(?:\\w+:)?${element}\\s*>)`, "g");
  for (const match of text.matchAll(pattern)) {
    const attributes = match[1] ?? "";
    const lat = LAT.exec(attributes)?.[1];
    const lon = LON.exec(attributes)?.[1];
    const ele = ELE.exec(match[2] ?? "")?.[1];
    if (lat === undefined || lon === undefined || ele === undefined) continue;
    const point = { lat: Number(lat), lon: Number(lon), ele: Number(ele) };
    if (Math.abs(point.lat) <= 90 && Math.abs(point.lon) <= 180 && Number.isFinite(point.ele)) found.push(point);
  }
  return found;
}

/** A three-point mean takes the GPS's jitter out of the climb without flattening a hill. */
const smooth = (series: readonly number[]): number[] =>
  series.map((_, i) => (series[Math.max(0, i - 1)] + series[i] + series[Math.min(series.length - 1, i + 1)]) / 3);

/** The profile of a GPX document's text, or null when it has none (no altitudes, fewer than two points, too short a track). */
export function parseGpxElevation(text: string): ElevationProfileData | null {
  let track = pointsOf(text, "trkpt");
  if (track.length < 2) track = pointsOf(text, "rtept");
  if (track.length < 2) return null;
  const along = [0];
  for (let i = 1; i < track.length; i++) along.push(along[i - 1] + haversine(track[i - 1], track[i]));
  const total = along[along.length - 1];
  if (!(total >= MIN_TRACK_METERS)) return null;

  // The altitude at an even step of distance, by linear interpolation between the track's points.
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

  const fine = smooth(resample(GAIN_SAMPLES));
  let gain = 0;
  for (let i = 1; i < fine.length; i++) gain += Math.max(0, fine[i] - fine[i - 1]);

  const count = Math.min(ELEVATION_MAX_POINTS, Math.max(MIN_POINTS, track.length));
  const drawn = smooth(resample(count));
  const round1 = (value: number) => Math.round(value * 10) / 10;
  const points = drawn.map((altitude, i) => [round1((total * i) / (count - 1)), round1(altitude)] as const);
  return {
    points,
    distanceMeters: Math.round(total),
    minAltitude: round1(Math.min(...drawn)),
    maxAltitude: round1(Math.max(...drawn)),
    gainMeters: Math.round(gain),
  };
}
