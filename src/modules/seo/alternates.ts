import { getPathname } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { absoluteUrl } from "@/modules/events/share-links";

/**
 * One canonical URL per page, and the language versions of it that exist (§NNN).
 *
 * Pure functions of a base URL and what the database said, so a test can hold them to a fixed
 * base and read them back — the page metadata and the sitemap both build from these, which is
 * what keeps the two from disagreeing about which address a page lives at.
 *
 * Three rules, each one a Search Console report it answers:
 *
 * - **The canonical is the locale's own path and nothing else.** No query string: the listing's
 *   type filter, the calendar's month, year and layout, the contact form's outcome and an event
 *   page's start-list page all render the same page under another address, and the builders
 *   never see the request, so a parameter cannot leak into one.
 * - **An alternate is listed only where the page exists.** An event, a standing page or an
 *   album with no translation in a locale is a 404 there (BR-REQ-040-02, §28), and a legal
 *   text with no approved version in a locale is not content; neither is advertised.
 * - **`x-default` is the Romanian URL**, the prefixed one. The unprefixed path would redirect
 *   (`localePrefix: "always"`), and Romanian is where the root sends everybody (`routing.ts`).
 *   A page with no Romanian version has no `x-default`.
 */

/** A page's absolute URL in each locale where it exists. */
export type LocaleUrls = Partial<Record<Locale, string>>;

/** The hreflang set Next writes as `<link rel="alternate" hreflang>`. */
export type HreflangLanguages = Partial<Record<Locale | "x-default", string>>;

/** The public pages whose address takes no parameter, and which exist in every locale. */
export type StaticPublicRoute = "/events" | "/calendar" | "/gallery" | "/contact" | "/legal/privacy" | "/legal/terms";

/** The public pages addressed by a per-locale slug — editorial data only the database pairs. */
export type SlugPublicRoute = "/events/[slug]" | "/pages/[slug]" | "/gallery/[slug]";

/** A page without parameters, in one locale — the address a link or a JSON-LD `url` names. */
export function staticRouteUrl(baseUrl: string, route: StaticPublicRoute, locale: Locale): string {
  return absoluteUrl(baseUrl, getPathname({ locale, href: route }));
}

/** A page without parameters, in each of `locales` (every locale unless told otherwise). */
export function staticRouteUrls(
  baseUrl: string,
  route: StaticPublicRoute,
  locales: readonly Locale[] = routing.locales,
): LocaleUrls {
  const urls: LocaleUrls = {};
  for (const locale of locales) urls[locale] = staticRouteUrl(baseUrl, route, locale);
  return urls;
}

/**
 * A slug page in each locale it has a published translation in — each at *that locale's own
 * slug* (BR-REQ-040-01 criterion 5): `tura-pe-tampa` and `tampa-trail` are one event, and
 * swapping the prefix on either is a 404.
 */
export function slugRouteUrls(
  baseUrl: string,
  route: SlugPublicRoute,
  translations: ReadonlyArray<{ locale: Locale; slug: string }>,
): LocaleUrls {
  const urls: LocaleUrls = {};
  for (const { locale, slug } of translations) {
    urls[locale] = absoluteUrl(baseUrl, getPathname({ locale, href: { pathname: route, params: { slug } } }));
  }
  return urls;
}

/** `ro`, `en`, then `x-default` pointing at the Romanian URL — each only when it exists. */
export function hreflangLanguages(urls: LocaleUrls): HreflangLanguages {
  const languages: HreflangLanguages = {};
  for (const locale of routing.locales) {
    const url = urls[locale];
    if (url) languages[locale] = url;
  }
  const fallback = urls[routing.defaultLocale];
  if (fallback) languages["x-default"] = fallback;
  return languages;
}

/**
 * The page's `alternates` in `locale`: itself as the canonical, and its language versions.
 * `undefined` when the page does not exist in `locale` — a page that is not there declares
 * nothing rather than a canonical pointing somewhere else.
 */
export function pageAlternates(
  locale: Locale,
  urls: LocaleUrls,
): { canonical: string; languages: HreflangLanguages } | undefined {
  const canonical = urls[locale];
  if (!canonical) return undefined;
  return { canonical, languages: hreflangLanguages(urls) };
}
