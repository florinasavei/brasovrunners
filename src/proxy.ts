import createMiddleware from "next-intl/middleware";
import type { NextRequest } from "next/server";
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
  const response = intlProxy(request);

  if (isPrivatePath(new URL(request.url).pathname)) {
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
