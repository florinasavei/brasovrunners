import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { resolveAliasRedirect } from "@/i18n/aliases";
import { localeRootTarget } from "@/i18n/root-redirect";
import { routing } from "@/i18n/routing";
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
   * A locale's root is the listing (§NNN): `/ro` → `/ro/evenimente`, a real 308 with an empty
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
