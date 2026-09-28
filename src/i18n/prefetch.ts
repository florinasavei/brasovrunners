/**
 * Whether a link may be prefetched (§NNN, amending §333).
 *
 * The public pages that are the same for every stranger are static: the CDN answers them, and a
 * prefetch of one is a CDN hit too. Every other address a public page links to is rendered per
 * request — the contact form, «Beneficiile membrilor», the registration and declaration forms, «Înscrierile mele»,
 * the sign-in, a live twin (any address with a query, `i18n/live-twin.ts`) — and Next prefetches a
 * link as soon as it scrolls into view, so each such link on a static page would start a function
 * on a visit the CDN otherwise answers alone. Those links are never prefetched; the press still
 * navigates softly and waits for its answer.
 *
 * An allow-list, not a deny-list: a route added later is not prefetched until it is named here as
 * static, so forgetting it costs a few milliseconds of a press, never a function per view. The
 * list equals the static public pages (`tests/unit/public-cache/static-public-routes.test.ts`
 * holds the two together, and walks every link a static page renders).
 */
export const PREFETCHED_PATHNAMES: ReadonlySet<string> = new Set([
  "/events",
  "/events/[slug]",
  "/calendar",
  "/faq",
  "/team",
  "/gallery",
  "/gallery/[slug]",
  "/pages/[slug]",
  "/legal/terms",
  "/legal/privacy",
]);

/** A locale-aware `href`, as `Link` from `@/i18n/navigation` takes it: a route's pathname, or an object naming one. */
type Href = string | { pathname: string; query?: unknown };

function asksSomething(query: unknown): boolean {
  if (typeof query === "string") return query.replace(/^\?/, "") !== "";
  if (query instanceof URLSearchParams) return query.size > 0;
  if (query && typeof query === "object") return Object.values(query).some((value) => value !== undefined && value !== null);
  return false;
}

/** `prefetch` for a link to `href`: Next's own default for a static public page at its bare address, `false` for everything else. */
export function prefetchFor(href: Href): false | undefined {
  const [pathname, query] = typeof href === "string" ? [href.split("#")[0].split("?")[0], href.split("#")[0].split("?")[1]] : [href.pathname, href.query];
  return PREFETCHED_PATHNAMES.has(pathname) && !asksSomething(query) ? undefined : false;
}
