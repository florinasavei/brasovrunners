import { and, asc, eq } from "drizzle-orm";
import { pages, pageTranslations } from "@/db/schema/pages";
import type { Database } from "@/db/types";
import type { Locale } from "@/i18n/routing";

export type { Database };

/**
 * Reading and writing standing pages (BR-REQ-050-03).
 *
 * The public reads go through `PUBLIC_COLUMNS` and a `PUBLISHED` filter, exactly as
 * `modules/events/repository.ts` does — a draft is not a page a visitor can reach by guessing
 * its address, and the filter lives here rather than in a route so it cannot be forgotten by
 * the next route that needs a page.
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

/**
 * One published page by its locale-scoped slug, or undefined when it should 404.
 *
 * BR-REQ-040-02: a locale with no translation is a 404 and never the other language's text, so
 * the join is on this locale's row and nothing falls back.
 */
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

/** Every published page in this locale, in the order the club put them in. For nav and sitemap. */
export async function listPublishedPages<T extends Record<string, unknown>>(
  db: Database<T>,
  locale: Locale,
): Promise<PublicPage[]> {
  return db
    .select(PUBLIC_COLUMNS)
    .from(pages)
    .innerJoin(pageTranslations, eq(pageTranslations.pageId, pages.id))
    .where(and(eq(pages.editorialStatus, "PUBLISHED"), eq(pageTranslations.locale, locale)))
    .orderBy(asc(pages.navOrder), asc(pageTranslations.title));
}

export type PageListRow = {
  id: string;
  editorialStatus: string;
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
    .orderBy(asc(pages.navOrder), asc(pages.createdAt));
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

/**
 * The same page's address in the other language (BR-REQ-040-01 criterion 5).
 *
 * Published only: switching language must not reveal a draft, and a page whose other locale is
 * unpublished cannot happen while publication requires both — but this does not rely on that.
 */
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
