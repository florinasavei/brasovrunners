import { type Locale, routing } from "@/i18n/routing";

/**
 * URLs people type that are not the ones this application serves.
 *
 * `/sign-in` and `/autentificare` are the real staff sign-in paths, and both already work
 * unprefixed because next-intl resolves an internal route name to each locale's own path. But
 * nobody types `/autentificare` from memory, and half the world types `/login` — so `/login`
 * answered 404, which reads as "there is no backoffice here" rather than "that is not what it
 * is called".
 *
 * An alias, not a second route. Adding `/login` to `routing.pathnames` would make it a page of
 * its own with its own metadata, its own place in every route table, and two URLs that both
 * render sign-in — which is the duplicate-content problem `hreflang` and canonical tags exist to
 * avoid. A redirect has one destination and leaves exactly one real path per locale.
 *
 * The target is read from `routing.pathnames` rather than written out here, so renaming the
 * sign-in path in one place cannot leave an alias pointing at a 404.
 */

/** The first path segment people type, and the internal route it means. */
const ALIASES: Record<string, "/sign-in"> = {
  login: "/sign-in",
};

/** Every alias segment, for the private-path check: a redirect to sign-in is not for an index. */
export const ALIAS_SEGMENTS: readonly string[] = Object.keys(ALIASES);

/**
 * Where an aliased URL should go, or null when the path is not one.
 *
 * Two shapes, and they are answered differently on purpose:
 *
 *   - `/ro/login` states its locale, so the answer states it too: `/ro/autentificare`.
 *   - `/login` states none, so the answer is the *unprefixed* internal path, `/sign-in`, and
 *     next-intl negotiates the locale from `Accept-Language` on the next hop — exactly as it
 *     already does for an unprefixed `/admin`. Guessing the default locale here instead would
 *     make `/login` behave differently from every other unprefixed URL on the site, and send an
 *     English-speaking visitor to the Romanian page.
 *
 * It costs a second redirect for the unprefixed form. That is the right trade for one typed URL,
 * against re-implementing language negotiation in the proxy.
 */
export function resolveAliasRedirect(pathname: string): string | null {
  const segments = pathname.split("/").filter(Boolean);
  const hasLocalePrefix =
    segments.length > 0 && (routing.locales as readonly string[]).includes(segments[0]);

  const rest = hasLocalePrefix ? segments.slice(1) : segments;

  // An alias is exactly one segment: `/login` or `/ro/login`, never `/login/anything`.
  if (rest.length !== 1) return null;

  const route = ALIASES[rest[0]];
  if (!route) return null;

  if (!hasLocalePrefix) return route;

  const locale = segments[0] as Locale;
  const localized = routing.pathnames[route];
  return `/${locale}${typeof localized === "string" ? localized : localized[locale]}`;
}
