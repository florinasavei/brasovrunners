import type { MetadataRoute } from "next";
import { getDb } from "@/db/client";
import { routing } from "@/i18n/routing";
import { findPublishedAlbumTranslations, listPublishedAlbums } from "@/modules/content/gallery/repository";
import { findPublishedPageTranslations, listPublishedPages } from "@/modules/content/pages/repository";
import { findPublishedTranslations, listPublishedEvents } from "@/modules/events/repository";
import { LEGAL_PAGE_ROUTE, legalDocumentsInForce } from "@/modules/legal-documents/public-page";
import { hreflangLanguages, slugRouteUrls, staticRouteUrl, staticRouteUrls } from "@/modules/seo/alternates";
import { env } from "@/shared/config/env";

/**
 * The public sitemap.
 *
 * Only locales with a published translation appear. The pilot publishes Romanian and leaves
 * English in Draft, so `/en/events/...` is absent — listing a URL that 404s is worse than
 * omitting it, and BR-REQ-040-02 makes that 404 the correct behaviour rather than a gap.
 *
 * Every entry carries the same `alternates.languages` its own page declares (`modules/seo/
 * alternates.ts`) — built from the one set of helpers, so the two cannot disagree about which
 * address a page lives at (§NNN). No entry ever carries a query string, and no address here
 * redirects: the site root and the bare, unprefixed paths are deliberately absent, because
 * they answer 307/308 and Search Console reports a redirecting sitemap entry as a defect.
 *
 * Participant action pages, the backoffice and runner profiles are never listed
 * (AGENTS.md §9.2).
 */
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const db = getDb();
  const now = new Date();
  const entries: MetadataRoute.Sitemap = [];

  for (const locale of routing.locales) {
    const events = await listPublishedEvents(db, locale);

    /**
     * The site root is deliberately absent: it redirects to the events listing, and listing a
     * URL that answers 308 asks a crawler to discover the same page twice. The listing is the
     * landing page, so it carries priority 1.
     *
     * It is only worth listing where there is something on it.
     */
    if (events.length > 0) {
      entries.push({
        url: staticRouteUrl(env.APP_BASE_URL, "/events", locale),
        alternates: { languages: hreflangLanguages(staticRouteUrls(env.APP_BASE_URL, "/events")) },
        changeFrequency: "weekly",
        priority: 1,
      });
    }

    for (const event of events) {
      const urls = slugRouteUrls(env.APP_BASE_URL, "/events/[slug]", await findPublishedTranslations(db, event.id));
      const url = urls[locale];
      if (!url) continue; // Just read as published in this locale; never advertise otherwise.
      entries.push({
        url,
        lastModified: event.publishedAt ?? undefined,
        changeFrequency: "weekly",
        priority: 0.7,
        alternates: { languages: hreflangLanguages(urls) },
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
    for (const page of await listPublishedPages(db, locale)) {
      const urls = slugRouteUrls(env.APP_BASE_URL, "/pages/[slug]", await findPublishedPageTranslations(db, page.id));
      const url = urls[locale];
      if (!url) continue;
      entries.push({
        url,
        lastModified: page.updatedAt,
        changeFrequency: "yearly",
        priority: 0.4,
        alternates: { languages: hreflangLanguages(urls) },
      });
    }
  }

  // The contact page (BR-REQ-070-04), once per locale: a standing page, rarely changed.
  for (const locale of routing.locales) {
    entries.push({
      url: staticRouteUrl(env.APP_BASE_URL, "/contact", locale),
      alternates: { languages: hreflangLanguages(staticRouteUrls(env.APP_BASE_URL, "/contact")) },
      changeFrequency: "yearly",
      priority: 0.3,
    });
  }

  // Albums (BR-REQ-054-01): the listing once per locale, then each published album.
  for (const locale of routing.locales) {
    const albums = await listPublishedAlbums(db, locale);
    if (albums.length === 0) continue;
    entries.push({
      url: staticRouteUrl(env.APP_BASE_URL, "/gallery", locale),
      alternates: { languages: hreflangLanguages(staticRouteUrls(env.APP_BASE_URL, "/gallery")) },
      changeFrequency: "monthly",
      priority: 0.4,
    });
    for (const album of albums) {
      const urls = slugRouteUrls(env.APP_BASE_URL, "/gallery/[slug]", await findPublishedAlbumTranslations(db, album.id));
      const url = urls[locale];
      if (!url) continue;
      entries.push({
        url,
        lastModified: album.updatedAt,
        changeFrequency: "yearly",
        priority: 0.3,
        alternates: { languages: hreflangLanguages(urls) },
      });
    }
  }

  /**
   * The two legal texts (BR-REQ-053-01), only once the club has approved one — the same rule
   * `legal-documents/public-page.ts` uses for the page's own `noindex`: a placeholder notice is
   * not content, and a page that is not indexed does not belong in the file that tells a
   * crawler what to index.
   */
  for (const key of ["TERMS", "PRIVACY_NOTICE"] as const) {
    const inForce = await legalDocumentsInForce(db, key, now);
    const locales = routing.locales.filter((candidate) => inForce[candidate]);
    if (locales.length === 0) continue;
    const urls = staticRouteUrls(env.APP_BASE_URL, LEGAL_PAGE_ROUTE[key], locales);
    for (const locale of locales) {
      const url = urls[locale];
      if (!url) continue;
      entries.push({
        url,
        lastModified: inForce[locale]?.effectiveAt,
        changeFrequency: "yearly",
        priority: 0.3,
        alternates: { languages: hreflangLanguages(urls) },
      });
    }
  }

  return entries;
}
