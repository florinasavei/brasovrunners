import { and, asc, eq, inArray } from "drizzle-orm";
import { pages, pageTranslations } from "@/db/schema/pages";
import type { Database } from "@/db/types";
import type { Locale } from "@/i18n/routing";

export type { Database };

/**
 * Standing pages (BR-REQ-050-03). Public reads use `PUBLIC_COLUMNS` and a `PUBLISHED` filter here,
 * so no route can forget it.
 */

const PUBLIC_COLUMNS = {
  id: pages.id,
  navOrder: pages.navOrder,
  publishedAt: pages.publishedAt,
  locale: pageTranslations.locale,
  slug: pageTranslations.slug,
  title: pageTranslations.title,
  bodyJson: pageTranslations.bodyJson,
  seoTitle: pageTranslations.seoTitle,
  seoDescription: pageTranslations.seoDescription,
  updatedAt: pageTranslations.updatedAt,
};

export type PublicPage = {
  id: string;
  navOrder: number;
  publishedAt: Date | null;
  locale: string;
  slug: string;
  title: string;
  bodyJson: unknown;
  seoTitle: string | null;
  seoDescription: string | null;
  updatedAt: Date;
};

/** One published page by its locale's slug; no fallback to the other language (BR-REQ-040-02). */
export async function findPublishedPageBySlug<T extends Record<string, unknown>>(
  db: Database<T>,
  locale: Locale,
  slug: string,
): Promise<PublicPage | undefined> {
  const [row] = await db
    .select(PUBLIC_COLUMNS)
    .from(pages)
    .innerJoin(pageTranslations, eq(pageTranslations.pageId, pages.id))
    .where(
      and(
        eq(pages.editorialStatus, "PUBLISHED"),
        eq(pageTranslations.locale, locale),
        eq(pageTranslations.slug, slug),
      ),
    )
    .limit(1);

  return row;
}

/**
 * Every published page in this locale, in the old «Ordinea» column's order — the fallback the
 * menu's one order (§571) gives a page it does not name yet, and the backoffice list's own order
 * (`listPagesForAdmin`): the number, then the date it was written. It was the title after the
 * number, which sorted two equal numbers differently in each language. For nav and sitemap.
 */
export async function listPublishedPages<T extends Record<string, unknown>>(
  db: Database<T>,
  locale: Locale,
): Promise<PublicPage[]> {
  return db
    .select(PUBLIC_COLUMNS)
    .from(pages)
    .innerJoin(pageTranslations, eq(pageTranslations.pageId, pages.id))
    .where(and(eq(pages.editorialStatus, "PUBLISHED"), eq(pageTranslations.locale, locale)))
    .orderBy(asc(pages.navOrder), asc(pages.createdAt), asc(pages.id));
}

export type PageListRow = {
  id: string;
  editorialStatus: string;
  /** For publish/unpublish from the list (§256). */
  version: number;
  navOrder: number;
  title: string | null;
  slug: string | null;
  updatedAt: Date;
};

/** Every page, whatever its status — the backoffice list. */
export async function listPagesForAdmin<T extends Record<string, unknown>>(
  db: Database<T>,
  locale: Locale,
): Promise<PageListRow[]> {
  return db
    .select({
      id: pages.id,
      editorialStatus: pages.editorialStatus,
      // The transition refuses a stale version (§256).
      version: pages.version,
      navOrder: pages.navOrder,
      title: pageTranslations.title,
      slug: pageTranslations.slug,
      updatedAt: pages.updatedAt,
    })
    .from(pages)
    .leftJoin(
      pageTranslations,
      and(eq(pageTranslations.pageId, pages.id), eq(pageTranslations.locale, locale)),
    )
    .orderBy(asc(pages.navOrder), asc(pages.createdAt), asc(pages.id));
}

/** One page and every translation it has, for the editor. */
export async function findPageForEditor<T extends Record<string, unknown>>(db: Database<T>, id: string) {
  const [page] = await db.select().from(pages).where(eq(pages.id, id)).limit(1);
  if (!page) return undefined;

  const translations = await db
    .select()
    .from(pageTranslations)
    .where(eq(pageTranslations.pageId, id));

  return { page, translations };
}

/** A published page's locales and slugs, for `hreflang` (§342); nothing for a draft. */
export async function findPublishedPageTranslations<T extends Record<string, unknown>>(
  db: Database<T>,
  pageId: string,
): Promise<Array<{ locale: Locale; slug: string }>> {
  return db
    .select({ locale: pageTranslations.locale, slug: pageTranslations.slug })
    .from(pageTranslations)
    .innerJoin(pages, eq(pages.id, pageTranslations.pageId))
    .where(and(eq(pageTranslations.pageId, pageId), eq(pages.editorialStatus, "PUBLISHED")));
}

/** The same for many pages in one query — the sitemap's (§342). */
export async function findPublishedPageTranslationsForPages<T extends Record<string, unknown>>(
  db: Database<T>,
  pageIds: readonly string[],
): Promise<Array<{ pageId: string; locale: Locale; slug: string }>> {
  if (pageIds.length === 0) return [];
  return db
    .select({ pageId: pageTranslations.pageId, locale: pageTranslations.locale, slug: pageTranslations.slug })
    .from(pageTranslations)
    .innerJoin(pages, eq(pages.id, pageTranslations.pageId))
    .where(and(inArray(pageTranslations.pageId, pageIds as string[]), eq(pages.editorialStatus, "PUBLISHED")));
}

/** The page's slug in the other language, published only (BR-REQ-040-01 criterion 5). */
export async function findPublishedPageSiblingSlug<T extends Record<string, unknown>>(
  db: Database<T>,
  pageId: string,
  locale: Locale,
): Promise<string | undefined> {
  const [row] = await db
    .select({ slug: pageTranslations.slug })
    .from(pages)
    .innerJoin(pageTranslations, eq(pageTranslations.pageId, pages.id))
    .where(
      and(
        eq(pages.id, pageId),
        eq(pages.editorialStatus, "PUBLISHED"),
        eq(pageTranslations.locale, locale),
      ),
    )
    .limit(1);

  return row?.slug;
}
