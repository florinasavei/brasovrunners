import { type Locale, routing } from "@/i18n/routing";

/**
 * The site root is the listing, and the proxy says so before anything renders (§NNN).
 *
 * `app/[locale]/page.tsx` used to be the only answer to `/ro`: a `permanentRedirect` thrown from
 * inside a page. By then the root layout had started streaming, so Next could no longer send the
 * 308 it meant — production answered the most-visited URL with a 200, a 300 KB error document
 * (`<html id="__next_error__">`) and a client-side hop carried in the payload, which a crawler
 * reads as a soft redirect. A redirect decided in the proxy is a real status line and an empty
 * body. The page stays as the fallback for anything that reaches it anyway.
 *
 * The target is read from `routing.pathnames`, like `aliases.ts`, so renaming the listing's path
 * in one place cannot leave the root pointing at a 404.
 */

/** The listing's own path in one locale: `/ro/evenimente`, `/en/events`. */
export function listingPath(locale: Locale): string {
  const localized = routing.pathnames["/events"];
  return `/${locale}${typeof localized === "string" ? localized : localized[locale]}`;
}

/**
 * Where a locale's root goes — `/ro` and `/ro/` to `/ro/evenimente` — or null for any other
 * path, an unknown locale's included (that one is the layout's 404, BR-REQ-040-02).
 */
export function localeRootTarget(pathname: string): string | null {
  const segment = /^\/([^/]+)\/?$/.exec(pathname)?.[1];
  // Not next-intl's `hasLocale`: the proxy imports this, and that entry point is the React one.
  if (!segment || !(routing.locales as readonly string[]).includes(segment)) return null;
  return listingPath(segment as Locale);
}
