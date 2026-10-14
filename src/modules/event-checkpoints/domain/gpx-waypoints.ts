import { CHECKPOINT_KM_MAX, CHECKPOINT_NAME_MAX, type CheckpointKind } from "./checkpoint";

/**
 * The checkpoints a route's GPX already has (§757): the file's `<wpt>` waypoints — a drinking
 * water, an aid station, the timing mat, as the watch or the mapping tool named them — each with
 * the kilometre it stands at **along the track**, computed by projecting the waypoint on the track.
 *
 * Pure and importing nothing from the platform: no storage, no React. `checkpoints.ts` reads the
 * file from the site's store and hands its text here, the editor draws the answer as a preview the
 * club confirms, and nothing is added by this module. It is not a validating XML parse — like
 * `registrations/bib-profile.ts`, which reads the same file's `<trkpt>` for the bib, it reads the
 * few elements it needs: `<wpt lat lon>` with its `<name>`, `<sym>`, `<type>`, and the track's
 * `<trkpt>` (else `<rtept>`) points. A waypoint's elevation is not needed and not read.
 */

/** A waypoint farther than this from the track is not on this route (a car park, another trail). */
export const MAX_OFF_TRACK_METERS = 300;

/** A track shorter than this has no kilometres worth giving a point (the bib's profile says the same, §750). */
const MIN_TRACK_METERS = 50;

const EARTH_RADIUS_M = 6_371_000;
const RAD = Math.PI / 180;

type LatLon = { lat: number; lon: number };

function haversine(a: LatLon, b: LatLon): number {
  const dLat = (b.lat - a.lat) * RAD;
  const dLon = (b.lon - a.lon) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The XML a name may carry, as text: CDATA unwrapped, the five entities and the numeric ones decoded. */
function decodeXml(text: string): string {
  const unwrapped = text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, inner: string) => inner);
  return unwrapped
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => safeCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => safeCodePoint(Number(decimal)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function safeCodePoint(code: number): string {
  return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
}

function attributeNumber(attributes: string, name: "lat" | "lon"): number | null {
  const found = new RegExp(`\\b${name}\\s*=\\s*["']\\s*(-?\\d+(?:\\.\\d+)?)\\s*["']`).exec(attributes)?.[1];
  return found === undefined ? null : Number(found);
}

function elementText(inner: string, element: string): string {
  const found = new RegExp(`<(?:\\w+:)?${element}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${element}\\s*>`).exec(inner)?.[1];
  return found === undefined ? "" : decodeXml(found).replace(/\s+/g, " ").trim();
}

/** The track's points, `<trkpt>` else `<rtept>`, with a latitude and a longitude each. */
function trackOf(text: string): LatLon[] {
  const read = (element: "trkpt" | "rtept"): LatLon[] => {
    const points: LatLon[] = [];
    const pattern = new RegExp(`<(?:\\w+:)?${element}\\b([^>]*?)(?:/>|>)`, "g");
    for (const match of text.matchAll(pattern)) {
      const lat = attributeNumber(match[1] ?? "", "lat");
      const lon = attributeNumber(match[1] ?? "", "lon");
      if (lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) points.push({ lat, lon });
    }
    return points;
  };
  const track = read("trkpt");
  return track.length >= 2 ? track : read("rtept");
}

/** A waypoint as the file gives it. */
type Waypoint = LatLon & { name: string; hint: string };

function waypointsOf(text: string): Waypoint[] {
  const found: Waypoint[] = [];
  const pattern = /<(?:\w+:)?wpt\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?wpt\s*>)/g;
  for (const match of text.matchAll(pattern)) {
    const lat = attributeNumber(match[1] ?? "", "lat");
    const lon = attributeNumber(match[1] ?? "", "lon");
    if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const inner = match[2] ?? "";
    const name = elementText(inner, "name");
    found.push({ lat, lon, name, hint: `${name} ${elementText(inner, "sym")} ${elementText(inner, "type")}` });
  }
  return found;
}

/** What a waypoint's words say it offers, from its name, symbol and type — a guess the club may change before adding. */
export function kindsFromWords(words: string): CheckpointKind[] {
  const text = words.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const kinds: CheckpointKind[] = [];
  // Whole words, or a stem with its ending (`cronometraj`, `ambulanta`), never a word that merely begins with a short one (`apare`).
  if (/\b(?:water|drink\w*|apa|aqua|fountain|fantana|cesma|izvor|spring)\b/.test(text)) kinds.push("WATER");
  if (/\b(?:food|mancare|restaurant\w*|alimenta\w*|snack\w*|gustare|gustari|cantina|buffet|aid station|ravito\w*|refreshment\w*)\b/.test(text)) kinds.push("FOOD");
  if (/\b(?:first aid|prim ajutor|medical\w*|medic\w*|ambulan\w*|salvamont\w*|doctor)\b/.test(text)) kinds.push("FIRST_AID");
  if (/\b(?:timing|chrono\w*|cronometr\w*|checkpoint\w*|punct de control|control point|timer)\b/.test(text)) kinds.push("TIMING");
  // «Direcționare» (§769): a junction, a turn, a signpost or a marshal who shows the way — a watch's turn points and a mapping tool's «Crossing», «Turn», «Signpost» symbols.
  if (/\b(?:directi\w*|turn|turnaround|junction\w*|intersec\w*|bifurca\w*|fork|crossroad\w*|crossing|signpost\w*|waymark\w*|marshal\w*|ghid\w*|indicator\w*)\b/.test(text)) kinds.push("DIRECTION");
  return kinds;
}

/** One waypoint, placed on the track. */
export type GpxProposal = {
  name: string;
  /** Kilometres along the track at the nearest point, two decimals. */
  km: number;
  kinds: CheckpointKind[];
  /** How far from the track the waypoint is, in metres. */
  offMeters: number;
  /** Farther than `MAX_OFF_TRACK_METERS`: not on this route, never offered for adding. */
  tooFar: boolean;
};

export type GpxWaypoints = {
  /** The track's length in metres, 0 when the file has no usable track. */
  trackMeters: number;
  /** How many `<wpt>` the file has, whatever became of them. */
  waypointCount: number;
  /** Each waypoint that could be placed, in order along the track (a name, a distance). */
  proposals: GpxProposal[];
};

/**
 * The waypoints of a GPX document's text, each placed along its track (§757). A waypoint is
 * projected on the nearest stretch of the track (in a plane through the waypoint, accurate to
 * metres at this scale); its distance is that stretch's start plus the share of the stretch up to
 * the foot of the perpendicular. A route that comes back along itself puts a waypoint at the nearer
 * pass — the club corrects the distance in the list when it is the other one. A file without a
 * track, or with a track under `MIN_TRACK_METERS`, places nothing.
 */
export function parseGpxWaypoints(text: string): GpxWaypoints {
  const waypoints = waypointsOf(text);
  const track = trackOf(text);
  const along = [0];
  for (let i = 1; i < track.length; i++) along.push(along[i - 1] + haversine(track[i - 1], track[i]));
  const trackMeters = track.length >= 2 ? along[along.length - 1] : 0;
  if (!(trackMeters >= MIN_TRACK_METERS)) return { trackMeters: 0, waypointCount: waypoints.length, proposals: [] };

  const proposals: GpxProposal[] = [];
  for (const waypoint of waypoints) {
    const cosLat = Math.cos(waypoint.lat * RAD);
    const toPlane = (p: LatLon) => ({ x: (p.lon - waypoint.lon) * RAD * cosLat * EARTH_RADIUS_M, y: (p.lat - waypoint.lat) * RAD * EARTH_RADIUS_M });
    let best = { distance: Number.POSITIVE_INFINITY, meters: 0 };
    let from = toPlane(track[0]);
    for (let i = 1; i < track.length; i++) {
      const to = toPlane(track[i]);
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const length2 = dx * dx + dy * dy;
      // The share of the stretch under the foot of the perpendicular from the origin (the waypoint).
      const share = length2 === 0 ? 0 : Math.min(1, Math.max(0, -(from.x * dx + from.y * dy) / length2));
      const distance = Math.hypot(from.x + share * dx, from.y + share * dy);
      if (distance < best.distance) best = { distance, meters: along[i - 1] + share * (along[i] - along[i - 1]) };
      from = to;
    }
    const km = Math.round(best.meters / 10) / 100;
    const name = waypoint.name.slice(0, CHECKPOINT_NAME_MAX).trim();
    // A point with no name cannot be a checkpoint, which needs one in both languages: it is left out.
    if (km > CHECKPOINT_KM_MAX || name === "") continue;
    proposals.push({
      name,
      km,
      kinds: kindsFromWords(waypoint.hint),
      offMeters: Math.round(best.distance),
      tooFar: best.distance > MAX_OFF_TRACK_METERS,
    });
  }
  // In the order a runner meets them; a tie keeps the file's.
  return { trackMeters, waypointCount: waypoints.length, proposals: proposals.map((p, at) => ({ p, at })).sort((a, b) => a.p.km - b.p.km || a.at - b.at).map(({ p }) => p) };
}

/**
 * How far past the route's end a waypoint may sit and still be the finish (§757): a watch's track
 * often runs a few tens of metres longer than the distance the club typed (21.13 km against 21 097 m),
 * and the «Sosire» waypoint at its end must not refuse the whole «Adaugă punctele alese».
 */
export const PAST_FINISH_TOLERANCE_KM = 0.3;

/** What the preview offers of a file's proposals, measured against the route's length. */
export type OfferedProposals = {
  /** On the track and within the route, in order along it — the indexes the form's `pick` boxes post. */
  offered: GpxProposal[];
  /** Farther than `MAX_OFF_TRACK_METERS` from the track. */
  tooFar: number;
  /** Past the route's end by more than `PAST_FINISH_TOLERANCE_KM`. */
  beyondRoute: number;
};

/**
 * The proposals the editor may offer for adding, given the route's length in kilometres (the typed
 * distance, else the GPX's; null while neither is known): a waypoint off the track is left out, one
 * just past the route's end is placed at its end (the finish, as the rules round the length up to the
 * hundredth), one farther past it is left out — each counted, so the preview says why. One function
 * for the page and the service, so the indexes a form posts mean the same row in both.
 */
export function offerableProposals(proposals: readonly GpxProposal[], routeKm: number | null): OfferedProposals {
  const end = routeKm === null ? null : Math.ceil(routeKm * 100) / 100;
  const offered: GpxProposal[] = [];
  let tooFar = 0;
  let beyondRoute = 0;
  for (const proposal of proposals) {
    if (proposal.tooFar) tooFar += 1;
    else if (end === null || proposal.km <= end) offered.push(proposal);
    else if (proposal.km <= end + PAST_FINISH_TOLERANCE_KM + 1e-9) offered.push({ ...proposal, km: end });
    else beyondRoute += 1;
  }
  return { offered, tooFar, beyondRoute };
}
