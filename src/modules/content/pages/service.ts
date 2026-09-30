import { and, eq, max } from "drizzle-orm";
import { pages, pageTranslations, type Page } from "@/db/schema/pages";
import type { StaffUser } from "@/db/schema/staff-users";
import { routing } from "@/i18n/routing";
import type { Database } from "@/db/types";
import { isRichTextEmpty, readRichText } from "@/modules/content/rich-text/domain/schema";
import { attachYoutubePosters } from "@/modules/media/video-poster";
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import {
  allowedTransitions,
  canCreatePage,
  isEditorial,
  canEditTexts,
  canTransition,
  type EditorialStatus,
} from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { pageFieldsSchema, type PageFieldsInput } from "./fields";

/**
 * Standing pages: create, save, publish, delete (BR-REQ-050-03, `DECISIONS.md` §51).
 * Reuses the events' editorial status, transitions and role predicates, so "may this person
 * publish" has one answer.
 */

type Actor = Pick<StaffUser, "id" | "role">;

function parseOrThrow(value: unknown): PageFieldsInput {
  const parsed = pageFieldsSchema.safeParse(value);
  if (!parsed.success) {
    throw new DomainError(
      "VALIDATION_ERROR",
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      [...new Set(parsed.error.issues.map((issue) => issue.path.join(".")))],
    );
  }
  return parsed.data;
}

/**
 * A slug taken by another page in that locale, as a field error. The unique index is the real
 * guard; this only names the field instead of surfacing a driver error.
 */
async function assertSlugsAreFree<T extends Record<string, unknown>>(
  db: Database<T>,
  fields: PageFieldsInput,
  exceptPageId: string | null,
): Promise<void> {
  for (const locale of routing.locales) {
    const [taken] = await db
      .select({ pageId: pageTranslations.pageId })
      .from(pageTranslations)
      .where(
        and(
          eq(pageTranslations.locale, locale),
          eq(pageTranslations.slug, fields.translations[locale].slug),
        ),
      )
      .limit(1);

    if (taken && taken.pageId !== exceptPageId) {
      throw new DomainError("VALIDATION_ERROR", `the ${locale} page address is already in use`, [
        `translations.${locale}.slug`,
      ]);
    }
  }
}

export async function createPage<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Actor; fields: unknown; now?: Date },
): Promise<Page> {
  if (!canCreatePage(input.actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not create a page`);
  }

  const fields = parseOrThrow(input.fields);
  const now = input.now ?? new Date();
  // Film posters (§403) are fetched before the transaction opens: a network call.
  for (const locale of routing.locales) {
    fields.translations[locale].body = await attachYoutubePosters(db, fields.translations[locale].body);
  }

  return db.transaction(async (tx) => {
    await assertSlugsAreFree(tx, fields, null);

    /*
      After every page there is (§571). The menu's place is «Ordinea meniului»'s, where a page the
      stored order does not name yet falls to the end, by this number and then its date: so a new
      page is last until the club moves it, never first because it started at 0.
    */
    const [{ last }] = await tx.select({ last: max(pages.navOrder) }).from(pages);

    const [page] = await tx
      .insert(pages)
      .values({
        navOrder: (last ?? 0) + 1,
        createdByStaffUserId: input.actor.id,
        updatedByStaffUserId: input.actor.id,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    // Both languages from the start: publication requires every locale (§28).
    await tx.insert(pageTranslations).values(
      routing.locales.map((locale) => ({
        pageId: page.id,
        locale,
        slug: fields.translations[locale].slug,
        title: fields.translations[locale].title,
        bodyJson: fields.translations[locale].body,
        seoTitle: fields.translations[locale].seoTitle,
        seoDescription: fields.translations[locale].seoDescription,
        authorStaffUserId: input.actor.id,
        createdAt: now,
        updatedAt: now,
      })),
    );

    return page;
  });
}

/**
 * The page row and both translations in one transaction; a stale version fails the whole save
 * with CONFLICT (§36).
 */
export async function savePage<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Actor; pageId: string; expectedVersion: number; fields: unknown; now?: Date },
): Promise<Page> {
  // Words (§103): the copywriter's. The slug of a live page is refused below regardless of role.
  if (!canEditTexts(input.actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not edit a page`);
  }

  const fields = parseOrThrow(input.fields);
  const now = input.now ?? new Date();
  for (const locale of routing.locales) {
    fields.translations[locale].body = await attachYoutubePosters(db, fields.translations[locale].body);
  }

  const saved = await db.transaction(async (tx) => {
    await assertSlugsAreFree(tx, fields, input.pageId);

    const [page] = await tx
      .update(pages)
      .set({
        updatedByStaffUserId: input.actor.id,
        version: input.expectedVersion + 1,
        updatedAt: now,
      })
      .where(and(eq(pages.id, input.pageId), eq(pages.version, input.expectedVersion)))
      .returning();

    if (!page) {
      const [current] = await tx.select().from(pages).where(eq(pages.id, input.pageId)).limit(1);
      if (!current) throw new DomainError("NOT_FOUND", "no such page");
      throw new DomainError(
        "CONFLICT",
        `this page was saved by someone else: you loaded version ${input.expectedVersion}, the current version is ${current.version}`,
      );
    }

    for (const locale of routing.locales) {
      const translation = fields.translations[locale];
      await tx
        .update(pageTranslations)
        .set({
          slug: translation.slug,
          title: translation.title,
          bodyJson: translation.body,
          seoTitle: translation.seoTitle,
          seoDescription: translation.seoDescription,
          updatedAt: now,
        })
        .where(and(eq(pageTranslations.pageId, input.pageId), eq(pageTranslations.locale, locale)));
    }

    return page;
  });
  revalidatePublicContent("pages");
  return saved;
}

/**
 * Which locales are not ready to be published, and what each is missing. The body may be empty
 * in a draft (no CHECK), but not on publish.
 */
export function describeIncompletePageLocales(
  translations: readonly { locale: string; title: string; bodyJson: unknown }[],
): Array<{ locale: string; missing: string[] }> {
  return routing.locales
    .map((locale) => {
      const translation = translations.find((row) => row.locale === locale);
      if (!translation) return { locale, missing: ["translation"] };

      const missing: string[] = [];
      if (translation.title.trim() === "") missing.push("title");
      // The same reader the page renders with, so "complete" means "shows something".
      if (isRichTextEmpty(readRichText(translation.bodyJson))) missing.push("body");
      return { locale, missing };
    })
    .filter((entry) => entry.missing.length > 0);
}

export async function transitionPage<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Actor; pageId: string; expectedVersion: number; to: EditorialStatus; now?: Date },
): Promise<Page> {
  const now = input.now ?? new Date();

  const moved = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(pages).where(eq(pages.id, input.pageId)).limit(1);
    if (!current) throw new DomainError("NOT_FOUND", "no such page");

    const translations = await tx
      .select()
      .from(pageTranslations)
      .where(eq(pageTranslations.pageId, input.pageId));

    const isOwnDraft = translations.some((row) => row.authorStaffUserId === input.actor.id);
    if (!canTransition(input.actor.role, current.editorialStatus, input.to, isOwnDraft)) {
      throw new DomainError(
        "FORBIDDEN",
        `role ${input.actor.role} may not move a page from ${current.editorialStatus} to ${input.to}`,
      );
    }

    // Both languages go live together (AGENTS.md §11.2, BR-REQ-040-02).
    if (input.to === "PUBLISHED") {
      const incomplete = describeIncompletePageLocales(translations);
      if (incomplete.length > 0) {
        throw new DomainError(
          "VALIDATION_ERROR",
          `every language must be complete before publishing: ${incomplete
            .map((entry) => `${entry.locale} is missing ${entry.missing.join(", ")}`)
            .join("; ")}`,
        );
      }
    }

    const [updated] = await tx
      .update(pages)
      .set({
        editorialStatus: input.to,
        // Only the first publication stamps the date.
        publishedAt: input.to === "PUBLISHED" ? (current.publishedAt ?? now) : current.publishedAt,
        updatedByStaffUserId: input.actor.id,
        version: input.expectedVersion + 1,
        updatedAt: now,
      })
      .where(and(eq(pages.id, input.pageId), eq(pages.version, input.expectedVersion)))
      .returning();

    if (!updated) {
      throw new DomainError(
        "CONFLICT",
        `this page was saved by someone else: you loaded version ${input.expectedVersion}, the current version is ${current.version}`,
      );
    }

    return updated;
  });
  revalidatePublicContent("pages");
  return moved;
}

/**
 * Delete a page outright. Unlike an event, nothing (registration, acceptance, audit subject)
 * hangs off a page.
 */
export async function deletePage<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Actor; pageId: string },
): Promise<void> {
  if (!isEditorial(input.actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not delete a page`);
  }

  const [deleted] = await db.delete(pages).where(eq(pages.id, input.pageId)).returning();
  if (!deleted) throw new DomainError("NOT_FOUND", "no such page");
  revalidatePublicContent("pages");
}

export { allowedTransitions };
