import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { cachedCurrentApprovedDocument } from "@/modules/public-cache/reads";
import { readWithLastGood } from "@/modules/resilience/last-good";
import { pageAlternates, staticRouteUrls } from "@/modules/seo/alternates";
import type { CurrentLegalDocument } from "./repository";

/**
 * The two public legal pages' SEO (§342). The page never 404s, so a locale with no approved text
 * is `noindex` (else the empty pages read as duplicates); one with a text is its own canonical,
 * with hreflang only to locales that have one too.
 */

/** The legal documents that have a public page; the declaration is signed, never browsed. */
export type PublicLegalKey = "TERMS" | "PRIVACY_NOTICE";

/** The internal route, localized by `getPathname`. */
export const LEGAL_PAGE_ROUTE = { TERMS: "/legal/terms", PRIVACY_NOTICE: "/legal/privacy" } as const;

export type LegalInForce = Partial<Record<Locale, Pick<CurrentLegalDocument, "title" | "effectiveAt">>>;

/** One cached read per locale (§333), for the sitemap: a crawler wakes the database no more than a visitor. */
export async function legalDocumentsInForce(key: PublicLegalKey, now: Date): Promise<LegalInForce> {
  const inForce: LegalInForce = {};
  for (const locale of routing.locales) {
    const document = await cachedCurrentApprovedDocument(key, locale, now);
    if (document) inForce[locale] = document;
  }
  return inForce;
}

/**
 * The same for the page's metadata, through the body's last good copies (§281, same keys) and
 * the cache (§333), so head and body agree during an outage. `null` when nothing is remembered.
 */
export async function readLegalDocumentsInForce(key: PublicLegalKey, now: Date): Promise<LegalInForce | null> {
  try {
    const inForce: LegalInForce = {};
    for (const locale of routing.locales) {
      const read = await readWithLastGood(
        `legal:${key}:${locale}`,
        () => cachedCurrentApprovedDocument(key, locale, now),
        now,
      );
      if (read.value) inForce[locale] = read.value;
    }
    return inForce;
  } catch (error) {
    unstable_rethrow(error);
    return null;
  }
}

/** A legal page's head: always its own title, then `noindex` or a self-canonical. */
export function legalPageMetadata({
  baseUrl,
  key,
  locale,
  inForce,
  fallbackTitle,
}: {
  baseUrl: string;
  key: PublicLegalKey;
  locale: Locale;
  inForce: LegalInForce | null;
  /** The document's name from the catalogue, for a page with no approved text to take one from. */
  fallbackTitle: string;
}): Metadata {
  if (!inForce) return { title: fallbackTitle };
  const own = inForce[locale];
  if (!own) return { title: fallbackTitle, robots: { index: false, follow: true } };
  const locales = routing.locales.filter((candidate) => inForce[candidate]);
  return {
    title: own.title,
    robots: { index: true, follow: true },
    alternates: pageAlternates(locale, staticRouteUrls(baseUrl, LEGAL_PAGE_ROUTE[key], locales)),
  };
}
