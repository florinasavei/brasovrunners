import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { resolveAliasRedirect } from "@/i18n/aliases";
import { legacyCalendarTarget } from "@/i18n/calendar-redirect";
import { isStaticPublicAnswer, liveTwinPathname, mayBeSignedIn, STATIC_PAGE_BROWSER_CACHE_CONTROL } from "@/i18n/live-twin";
import { resolveMovedBackofficePath } from "@/i18n/moved-paths";
import { localeRootTarget } from "@/i18n/root-redirect";
import { routing } from "@/i18n/routing";
import { REQUEST_PATH_HEADER } from "@/modules/resilience/domain/resting-page";
import { isPrivatePath } from "@/shared/security/private-paths";

// Next.js 16 renamed middleware.ts to proxy.ts; the runtime is Node.js only.
// Redirects `/` and unprefixed paths to the default locale and negotiates `ro` / `en`.
const intlProxy = createMiddleware(routing);

/**
 * Locale negotiation, plus the response headers that keep staff pages out of search results
 * and out of caches.
 *
 * The pages set `robots: noindex` in their own metadata as well. This is the belt that holds
 * when a response never renders metadata at all — a redirect to sign-in, a 404 for an
 * anonymous request to the backoffice, an error page (BR-REQ-051-02 criterion 2).
 */
export default function proxy(request: NextRequest) {
  const url = new URL(request.url);

  /**
   * Aliases first, before locale negotiation.
   *
   * `/login` is not a route, so next-intl would prefix it into `/ro/login` and hand the visitor
   * a 404 — which reads as "there is no backoffice here" rather than "that is not its name".
   * Resolved here so both `/login` and `/ro/login` land on the real sign-in path.
   */
  const alias = resolveAliasRedirect(url.pathname);
  if (alias) {
    const target = new URL(alias, url);
    target.search = url.search;
    const redirect = NextResponse.redirect(target);
    // The redirect is a response of its own, and it is a staff path: it must not be indexed or
    // cached any more than the page it points at.
    redirect.headers.set("X-Robots-Tag", "noindex, nofollow");
    redirect.headers.set("Cache-Control", "private, no-store, max-age=0, must-revalidate");
    return redirect;
  }

  /**
   * A backoffice address that moved into «Setări» (§516): a real 308 to where it lives now, the
   * query kept, before anything renders — so a bookmark, an old link or a tab left open keeps
   * working, and a POST from a page loaded before the move stays a POST.
   */
  const moved = resolveMovedBackofficePath(url.pathname, url.search);
  if (moved) {
    const target = new URL(moved.pathname, url);
    target.search = moved.search;
    const redirect = NextResponse.redirect(target, 308);
    // A staff path, like the alias above: never indexed, never cached.
    redirect.headers.set("X-Robots-Tag", "noindex, nofollow");
    redirect.headers.set("Cache-Control", "private, no-store, max-age=0, must-revalidate");
    return redirect;
  }

  /**
   * A locale's root is the listing (§353): `/ro` → `/ro/evenimente`, a real 308 with an empty
   * body, the query kept. Answered here rather than by `app/[locale]/page.tsx`'s
   * `permanentRedirect`, which runs after the layout has started streaming and so could only
   * send a 200 and an error document carrying a client-side hop.
   */
  const listing = localeRootTarget(url.pathname);
  if (listing) {
    const target = new URL(listing, url);
    target.search = url.search;
    return NextResponse.redirect(target, 308);
  }

  /*
    The calendar's period moved from the query into the path (§574): `/ro/calendar?month=2026-10`
    → `/ro/calendar/2026-10`, `?view=list` → `/<this month>/list`, `?year=2027` → `/2027`, every
    filter kept. A redirect before anything renders (a 308 where the address fixes the period, a
    `no-store` 307 where it means this month), so a bookmark or a search result lands on the
    static period page the CDN answers. Only a read: a POST keeps its address.
  */
  if (request.method === "GET" || request.method === "HEAD") {
    const calendar = legacyCalendarTarget(url.pathname, url.searchParams, new Date());
    if (calendar?.fixed) return NextResponse.redirect(new URL(calendar.address, url), 308);
    if (calendar) {
      // "This month" moves with the clock: a 307 the browser does not keep, never a cached 308.
      const redirect = NextResponse.redirect(new URL(calendar.address, url), 307);
      redirect.headers.set("Cache-Control", "private, no-store, max-age=0, must-revalidate");
      return redirect;
    }
  }

  /*
    The visited address, handed to the page as a request header (§447): a public page that has
    nothing to show while the month's budget is red sends its reader to the short resting page,
    and this is how that page knows where to bring them back. Always overwritten here, so a caller
    cannot choose it; and only ever read as a path on this site (`safeBackPath`).
  */
  try {
    request.headers.set(REQUEST_PATH_HEADER, `${url.pathname}${url.search}`);
  } catch {
    // Headers the runtime keeps read-only: the resting page then brings the reader to the root.
  }
  const response = intlProxy(request);

  /**
   * And `/` in one hop rather than two. next-intl answers it with a redirect to a locale's root
   * (`/ro`, 307), which the branch above would then send on to the listing; pointing next-intl's
   * own redirect at the listing instead keeps its choice of locale and its status, and saves the
   * visitor a round trip.
   */
  const location = response.headers.get("location");
  if (location) {
    const target = new URL(location, url);
    const retarget = localeRootTarget(target.pathname);
    if (retarget) {
      target.pathname = retarget;
      response.headers.set("location", target.toString());
    }
  }

  /*
    The listing, the calendar and an event page are static for an anonymous visitor at their bare
    address (§549): the CDN answers them. A request whose query the page reads (a filter, a month,
    `?lista=`), or an event page asked with a session cookie (the staff "edit" button, §135), is
    rewritten to the page's live twin under `/<locale>/live/…`, rendered per request as before — the
    visitor's address unchanged. next-intl has already resolved the route: its rewrite names the
    internal path (`/ro/events/…` for `/ro/evenimente/…`), and its request headers ride along.
  */
  if (!location) {
    const internal = new URL(response.headers.get("x-middleware-rewrite") ?? url.href, url);
    const signedIn = mayBeSignedIn(request.cookies.getAll().map((cookie) => cookie.name));
    const twin = liveTwinPathname(internal.pathname, url.searchParams, signedIn);
    if (twin) {
      const target = new URL(twin, url);
      target.search = url.search;
      const headers = new Headers(response.headers);
      headers.delete("x-middleware-next");
      return NextResponse.rewrite(target, { headers });
    }
    /*
      A static page's answer, off Vercel: the browser is told what Vercel's CDN tells it (§549,
      `STATIC_PAGE_BROWSER_CACHE_CONTROL` says why). Next keeps a `Cache-Control` already on the
      response rather than writing its own `s-maxage`, and its ISR copy is kept all the same. On
      Vercel nothing is set here: the CDN reads Next's `s-maxage` and strips it itself. Only on a
      GET or a HEAD: a POST to the same address (a Server Action, a form sent without JavaScript)
      is answered per request, and Next's own `no-store` on it must stand.
    */
    const readsThePage = request.method === "GET" || request.method === "HEAD";
    if (process.env.VERCEL !== "1" && readsThePage && isStaticPublicAnswer(internal.pathname, url.searchParams, signedIn)) {
      response.headers.set("Cache-Control", STATIC_PAGE_BROWSER_CACHE_CONTROL);
    }
  }

  if (isPrivatePath(url.pathname)) {
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
    // `private` keeps it out of every shared cache; `no-store` keeps it out of the browser's
    // too, so a draft does not sit in the back button after the organizer signs out.
    response.headers.set("Cache-Control", "private, no-store, max-age=0, must-revalidate");
  }

  return response;
}

export const config = {
  // Everything except API routes, Next internals, Vercel internals, and files with an extension.
  matcher: "/((?!api|_next|_vercel|.*\\..*).*)",
};
