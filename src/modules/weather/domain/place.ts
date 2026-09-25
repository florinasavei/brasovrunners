import type { Coordinates } from "@/modules/events/domain/sun";

/**
 * Where an event's forecast is asked for (§NNN, amending §402; the owner, 2026-09-25: "la vreme
 * aș vrea să văd exact pe locația selectată, să văd mai multe date").
 *
 * **In this order, the first that says a place:**
 * 1. **the map link** the organizer pasted (`events.map_url`) — when it carries the pin's own
 *    coordinates in its address, as a full map link does. It is the place the page sends the
 *    runner to, so the forecast is for the very pin they open, and the two cannot disagree;
 * 2. **«Coordonate»**, the pair typed in the editor's Locul box (`events.latitude`,
 *    `events.longitude`) — for a link that carries none: a short share link, a venue's own page,
 *    or no link at all;
 * 3. **the club's place**, `CLUB_COORDINATES` (§394) — as before, for every event that says
 *    neither, and for a place still to be announced (§328), whose link and pair no public reader
 *    is handed.
 *
 * A short link (`maps.app.goo.gl/…`) is **never followed**: resolving it is a request to the map
 * provider on every save or render, for a redirect it may change or refuse — the typed pair is the
 * organizer's one-move answer instead, and the editor says which place the forecast reads.
 *
 * Pure: no request, no configuration read — the club's place is an argument, so the editor, the
 * page, the reminder and a test read one rule.
 */

/** Which of the three the forecast was asked for: the page says "the event's place" for the first two. */
export type ForecastPlaceSource = "map" | "typed" | "club";

export type ForecastPlace = { coordinates: Coordinates; source: ForecastPlaceSource };

/** What an event carries about its place, as any reader has it: a public row, the editor's row, an email's. */
export type PlaceColumns = {
  mapUrl?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  locationToBeAnnounced?: boolean | null;
};

/** "45.64,25.59", "45.64, 25.59", "45.64 25.59" (a `+` decoded as a space): two numbers in range, or null. */
function pair(text: string | null | undefined): Coordinates | null {
  if (!text) return null;
  const match = /^\s*(?:loc:)?\s*(-?\d{1,3}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(text);
  if (!match) return null;
  return inRange(Number(match[1]), Number(match[2]));
}

function inRange(latitude: number, longitude: number): Coordinates | null {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

/** The query parameters a map link names a point with: Google's `q`/`query`/`ll`/`destination`, Apple's `ll`/`q`/`sll`, Waze's `ll`. */
const POINT_PARAMETERS = ["query", "q", "ll", "destination", "daddr", "center", "sll"] as const;

/**
 * The coordinates a map link carries in its own address, or null — never a request.
 *
 * Read, most precise first:
 * - Google's pin, `!3d<lat>!4d<lng>` in a place link's `data=` — the dropped pin itself;
 * - OpenStreetMap's marker, `mlat` and `mlon`;
 * - a point named in the query: `?q=45.64,25.59`, `?query=…`, `?ll=…`, `?destination=…`;
 * - a path segment that is a pair: `/maps/search/45.64,25.59`, `/maps/dir//45.64,25.59`;
 * - OpenStreetMap's view, `#map=17/45.64/25.59`;
 * - Google's view, `@45.64,25.59,17z` — where the map was centred, which for a shared place link
 *   is the place.
 * A link with none of these (a short link, a venue's page) reads as null.
 */
export function coordinatesInMapLink(url: string | null | undefined): Coordinates | null {
  if (!url || !url.trim()) return null;
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  let whole: string;
  try {
    whole = decodeURIComponent(parsed.href);
  } catch {
    whole = parsed.href;
  }

  const pin = /!3d(-?\d{1,3}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/.exec(whole);
  if (pin) {
    const found = inRange(Number(pin[1]), Number(pin[2]));
    if (found) return found;
  }

  const mlat = parsed.searchParams.get("mlat");
  const mlon = parsed.searchParams.get("mlon");
  if (mlat && mlon) {
    const found = inRange(Number(mlat), Number(mlon));
    if (found) return found;
  }

  for (const name of POINT_PARAMETERS) {
    const found = pair(parsed.searchParams.get(name));
    if (found) return found;
  }

  for (const segment of parsed.pathname.split("/")) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment).replace(/\+/g, " ");
    } catch {
      continue;
    }
    const found = pair(decoded);
    if (found) return found;
  }

  const view = /(?:^|[#&])map=\d+(?:\.\d+)?\/(-?\d{1,3}(?:\.\d+)?)\/(-?\d{1,3}(?:\.\d+)?)/.exec(parsed.hash);
  if (view) {
    const found = inRange(Number(view[1]), Number(view[2]));
    if (found) return found;
  }

  const at = /@(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)(?:,|$)/.exec(parsed.pathname);
  if (at) {
    const found = inRange(Number(at[1]), Number(at[2]));
    if (found) return found;
  }
  return null;
}

/** The typed «Coordonate», when both halves are there and in range. */
export function typedCoordinates(event: Pick<PlaceColumns, "latitude" | "longitude">): Coordinates | null {
  if (event.latitude === null || event.latitude === undefined || event.longitude === null || event.longitude === undefined) return null;
  // `Number`: a `double precision` read through a raw `CASE` expression may arrive as text.
  return inRange(Number(event.latitude), Number(event.longitude));
}

/** The header's order: the map link's pin, the typed pair, the club — the club alone while the place is to be announced. */
export function forecastPlace(event: PlaceColumns, club: Coordinates): ForecastPlace {
  if (!event.locationToBeAnnounced) {
    const fromLink = coordinatesInMapLink(event.mapUrl);
    if (fromLink) return { coordinates: fromLink, source: "map" };
    const typed = typedCoordinates(event);
    if (typed) return { coordinates: typed, source: "typed" };
  }
  return { coordinates: club, source: "club" };
}

/**
 * How finely a place is told apart for the forecast: two decimals, about 1.1 km north–south and
 * 0.8 km east–west in Brașov — finer than Open-Meteo's own grid (a few kilometres), so two pins
 * in one park share one cached answer and one request an hour, and a pin across town gets its own.
 */
export const PLACE_DECIMALS = 2;

export function roundPlace(place: Coordinates): Coordinates {
  const factor = 10 ** PLACE_DECIMALS;
  // `+ 0` turns a rounded -0 into 0, so one place has one key.
  return {
    latitude: Math.round(place.latitude * factor) / factor + 0,
    longitude: Math.round(place.longitude * factor) / factor + 0,
  };
}

/** "45.6427, 25.5887" — how the editor's box shows a stored pair, and what it accepts back. */
export function coordinatesText(place: Coordinates): string {
  return `${place.latitude}, ${place.longitude}`;
}

/**
 * The editor's box, read: "" is none, two numbers in range are a pair, anything else is refused
 * (`undefined`). What a map's "copy coordinates" gives — "45.6427, 25.5887" — is the form the help
 * text shows; a Romanian keyboard's decimal comma is read too where the pair is split some other
 * way: "45,6427; 25,5887", "45,6427 25,5887", "45,6427, 25,5887".
 */
export function parseTypedCoordinates(text: string): Coordinates | null | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const halves = trimmed.includes(";")
    ? trimmed.split(/\s*;\s*/)
    : trimmed.split(/,\s+/).length === 2
      ? trimmed.split(/,\s+/)
      : (trimmed.match(/,/g) ?? []).length === 1
        ? trimmed.split(/\s*,\s*/)
        : trimmed.split(/\s+/);
  if (halves.length !== 2) return undefined;
  const NUMBER = /^-?\d{1,3}(?:[.,]\d+)?$/;
  if (!halves.every((half) => NUMBER.test(half))) return undefined;
  const [latitude, longitude] = halves.map((half) => Number(half.replace(",", ".")));
  return inRange(latitude, longitude) ?? undefined;
}
