import type { MetadataRoute } from "next";
import { getPathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { cachedPublishedAlbums, cachedPublishedPages, cachedSitemapEvents } from "@/modules/public-cache/reads";
import { env } from "@/shared/config/env";

/**
 * The public sitemap.
 *
 * Only locales with a published translation appear. The pilot publishes Romanian and leaves
 * English in Draft, so `/en/events/...` is absent — listing a URL that 404s is worse than
 * omitting it, and BR-REQ-040-02 makes that 404 the correct behaviour rather than a gap.
 *
 * Participant action pages, the backoffice and runner profiles are never listed
 * (AGENTS.md §9.2).
 *
 * Per request, from the public cache (§NNN): a crawler is exactly the visitor that should not
 * wake the database, and the rows here change only when an event, a page or an album is saved —
 * each of which expires them.
 */
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [];

  for (const locale of routing.locales) {
    const events = await cachedSitemapEvents(locale);

    /**
     * The site root is deliberately absent: it redirects to the events listing, and listing a
     * URL that answers 308 asks a crawler to discover the same page twice. The listing is the
     * landing page, so it carries priority 1.
     *
     * It is only worth listing where there is something on it.
     */
    if (events.length > 0) {
      entries.push({
        url: `${env.APP_BASE_URL}${getPathname({ locale, href: "/events" })}`,
        changeFrequency: "weekly",
        priority: 1,
      });
    }

    for (const event of events) {
      entries.push({
        url: `${env.APP_BASE_URL}${getPathname({
          locale,
          href: { pathname: "/events/[slug]", params: { slug: event.slug } },
        })}`,
        lastModified: event.publishedAt ?? undefined,
        changeFrequency: "weekly",
        priority: 0.7,
      });
    }
  }

  /**
   * Standing pages (BR-REQ-050-03), in a second pass so they sit together in the file rather
   * than interleaved with events.
   *
   * `changeFrequency` is yearly and the priority is below an event's: an About page is what a
   * visitor reads once, and an event is what they come back for. Only published rows are
   * returned, and only in a locale that has one — the same rule as everything above.
   */
  for (const locale of routing.locales) {
    for (const page of await cachedPublishedPages(locale)) {
      entries.push({
        url: `${env.APP_BASE_URL}${getPathname({
          locale,
          href: { pathname: "/pages/[slug]", params: { slug: page.slug } },
        })}`,
        lastModified: page.updatedAt,
        changeFrequency: "yearly",
        priority: 0.4,
      });
    }
  }

  // The contact page (BR-REQ-070-04), once per locale: a standing page, rarely changed.
  for (const locale of routing.locales) {
    entries.push({
      url: `${env.APP_BASE_URL}${getPathname({ locale, href: "/contact" })}`,
      changeFrequency: "yearly",
      priority: 0.3,
    });
  }

  // Albums (BR-REQ-054-01): the listing once per locale, then each published album.
  for (const locale of routing.locales) {
    const albums = await cachedPublishedAlbums(locale);
    if (albums.length === 0) continue;
    entries.push({
      url: `${env.APP_BASE_URL}${getPathname({ locale, href: "/gallery" })}`,
      changeFrequency: "monthly",
      priority: 0.4,
    });
    for (const album of albums) {
      entries.push({
        url: `${env.APP_BASE_URL}${getPathname({ locale, href: { pathname: "/gallery/[slug]", params: { slug: album.slug } } })}`,
        lastModified: album.takenOn,
        changeFrequency: "yearly",
        priority: 0.3,
      });
    }
  }

  return entries;
}
