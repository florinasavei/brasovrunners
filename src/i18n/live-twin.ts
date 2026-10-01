import { activeFilterCount, parseListingFilter } from "@/modules/events/domain/listing-filter";
import { DEV_STAFF_COOKIE } from "@/modules/staff-identity/dev-staff-cookie";
import { PREFETCHED_PATHNAMES } from "./prefetch";

/**
 * Which request a static public page cannot answer, and the live twin that answers it (§549,
 * amending §333).
 *
 * The listing, the calendar and an event page are static for an anonymous visitor at their bare
 * address: the CDN answers, and no function runs (`public-cache/page-lifetime.ts`). Three things
 * they show depend on the request instead, and those requests go to a twin of the same page,
 * rendered per request exactly as every public page was before (`app/[locale]/live/…`):
 *
 * - **the address's own question** — the filters (`?type=`, `?surface=`, … §413, and the listing's
 *   past section's `?past-type=`, … §NNN; the calendar's
 *   month, year and layout are its path since §574, `/ro/calendar/2026-10`, and the old `?month=`,
 *   `?year=`, `?view=` are redirected there by the proxy before this is asked), an event page's start-list
 *   page (`?lista=` §250), the interest box's outcome (`?interest=`, `?since=` §146) and the
 *   signer's own link (`?declaratie=` §523). A query key the page does not read — a share's
 *   `fbclid`, a campaign's `utm_*` — changes nothing on the page, so it stays static;
 * - **a signed-in session**, on an event page only: the "edit in the backoffice" button (§135) is
 *   for staff, and the static copy is the one every stranger is served.
 *
 * The visitor's address does not change: the proxy rewrites, it never redirects. Pure, so the
 * decision is tested on its own (`tests/unit/i18n/live-twin.test.ts`).
 */

/** The first segment of every twin under the locale: `/ro/live/events/…`. Never linked, never in the sitemap. */
export const LIVE_SEGMENT = "live";

/*
  What each page asks of its address, read the way the page reads it (§577, amending §549).

  §549 sent every key outside a short list of share keys (`fbclid`, `utm_*`, Next's `_rsc`, …) to a
  twin, so `?foo=1`, `?page=2`, a scanner's `?s=` or a filter that names nothing (`?type=FOO`) was a
  function render of exactly the page the CDN holds — measured on production, 2026-09-30:
  `/ro/evenimente?foo=1` and `?page=2` answered from `/[locale]/live/events`, `private, no-store`,
  a MISS each time. The rule is now the page's own: a twin only when what the page would read from
  the address changes what it shows.

  - **The listing**: a filter that ticks something in either of its two scopes (`parseListingFilter`,
    §413 — the same parser the page runs, so a value it drops is dropped here too): the cards ahead
    (`?type=RACE`) or, since §NNN, the past section's own (`?past-type=RACE`; `?past-foo=1` and
    `?past-type=FOO` name nothing) — or the list layout (`?view=list`, first value, as the page reads it).
  - **The bare calendar**: the same filters, the cards-ahead scope only (it draws no past section), and its old `?month=`, `?year=`, `?view=` should one get
    past the proxy's redirect to the period's path (§574, the calendar's own).
  - **A calendar period's path**: the filters.
  - **An event page**: its four keys, whatever their value — the start list's page (`?lista=`, §250),
    the interest box's outcome and its timing (`?interest=`, `?since=`, §146) and the signer's link
    (`?declaratie=`, §523), which the page judges itself.
*/
/** An event page's own questions: the keys `EventDetailPage` reads. */
const EVENT_PAGE_KEYS = ["lista", "interest", "since", "declaratie"] as const;
/** The bare calendar's keys from before its period moved into the path: its twin still reads them. */
const LEGACY_CALENDAR_KEYS = ["month", "year", "view"] as const;

function asParams(search: URLSearchParams): Record<string, string[]> {
  const params: Record<string, string[]> = {};
  for (const [key, value] of search) (params[key] ??= []).push(value);
  return params;
}

/** Whether the address ticks any filter the calendar offers (§413): the `upcoming` scope, the names it reads. */
function asksAFilter(search: URLSearchParams): boolean {
  return activeFilterCount(parseListingFilter(asParams(search), "upcoming")) > 0;
}

/** Whether the address ticks any filter the listing offers: the cards ahead's, or the past section's own (§NNN). */
function asksAListingFilter(search: URLSearchParams): boolean {
  const params = asParams(search);
  return activeFilterCount(parseListingFilter(params, "upcoming")) + activeFilterCount(parseListingFilter(params, "past")) > 0;
}

/**
 * The cookies that say somebody may be signed in: Auth.js's session (`authjs.session-token`, on
 * HTTPS `__Secure-authjs.session-token`, chunked as `.0`, `.1` when long) and the development
 * switcher's (`DEV_STAFF_COOKIE`). Presence only — the twin asks who it is, and asserts nothing
 * from this (BR-REQ-060-01).
 */
export function mayBeSignedIn(cookieNames: Iterable<string>): boolean {
  for (const name of cookieNames) {
    if (name === DEV_STAFF_COOKIE || /^(__Secure-)?authjs\.session-token(\.\d+)?$/.test(name)) return true;
  }
  return false;
}

type Twin = {
  pattern: RegExp;
  /** Whether a session sends a visitor there (the staff edit button, §135). */
  signedIn: boolean;
  /** Whether this address asks the page something the static copy cannot answer. */
  asks: (search: URLSearchParams) => boolean;
};

/** The internal paths (after next-intl's rewrite) that have a twin, and what sends a visitor there. */
const TWINS: readonly Twin[] = [
  { pattern: /^\/(ro|en)\/events$/, signedIn: false, asks: (search) => asksAListingFilter(search) || search.get("view") === "list" },
  { pattern: /^\/(ro|en)\/calendar$/, signedIn: false, asks: (search) => asksAFilter(search) || LEGACY_CALENDAR_KEYS.some((key) => search.has(key)) },
  // A period's own path (`/ro/calendar/2026-10`, §574): static too, and a filter on it is its twin.
  { pattern: /^\/(ro|en)\/calendar\/.+$/, signedIn: false, asks: asksAFilter },
  { pattern: /^\/(ro|en)\/events\/[^/]+$/, signedIn: true, asks: (search) => EVENT_PAGE_KEYS.some((key) => search.has(key)) },
];

/**
 * The static public pages' internal paths (`/ro/events/crosul`), one pattern per route of
 * `PREFETCHED_PATHNAMES`: a `[slug]` is one segment, a catch-all `[...period]` one or more.
 */
const STATIC_PAGES: readonly RegExp[] = [...PREFETCHED_PATHNAMES].map(
  (pathname) => new RegExp(`^/(ro|en)${pathname.replace(/\[\.\.\.[^\]]+\]/g, ".+").replace(/\[[^\]]+\]/g, "[^/]+")}$`),
);

/**
 * What the browser is told about a static public page's answer (§549): `public, max-age=0,
 * must-revalidate` — keep it, but ask again (with its ETag) before every use.
 *
 * Next hands the page's ISR lifetime to whoever asked, as `s-maxage=N, stale-while-revalidate=…`.
 * On Vercel the CDN reads that and strips both before the browser sees them, sending this exact
 * header instead (Vercel's CDN-cache documentation). Anywhere else — `next start`, which is what
 * the end-to-end suite runs — the browser gets them as they are: with no `max-age` a response is
 * stale at once, and `stale-while-revalidate` then lets the browser show its old copy while it
 * asks again behind the page's back. So a page published a second ago read as the old page, and
 * the background request never finished for the browser's own tools (Playwright's `networkidle`
 * waited for it forever). Said here, off Vercel, so every server gives the browser what Vercel does
 * for a static page. Only the pages: the `force-static` pictures and files (the Open Graph
 * pictures, the `.ics`) keep Next's header off Vercel — a stale picture in a browser is harmless,
 * and no test reads one after a save.
 */
export const STATIC_PAGE_BROWSER_CACHE_CONTROL = "public, max-age=0, must-revalidate";

/**
 * Whether this request is answered by a static public page — its internal path is one of
 * `PREFETCHED_PATHNAMES` and no twin takes it — and so needs `STATIC_PAGE_BROWSER_CACHE_CONTROL`.
 */
export function isStaticPublicAnswer(internalPathname: string, search: URLSearchParams, signedIn: boolean): boolean {
  if (!STATIC_PAGES.some((pattern) => pattern.test(internalPathname))) return false;
  return liveTwinPathname(internalPathname, search, signedIn) === null;
}

/**
 * Whether this request is the App Router's prefetch rather than a visit or a navigation (§577):
 * Next marks every prefetch it sends with `Next-Router-Prefetch`, and the per-segment ones with
 * `Next-Router-Segment-Prefetch` too (Next 16.3, `app-router-headers`). A navigation carries `RSC`
 * alone; a document request carries neither.
 */
export function isRouterPrefetch(headers: Headers): boolean {
  return headers.has("next-router-prefetch") || headers.has("next-router-segment-prefetch");
}

/**
 * What the proxy answers a prefetch that a twin would have to render (§577): nothing, `204`, and
 * never kept by anybody.
 *
 * Next prefetches every link in view whose `prefetch` is left to it, and `prefetchFor` leaves it
 * only to a static page at its bare address (§549). For a stranger that is a CDN hit. For a
 * signed-in reader the same bare event link is a twin (the edit button, §135), so every event card
 * in view on the listing started a per-request render of that event, for a click that mostly never
 * came. A prefetch answered without a body is one Next's router drops (`fetchPrefetchResponse` reads
 * no Flight answer, the route entry is rejected for ten seconds), and a press then fetches the page
 * as a navigation — through this proxy, to the twin, edit button and all. Only the prefetch is
 * declined: the visit, the navigation and every stranger's prefetch are exactly as before.
 */
export const DECLINED_PREFETCH_STATUS = 204;

/**
 * The twin's internal path for this request, or null when the static page answers it.
 *
 * `internalPathname` is the route's own path — `/ro/events/crosul`, not `/ro/evenimente/crosul` —
 * which is what next-intl rewrote the visitor's address to.
 */
export function liveTwinPathname(internalPathname: string, search: URLSearchParams, signedIn: boolean): string | null {
  const twin = TWINS.find(({ pattern }) => pattern.test(internalPathname));
  if (!twin) return null;
  if (!twin.asks(search) && !(twin.signedIn && signedIn)) return null;
  const [, locale, ...rest] = internalPathname.split("/");
  return `/${locale}/${LIVE_SEGMENT}/${rest.join("/")}`;
}
