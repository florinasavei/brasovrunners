import { parseLocalizedPath } from "@/i18n/alternate-path";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { type Database, findPublishedEventBySlug, findPublishedTranslations } from "./repository";

/**
 * Where a language switch lands (BR-REQ-040-01 criterion 5).
 *
 * Kept out of the route handler so it can be tested against a database rather than through
 * HTTP. The one case that matters needs both halves of the system: the two locales of an event
 * have genuinely different slugs — `tura-pe-tampa` and `tampa-trail` are one event — so the
 * obvious implementation of a language switcher, swapping the locale prefix, produces a 404.
 *
 * Three outcomes, and none of them is a broken page:
 *
 *   - the same page in the other language, when there is one;
 *   - that language's event listing, when the page has no published translation there
 *     (BR-REQ-040-02: an unpublished locale is a 404, so it must not be linked to);
 *   - that language's event listing, when the path is not one of ours at all.
 */
export async function resolveLocaleSwitch(
  db: Database,
  from: string,
  target: Locale,
): Promise<string> {
  const parsed = parseLocalizedPath(from);
  const listing = getPathname({ locale: target, href: "/events" });

  if (!parsed) return listing;

  if (parsed.route === "/events/[slug]" || parsed.route === "/events/[slug]/register") {
    const slug = parsed.params.slug;
    if (!slug) return listing;

    const event = await findPublishedEventBySlug(db, parsed.locale, slug);
    if (!event) return listing;

    const translations = await findPublishedTranslations(db, event.id);
    const sibling = translations.find((translation) => translation.locale === target);
    if (!sibling) return listing;

    return getPathname({
      locale: target,
      href: { pathname: parsed.route, params: { slug: sibling.slug } },
    });
  }

  // The staff routes carry an id rather than a slug, and an id is the same in both languages.
  if (
    parsed.route === "/admin/events/[id]" ||
    parsed.route === "/preview/events/[id]" ||
    parsed.route === "/admin/registrations/[id]" ||
    parsed.route === "/admin/legal/[id]"
  ) {
    const id = parsed.params.id;
    if (!id) return listing;
    return getPathname({ locale: target, href: { pathname: parsed.route, params: { id } } });
  }

  // An email-token link is opaque and locale-independent — the same secret works from either
  // language's URL, and switching language must not reissue or invalidate it.
  if (
    parsed.route === "/registrations/confirm/[token]" ||
    parsed.route === "/registrations/declare/[token]" ||
    parsed.route === "/registrations/manage/[token]"
  ) {
    const token = parsed.params.token;
    if (!token) return listing;
    return getPathname({ locale: target, href: { pathname: parsed.route, params: { token } } });
  }

  return getPathname({ locale: target, href: parsed.route });
}
