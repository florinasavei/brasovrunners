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
 * - **the address's own question** — the filters (`?type=`, `?surface=`, … §413; the calendar's
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

/**
 * Query keys that no page reads — added by whoever shared the link, not by the site — and that must
 * therefore not turn a cached page into a rendered one. `_rsc` is Next's own cache-busting key on a
 * client navigation; it never selects different content.
 */
const IGNORED_QUERY_KEYS: ReadonlySet<string> = new Set(["_rsc", "fbclid", "gclid", "msclkid", "igshid", "mc_cid", "mc_eid", "ref"]);

function asksSomething(search: URLSearchParams): boolean {
  for (const key of search.keys()) {
    if (IGNORED_QUERY_KEYS.has(key) || key.startsWith("utm_")) continue;
    return true;
  }
  return false;
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

type Twin = { pattern: RegExp; signedIn: boolean };

/** The internal paths (after next-intl's rewrite) that have a twin, and whether a session sends a visitor there. */
const TWINS: readonly Twin[] = [
  { pattern: /^\/(ro|en)\/events$/, signedIn: false },
  { pattern: /^\/(ro|en)\/calendar$/, signedIn: false },
  // A period's own path (`/ro/calendar/2026-10`, §574): static too, and a filter on it is its twin.
  { pattern: /^\/(ro|en)\/calendar\/.+$/, signedIn: false },
  { pattern: /^\/(ro|en)\/events\/[^/]+$/, signedIn: true },
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
 * The twin's internal path for this request, or null when the static page answers it.
 *
 * `internalPathname` is the route's own path — `/ro/events/crosul`, not `/ro/evenimente/crosul` —
 * which is what next-intl rewrote the visitor's address to.
 */
export function liveTwinPathname(internalPathname: string, search: URLSearchParams, signedIn: boolean): string | null {
  const twin = TWINS.find(({ pattern }) => pattern.test(internalPathname));
  if (!twin) return null;
  if (!asksSomething(search) && !(twin.signedIn && signedIn)) return null;
  const [, locale, ...rest] = internalPathname.split("/");
  return `/${locale}/${LIVE_SEGMENT}/${rest.join("/")}`;
}
