import type { MetadataRoute } from "next";
import { routing } from "@/i18n/routing";
import { LEGAL_PAGE_ROUTE, legalDocumentsInForce } from "@/modules/legal-documents/public-page";
import { cachedSitemapAlbums, cachedSitemapEvents, cachedSitemapPages } from "@/modules/public-cache/reads";
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
 *
 * **The calendar is deliberately absent too**, though it declares its own self-canonical
 * (`app/[locale]/calendar/page.tsx`, proven in `tests/e2e/seo.spec.ts`): it renders the same
 * published events the listing already carries at priority 1, in a different layout rather
 * than different content, so a second entry here would be the near-duplicate a sitemap exists
 * to avoid rather than one it prevents (§NNN). A visitor reaches it from the listing's own
 * "Lună"/"An" view switch; nothing depends on a crawler being pointed at it directly.
 *
 * Per request, from the public cache (§333): a crawler is exactly the visitor that should not
 * wake the database, and the rows here change only when an event, a page, an album or a legal
 * text is saved — each of which expires them. Each cached read carries its rows' alternates
 * already grouped, one query per kind for the whole list (`public-cache/reads.ts`).
 */
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const entries: MetadataRoute.Sitemap = [];

  for (const locale of routing.locales) {
    const events = await cachedSitemapEvents(locale);

    /**
     * The site root is deliberately absent: it redirects to the events listing, and listing a
     * URL that answers 308 asks a crawler to discover the same page twice. The listing is the
     * landing page, so it carries priority 1.
     *
     * Listed even with nothing on it, unlike a guard here once read: the page itself always
     * exists in both locales — `events/page.tsx` renders an empty state rather than 404ing —
     * and its own `generateMetadata` already declares both languages as alternates
     * unconditionally, so omitting the entry only made the sitemap disagree with the page about
     * which addresses exist (§NNN).
     */
    entries.push({
      url: staticRouteUrl(env.APP_BASE_URL, "/events", locale),
      alternates: { languages: hreflangLanguages(staticRouteUrls(env.APP_BASE_URL, "/events")) },
      changeFrequency: "weekly",
      priority: 1,
    });

    for (const event of events) {
      const urls = slugRouteUrls(env.APP_BASE_URL, "/events/[slug]", event.translations);
      const url = urls[locale];
      if (!url) continue; // Just read as published in this locale; never advertise otherwise.
      entries.push({
        url,
        // `publishedAt`, not `updatedAt`: deliberately, the same reason `service.ts` gives for
        // never re-stamping it after the first publication — a later edit that only fixes a
        // typo must not tell a crawler the page is new (`content/events/service.ts` § "First
        // publication stamps the date"). Pages and albums differ because nothing there plays
        // that second role; an event's `publishedAt` already has to (§NNN).
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
    for (const page of await cachedSitemapPages(locale)) {
      const urls = slugRouteUrls(env.APP_BASE_URL, "/pages/[slug]", page.translations);
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

  /**
   * Albums (BR-REQ-054-01): the listing once per locale, then each published album.
   *
   * The listing entry is pushed whatever the album count, for the same reason the events
   * listing now is (§NNN): `gallery/page.tsx` renders with zero albums rather than 404ing, and
   * its own `generateMetadata` already names both locales as alternates unconditionally, so a
   * count-gated entry here only disagreed with the page. "Galerie" leaving the nav while no
   * album is published (§66) is a navigation decision, not a routing one — the address still
   * resolves, and a crawler that already knows it should still be told where its languages are.
   */
  for (const locale of routing.locales) {
    const albums = await cachedSitemapAlbums(locale);
    entries.push({
      url: staticRouteUrl(env.APP_BASE_URL, "/gallery", locale),
      alternates: { languages: hreflangLanguages(staticRouteUrls(env.APP_BASE_URL, "/gallery")) },
      changeFrequency: "monthly",
      priority: 0.4,
    });
    for (const album of albums) {
      const urls = slugRouteUrls(env.APP_BASE_URL, "/gallery/[slug]", album.translations);
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
    const inForce = await legalDocumentsInForce(key, now);
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
