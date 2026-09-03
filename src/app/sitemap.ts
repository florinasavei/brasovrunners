import type { MetadataRoute } from "next";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { listPublishedEvents } from "@/modules/events/repository";
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
 */
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [];

  for (const locale of routing.locales) {
    entries.push({
      url: `${env.APP_BASE_URL}${getPathname({ locale, href: "/" })}`,
      changeFrequency: "weekly",
      priority: 1,
    });

    const events = await listPublishedEvents(getDb(), locale);

    // The events index is only worth listing where there is something on it.
    if (events.length > 0) {
      entries.push({
        url: `${env.APP_BASE_URL}${getPathname({ locale, href: "/events" })}`,
        changeFrequency: "weekly",
        priority: 0.8,
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

  return entries;
}
