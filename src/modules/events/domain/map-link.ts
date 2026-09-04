/**
 * The link that opens the meeting point on a map.
 *
 * Two sources, in order:
 *
 *   1. `map_url`, when the club has pasted one. It wins, because it is the case coordinates
 *      cannot express — a named venue page, a route already drawn, a shared list.
 *   2. the event's coordinates, joined to `MAP_LINK_BASE_URL`.
 *
 * The second is why this file exists at all. A name is not a place: "Parcul Tractorul" is
 * forty hectares and the start is one corner of it, so a search link puts a runner in the right
 * park and the wrong end of it. Coordinates put them on the spot.
 *
 * The map host comes from configuration, never from a literal here: AGENTS.md §8 forbids a
 * hostname anywhere under `src/` and exempts no provider, so the club can point this at Google
 * Maps, OpenStreetMap or anything else by setting one variable, and changing it is a
 * deployment change rather than a code change. Unset, coordinates simply produce no link —
 * a missing map is a missing convenience, and a wrong one sends people to the wrong place.
 *
 * Pure, and takes the base URL as an argument rather than reading configuration itself, so the
 * formatting can be tested for every case without an environment.
 */

export type MapLinkInput = {
  mapUrl: string | null;
  /** Decimal degrees. `numeric` columns arrive from the driver as strings. */
  latitude: string | null;
  longitude: string | null;
};

/** Six decimals is about 10 cm — far past what a start line needs, and it keeps URLs short. */
function round(value: number): string {
  return String(Number(value.toFixed(6)));
}

export function mapLinkFor(event: MapLinkInput, baseUrl: string | undefined): string | null {
  if (event.mapUrl) return event.mapUrl;
  if (!baseUrl || event.latitude === null || event.longitude === null) return null;

  const latitude = Number(event.latitude);
  const longitude = Number(event.longitude);

  // The database constrains these, but this function is also handed rows from a preview and
  // from tests. A NaN would render "?q=NaN,NaN", which is a link to nowhere with no error.
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;

  // `?q=lat,lng` is the query every major map service understands, Google Maps and
  // OpenStreetMap included, so the base URL is the only thing that changes between them.
  const separator = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${separator}q=${round(latitude)},${round(longitude)}`;
}
