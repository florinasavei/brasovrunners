/**
 * «Traseul»'s maps (§718; the owner, 2026-10-11: «so basically I need to put all: Garmin Connect
 * embedded, Strava embedded, Garmin Connect link, Strava link AND GPX file»).
 *
 * The club pastes what the service gave it — the route's link, or the embed code from the
 * service's share menu — and this module reads out of it the route's id and, for Strava, the
 * three values its embed carries (`data-style`, `data-map-hash`, `data-token`), each against a
 * strict pattern. The pasted text itself is never stored and never rendered: the page builds the
 * link and the map's address from these values alone, so a pasted string cannot smuggle a
 * parameter, an attribute or a script onto the page. Anything the parser does not recognise is
 * refused, naming the field.
 *
 * No provider script ever (§61: «Strava is a mark and never a script»): Strava's embed code
 * carries `<script src=…/embed.js>`, which builds an `<iframe>`; the page builds the same
 * `<iframe>` address on the server instead (`stravaEmbedSrc`) and loads it only when the visitor
 * presses (§69's facade). Hostnames of third parties are fine under `src/` (AGENTS.md §8 forbids
 * the club's own); each is in `PROVIDER_HOSTS` in `scripts/docs-check.mjs`.
 */

export const ROUTE_MAP_PROVIDERS = ["strava", "garmin"] as const;
export type RouteMapProvider = (typeof ROUTE_MAP_PROVIDERS)[number];

/** A stored map: the provider, the route's id, and for Strava the embed's own three values. */
export type RouteMap =
  | { provider: "garmin"; id: string }
  | { provider: "strava"; id: string; style?: string; mapHash?: string; token?: string; options?: Record<string, string> };

export type StravaRouteMap = Extract<RouteMap, { provider: "strava" }>;

/** A route's or a course's id: digits only, as both services number them. */
const ROUTE_ID = /^[0-9]{1,20}$/;
/** Strava's map styles are words: `standard`, `hybrid`, `satellite`. */
const STRAVA_STYLE = /^[a-z]{1,16}$/;
/** The map style a Strava route opens in when the pasted code names none (§738). */
export const STRAVA_MAP_STYLE = "hybrid";
/** `<zoom>/<lat>/<lon>`, each a decimal number — where the map opens — then, for a 3D map, its bearing and pitch. */
const STRAVA_MAP_HASH = /^[0-9]{1,2}(?:\.[0-9]{1,4})?\/-?[0-9]{1,3}(?:\.[0-9]{1,10})?\/-?[0-9]{1,3}(?:\.[0-9]{1,10})?(?:\/-?[0-9]{1,3}(?:\.[0-9]{1,4})?){0,2}$/;
/**
 * The builder's other display choices (§738) — `data-units`, `data-terrain`, `data-surface-type`, the
 * elevation profile, and whatever Strava adds next — kept as the iframe's query under the name
 * `embed.js` gives them (`data-surface-type` → `surfaceType`): a `data-*` name, a short word as the value.
 */
const STRAVA_OPTION_NAME = /^data-[a-z][a-z0-9]*(?:-[a-z0-9]+){0,3}$/;
const STRAVA_OPTION_KEY = /^[a-z][a-zA-Z0-9]{0,31}$/;
const STRAVA_OPTION_VALUE = /^[A-Za-z0-9._-]{1,32}$/;
const MAX_STRAVA_OPTIONS = 8;
/** The query names the page sets itself, never taken from an option. */
const STRAVA_RESERVED_KEYS = new Set(["style", "fromEmbed", "token", "embedType", "embedId", "mapHash"]);
/** The embed's share token: letters and digits, never longer than a long hash. */
const STRAVA_TOKEN = /^[A-Za-z0-9]{1,64}$/;
/** The longest paste either field accepts: the embed code is a few hundred characters. */
export const MAX_ROUTE_MAP_INPUT = 2000;

const STRAVA_HOSTS = new Set(["strava.com", "www.strava.com"]);
const GARMIN_HOSTS = new Set(["connect.garmin.com"]);
const STRAVA_EMBED_SCRIPT = "https://strava-embeds.com/embed.js";

/** Why a paste was refused — the field's message names it (`fields.ts`). */
export type RouteMapRefusal = "notRecognised" | "tooLong";
export type ParsedRouteMap<M> = { ok: true; map: M | null } | { ok: false; reason: RouteMapRefusal };

/**
 * The attributes of one start tag, `name="value"`, `name='value'`, `name=value` or `name`, or null when the
 * text between the tag name and `>` is anything else. Names are lower-cased; a name given twice is
 * refused (which one would the browser have kept?).
 */
function readAttributes(text: string): Map<string, string> | null {
  const attributes = new Map<string, string>();
  // A bare name (`allowfullscreen`) is an attribute with the empty value.
  const pattern = /\s+([a-z][a-z0-9-]*)(?:\s*=\s*(?:"([^"<>]*)"|'([^'<>]*)'|([^\s"'<>=`]+)))?/giy;
  let at = 0;
  while (at < text.length) {
    if (/^\s*\/?\s*$/.test(text.slice(at))) break;
    pattern.lastIndex = at;
    const match = pattern.exec(text);
    if (!match) return null;
    const name = match[1].toLowerCase();
    if (attributes.has(name)) return null;
    attributes.set(name, match[2] ?? match[3] ?? match[4] ?? "");
    at = pattern.lastIndex;
  }
  return attributes;
}

function httpsUrl(text: string): URL | null {
  if (/\s/.test(text)) return null;
  try {
    const url = new URL(text);
    return url.protocol === "https:" && url.username === "" && url.password === "" && url.port === "" ? url : null;
  } catch {
    return null;
  }
}

/** The id after `/routes/` on strava.com, whatever follows it (a query, a fragment). */
function stravaRouteIdFromUrl(text: string): string | null {
  const url = httpsUrl(text);
  if (!url || !STRAVA_HOSTS.has(url.hostname.toLowerCase())) return null;
  const match = /^\/routes\/([0-9]{1,20})\/?$/.exec(url.pathname);
  return match ? match[1] : null;
}

/**
 * Strava's embed code, exactly the shape its share menu gives: one `<div class="strava-embed-placeholder">`
 * with the `data-*` attributes below, then — optionally — its `<script>` tag naming Strava's own
 * `embed.js`. Any other attribute, any other script, any other element: refused.
 */
const STRAVA_PLACEHOLDER_ATTRIBUTES = new Set([
  "class",
  "data-embed-type",
  "data-embed-id",
  "data-style",
  "data-map-hash",
  "data-from-embed",
  "data-token",
]);

/** `data-surface-type` → `surfaceType`, as the browser's `dataset` names it. */
function stravaOptionKey(name: string): string {
  return name.slice(5).replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/** `surfaceType` → `data-surface-type`, for the editor's rebuilt embed code. */
function stravaOptionName(key: string): string {
  return `data-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

function stravaFromEmbed(text: string): StravaRouteMap | null {
  const match = /^<div(\s[^<>]*)?>\s*<\/div>\s*(?:<script(\s[^<>]*)?>\s*<\/script>)?$/i.exec(text);
  if (!match) return null;
  const attributes = readAttributes(match[1] ?? "");
  if (!attributes) return null;
  const options: Record<string, string> = {};
  for (const [name, value] of attributes) {
    if (STRAVA_PLACEHOLDER_ATTRIBUTES.has(name)) continue;
    if (!STRAVA_OPTION_NAME.test(name)) return null;
    const key = stravaOptionKey(name);
    if (STRAVA_RESERVED_KEYS.has(key) || !STRAVA_OPTION_VALUE.test(value)) return null;
    options[key] = value;
  }
  if (Object.keys(options).length > MAX_STRAVA_OPTIONS) return null;
  if (attributes.get("class") !== "strava-embed-placeholder") return null;
  if (attributes.get("data-embed-type") !== "route") return null;
  const id = attributes.get("data-embed-id") ?? "";
  if (!ROUTE_ID.test(id)) return null;
  const fromEmbed = attributes.get("data-from-embed");
  if (fromEmbed !== undefined && fromEmbed !== "true" && fromEmbed !== "false") return null;
  if (match[2] !== undefined) {
    const script = readAttributes(match[2]);
    if (!script || script.size !== 1 || script.get("src") !== STRAVA_EMBED_SCRIPT) return null;
  }
  const map: StravaRouteMap = { provider: "strava", id };
  const style = attributes.get("data-style");
  if (style !== undefined && style !== "") {
    if (!STRAVA_STYLE.test(style)) return null;
    map.style = style;
  }
  const mapHash = attributes.get("data-map-hash");
  if (mapHash !== undefined && mapHash !== "") {
    if (!STRAVA_MAP_HASH.test(mapHash)) return null;
    map.mapHash = mapHash;
  }
  const token = attributes.get("data-token");
  if (token !== undefined && token !== "") {
    if (!STRAVA_TOKEN.test(token)) return null;
    map.token = token;
  }
  if (Object.keys(options).length > 0) map.options = options;
  return map;
}

/**
 * What the club pasted in the Strava field: the route's link (`https://www.strava.com/routes/<id>`)
 * or the embed code Strava's share menu gives. Empty is "no Strava map" (`map: null`).
 */
export function parseStravaRoute(input: string | null | undefined): ParsedRouteMap<StravaRouteMap> {
  const text = (input ?? "").trim();
  if (text === "") return { ok: true, map: null };
  if (text.length > MAX_ROUTE_MAP_INPUT) return { ok: false, reason: "tooLong" };
  if (text.startsWith("<")) {
    const map = stravaFromEmbed(text);
    return map ? { ok: true, map } : { ok: false, reason: "notRecognised" };
  }
  const id = stravaRouteIdFromUrl(text);
  return id ? { ok: true, map: { provider: "strava", id } } : { ok: false, reason: "notRecognised" };
}

/** The id after `/modern/course/`, `/app/course/` or `/embed/course/` on connect.garmin.com. */
function garminCourseIdFromUrl(text: string): string | null {
  const url = httpsUrl(text);
  if (!url || !GARMIN_HOSTS.has(url.hostname.toLowerCase())) return null;
  const match = /^\/(?:modern|app|embed)\/course\/([0-9]{1,20})\/?$/.exec(url.pathname);
  return match ? match[1] : null;
}

const GARMIN_IFRAME_ATTRIBUTES = new Set(["src", "width", "height", "title", "frameborder", "allowfullscreen", "loading",
  "style",
  "scrolling",
  "allow",
  "referrerpolicy",
  "allowtransparency",
]);

/**
 * Garmin Connect's embed code: one `<iframe>` whose `src` is the course's embed address, with the
 * size, title and presentation attributes Garmin writes beside it (the title and the rest are never
 * kept; the iframe we draw is our own). An `on*` handler, a `srcdoc`, a `sandbox` or any other
 * attribute — or anything around the iframe: refused.
 */
function garminFromEmbed(text: string): string | null {
  const match = /^<iframe(\s[^<>]*)?>\s*(?:<\/iframe>)?$/i.exec(text);
  if (!match) return null;
  const attributes = readAttributes(match[1] ?? "");
  if (!attributes) return null;
  for (const name of attributes.keys()) if (!GARMIN_IFRAME_ATTRIBUTES.has(name)) return null;
  for (const size of ["width", "height", "frameborder"]) {
    const value = attributes.get(size);
    if (value !== undefined && !/^[0-9]{1,4}(?:px|%)?$/.test(value)) return null;
  }
  const loading = attributes.get("loading");
  if (loading !== undefined && loading !== "lazy" && loading !== "eager") return null;
  const src = attributes.get("src");
  if (!src) return null;
  const url = httpsUrl(src);
  if (!url || url.search !== "" || url.hash !== "") return null;
  if (!/^\/embed\/course\/[0-9]{1,20}$/.test(url.pathname)) return null;
  return garminCourseIdFromUrl(src);
}

/**
 * What the club pasted in the Garmin Connect field: the course's link (`…/modern/course/<id>` or
 * `…/app/course/<id>`), its embed address, or the `<iframe>` Garmin's share menu gives. Empty is
 * "no Garmin map".
 */
export function parseGarminCourse(input: string | null | undefined): ParsedRouteMap<Extract<RouteMap, { provider: "garmin" }>> {
  const text = (input ?? "").trim();
  if (text === "") return { ok: true, map: null };
  if (text.length > MAX_ROUTE_MAP_INPUT) return { ok: false, reason: "tooLong" };
  const id = text.startsWith("<") ? garminFromEmbed(text) : garminCourseIdFromUrl(text);
  return id ? { ok: true, map: { provider: "garmin", id } } : { ok: false, reason: "notRecognised" };
}

/** A stored map's display choices, each against its pattern; one off its pattern is dropped alone. */
function readStravaOptions(stored: unknown): Record<string, string> | null {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return null;
  const kept: Record<string, string> = {};
  for (const [key, value] of Object.entries(stored).slice(0, MAX_STRAVA_OPTIONS)) {
    if (!STRAVA_OPTION_KEY.test(key) || STRAVA_RESERVED_KEYS.has(key)) continue;
    if (typeof value === "string" && STRAVA_OPTION_VALUE.test(value)) kept[key] = value;
  }
  return Object.keys(kept).length > 0 ? kept : null;
}

/**
 * The stored column as maps, Strava first (the owner, 2026-10-12: «Strava tab should show before Garmin Connect tab», §738).
 * Anything that is not a map this release can draw — another provider, an id with a letter, a
 * value off its pattern — is dropped rather than rendered; a value off its pattern on an otherwise
 * good Strava map is dropped alone. At most one per provider; null and anything not an array is "none".
 */
export function readRouteMaps(stored: unknown): RouteMap[] {
  if (!Array.isArray(stored)) return [];
  const found = new Map<RouteMapProvider, RouteMap>();
  for (const entry of stored) {
    if (!entry || typeof entry !== "object") continue;
    const { provider, id, style, mapHash, token, options } = entry as Record<string, unknown>;
    if (typeof id !== "string" || !ROUTE_ID.test(id)) continue;
    if (provider === "garmin" && !found.has("garmin")) {
      found.set("garmin", { provider: "garmin", id });
    } else if (provider === "strava" && !found.has("strava")) {
      const map: StravaRouteMap = { provider: "strava", id };
      if (typeof style === "string" && STRAVA_STYLE.test(style)) map.style = style;
      if (typeof mapHash === "string" && STRAVA_MAP_HASH.test(mapHash)) map.mapHash = mapHash;
      if (typeof token === "string" && STRAVA_TOKEN.test(token)) map.token = token;
      const kept = readStravaOptions(options);
      if (kept) map.options = kept;
      found.set("strava", map);
    }
  }
  return ROUTE_MAP_PROVIDERS.flatMap((provider) => {
    const map = found.get(provider);
    return map ? [map] : [];
  });
}

/** What the save stores for the two fields: the maps in the owner's order, or null for none. */
export function routeMapsToStore(maps: readonly (RouteMap | null)[]): RouteMap[] | null {
  const kept = readRouteMaps(maps.filter((map): map is RouteMap => map !== null));
  return kept.length > 0 ? kept : null;
}

/** The route's page on the service, built from the id alone — «Deschide în Strava / Garmin Connect». */
export function routeMapLink(map: RouteMap): string {
  return map.provider === "strava" ? `https://www.strava.com/routes/${map.id}` : `https://connect.garmin.com/modern/course/${map.id}`;
}

/**
 * The namespace of one Strava frame's height messages (§NNN): `embed.js` uses a random UUID, which a
 * server-rendered page cannot (it would differ between server and browser); this is the frame's own
 * name, from the route's id alone — never a user's data — and the origin is what is trusted.
 */
export function stravaFrameNamespace(map: StravaRouteMap): string {
  return `route-map-strava-${map.id}`;
}

/** Garmin Connect's embed address for a course: the id, nothing the club typed. */
export function garminEmbedSrc(id: string): string {
  return `https://connect.garmin.com/embed/course/${id}`;
}

/**
 * The address Strava's `embed.js` would have given its iframe (read from the script on 2026-10-11),
 * built here so the script never runs on our page: `/<type>/<id>`, the placeholder's other `data-*`
 * values as the query (`style`, `fromEmbed`, `token`, and the builder's display choices: units, 3D terrain,
 * surface, elevation profile — §738), and in the fragment — never sent to Strava's
 * server — a namespace for its height messages, this site's origin, and where the map opens. The
 * page's own path and title, which the script also passes, are left out: Strava has no need of them.
 */
export function stravaEmbedSrc(map: StravaRouteMap, origin: string): string {
  const namespace = stravaFrameNamespace(map);
  const query = new URLSearchParams();
  query.set("style", map.style ?? STRAVA_MAP_STYLE);
  for (const [key, value] of Object.entries(map.options ?? {})) query.set(key, value);
  query.set("fromEmbed", "false");
  if (map.token) query.set("token", map.token);
  const fragment = new URLSearchParams({ ns: namespace, hostOrigin: origin });
  return `https://strava-embeds.com/route/${map.id}?${query.toString()}#${fragment.toString()}${map.mapHash ? `&mapHash=${map.mapHash}` : ""}`;
}

/** The map's iframe address, by provider. */
export function routeMapEmbedSrc(map: RouteMap, origin: string): string {
  return map.provider === "strava" ? stravaEmbedSrc(map, origin) : garminEmbedSrc(map.id);
}

/**
 * What the editor's field shows for a stored map, which a save reads back to the same map: the
 * link when there is nothing but the id, and Strava's own embed code, rebuilt from the stored
 * values, when there is more — so saving the form again never drops the token or the map's view.
 */
export function routeMapFieldValue(map: RouteMap | undefined): string {
  if (!map) return "";
  if (map.provider === "garmin" || (!map.style && !map.mapHash && !map.token && !map.options)) return routeMapLink(map);
  const attributes = [
    `class="strava-embed-placeholder"`,
    `data-embed-type="route"`,
    `data-embed-id="${map.id}"`,
    ...(map.style ? [`data-style="${map.style}"`] : []),
    ...(map.mapHash ? [`data-map-hash="${map.mapHash}"`] : []),
    ...Object.entries(map.options ?? {}).map(([key, value]) => `${stravaOptionName(key)}="${value}"`),
    `data-from-embed="false"`,
    ...(map.token ? [`data-token="${map.token}"`] : []),
  ];
  return `<div ${attributes.join(" ")}></div>`;
}

/** The stored map of one provider, if any. */
export function routeMapOf<P extends RouteMapProvider>(stored: unknown, provider: P): Extract<RouteMap, { provider: P }> | undefined {
  return readRouteMaps(stored).find((map): map is Extract<RouteMap, { provider: P }> => map.provider === provider);
}

/**
 * Whether the route link (`route_url`) is the very Strava route the Strava tab already opens — then
 * the page does not draw it a second time («Deschide în Strava» stands for it).
 */
export function routeUrlIsStravaMap(routeUrl: string | null | undefined, stored: unknown): boolean {
  if (!routeUrl) return false;
  const strava = routeMapOf(stored, "strava");
  return strava !== undefined && stravaRouteIdFromUrl(routeUrl.trim()) === strava.id;
}
