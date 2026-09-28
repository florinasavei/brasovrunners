import { getPathname } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { absoluteUrl } from "@/modules/events/share-links";

/**
 * One canonical URL per page and its existing language versions (§342); the page metadata and the
 * sitemap both build from these, so they cannot disagree.
 *
 * - The canonical is the locale's own path, never a query string.
 * - An alternate is listed only where the page exists (BR-REQ-040-02, §28).
 * - `x-default` is the prefixed Romanian URL (`localePrefix: "always"`); none without a Romanian version.
 */

/** A page's absolute URL in each locale where it exists. */
export type LocaleUrls = Partial<Record<Locale, string>>;

/** The hreflang set Next writes as `<link rel="alternate" hreflang>`. */
export type HreflangLanguages = Partial<Record<Locale | "x-default", string>>;

/** The public pages whose address takes no parameter, and which exist in every locale. */
// «Beneficiile membrilor» (§524) is one; the members' zone never is.
export type StaticPublicRoute =
  | "/events"
  | "/calendar"
  | "/gallery"
  | "/team"
  | "/faq"
  | "/members"
  | "/contact"
  | "/legal/privacy"
  | "/legal/terms";

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
 * A slug page in each locale it is published in, at that locale's own slug (BR-REQ-040-01
 * criterion 5).
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
 * The page's `alternates` in `locale`, or `undefined` when it does not exist there — a missing
 * page declares no canonical at all.
 */
export function pageAlternates(
  locale: Locale,
  urls: LocaleUrls,
): { canonical: string; languages: HreflangLanguages } | undefined {
  const canonical = urls[locale];
  if (!canonical) return undefined;
  return { canonical, languages: hreflangLanguages(urls) };
}
