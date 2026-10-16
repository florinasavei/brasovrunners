/**
 * A GPX for the elevation profile's tests and its e2e (§NNN): a track east along one parallel — so its length is the
 * longitude's span and nothing else — whose altitude climbs from `low` to a summit at the middle and comes down to a
 * second, lower rise, never flat and never jagged: the shape the owner's screenshot had (608 to 828 m over about 9 km).
 */
export type ElevationGpxOptions = {
  /** The track's length in kilometres, about: the longitude's span at this latitude. */
  km?: number;
  /** The lowest altitude, at the start, and the summit's, in metres. */
  low?: number;
  high?: number;
  /** How many `<trkpt>` the file has. */
  points?: number;
  /** `trkpt` (the default) or `rtept`, for a route file. */
  element?: "trkpt" | "rtept";
  /** Leave the `<ele>` out of every point: a file with no profile. */
  withoutElevation?: boolean;
};

const LATITUDE = 45.6;
/** Kilometres in one degree of longitude at that latitude on a sphere of the radius the parser uses. */
const KM_PER_DEGREE = (Math.PI / 180) * 6371 * Math.cos((LATITUDE * Math.PI) / 180);

/** The altitude at `share` (0 to 1) of the track. */
export function sampleAltitude(share: number, low = 608, high = 828): number {
  const hill = Math.sin(Math.PI * share) ** 1.3;
  const rise = 0.18 * Math.sin(3 * Math.PI * share) ** 2;
  return low + (high - low) * Math.min(1, 0.82 * hill + rise);
}

export function elevationGpx(options: ElevationGpxOptions = {}): string {
  const { km = 9, low = 608, high = 828, points = 181, element = "trkpt", withoutElevation = false } = options;
  const span = km / KM_PER_DEGREE;
  const body = Array.from({ length: points }, (_, i) => {
    const share = i / (points - 1);
    const lon = (25.5 + span * share).toFixed(6);
    const ele = withoutElevation ? "" : `<ele>${sampleAltitude(share, low, high).toFixed(1)}</ele>`;
    return `<${element} lat="${LATITUDE}" lon="${lon}">${ele}</${element}>`;
  }).join("");
  const wrap = element === "trkpt" ? `<trk><name>Traseu</name><trkseg>${body}</trkseg></trk>` : `<rte><name>Traseu</name>${body}</rte>`;
  return `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">${wrap}</gpx>`;
}
