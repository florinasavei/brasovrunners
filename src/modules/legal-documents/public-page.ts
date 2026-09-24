import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { cachedCurrentApprovedDocument } from "@/modules/public-cache/reads";
import { readWithLastGood } from "@/modules/resilience/last-good";
import { pageAlternates, staticRouteUrls } from "@/modules/seo/alternates";
import type { CurrentLegalDocument } from "./repository";

/**
 * The two legal texts a visitor can read, and what search engines are told about them (§342).
 *
 * The page never 404s (`legal/privacy/page.tsx` says why), so "does it exist in this language"
 * is not the route's question — it is whether an approved version is in force there. Before
 * the club approved its texts, `/ro/termeni` and `/ro/confidentialitate` were one page twice:
 * the same "not published yet" notice under the same default title, neither declaring a
 * canonical — what Search Console calls a duplicate without a user-selected canonical — and
 * the English pair still is wherever no English version is approved. So a page without a text
 * is `noindex` and advertises nothing, and a page with one is its own canonical, with hreflang
 * only to the languages that have a text too.
 */

/** The legal documents that have a public page; the declaration is signed, never browsed. */
export type PublicLegalKey = "TERMS" | "PRIVACY_NOTICE";

/** Where each one lives — the internal route, localized by `getPathname`. */
export const LEGAL_PAGE_ROUTE = { TERMS: "/legal/terms", PRIVACY_NOTICE: "/legal/privacy" } as const;

/** The version in force in each locale that has one. */
export type LegalInForce = Partial<Record<Locale, Pick<CurrentLegalDocument, "title" | "effectiveAt">>>;

/**
 * One read per locale — what the sitemap lists. Through the public cache (§333), the page body's
 * own read, keyed by the stretch between effective dates: a crawler fetching the sitemap wakes the
 * database no more than a visitor reading the notice does.
 */
export async function legalDocumentsInForce(key: PublicLegalKey, now: Date): Promise<LegalInForce> {
  const inForce: LegalInForce = {};
  for (const locale of routing.locales) {
    const document = await cachedCurrentApprovedDocument(key, locale, now);
    if (document) inForce[locale] = document;
  }
  return inForce;
}

/**
 * The same, for the page's own metadata: read through the page's own last good copies
 * (§281, the same keys the page body reads) and the same cached read (§333), so the head and
 * the body agree during an outage and neither wakes the database for every visitor. `null` when the database is away and nothing is remembered — the metadata then
 * says nothing about alternates rather than guessing.
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

/**
 * The head of a legal page in `locale`: its own title always (so the two pages never read as
 * one), and then either `noindex` — no text in force here — or a self-canonical with the
 * languages that have a text.
 */
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
