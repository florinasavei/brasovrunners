import { and, eq } from "drizzle-orm";
import { pages, pageTranslations, type Page } from "@/db/schema/pages";
import type { StaffUser } from "@/db/schema/staff-users";
import { routing } from "@/i18n/routing";
import type { Database } from "@/db/types";
import { textToBody } from "@/modules/legal-documents/domain/body-text";
import {
  allowedTransitions,
  canCreateEvent,
  canEditEventFields,
  canTransition,
  type EditorialStatus,
} from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { pageFieldsSchema, type PageFieldsInput } from "./fields";

/**
 * Standing pages: create, save, publish, delete (BR-REQ-050-03, `DECISIONS.md` §51).
 *
 * ## What it borrows, and why that is not laziness
 *
 * The editorial machinery is `events`': the same `editorial_status` enum, the same
 * `allowedTransitions` and `canTransition`, the same role predicates. "May this person publish"
 * has one answer in this product, and a second copy of that answer for pages is a second place
 * for it to be wrong. `canEditEventFields` and `canCreateEvent` are named for events and read
 * oddly here; renaming them is a change to code that is about to run a real registration window,
 * so it is noted and deliberately not done today.
 *
 * The body converter is the legal-document editor's (`domain/body-text.ts`). Second occurrence,
 * so it is imported rather than generalised — `AGENTS.md` §1.5 abstracts on the third.
 *
 * ## What it does not borrow
 *
 * An event has capacity, a registration block, times and a featured flag, and `saveEventFields`
 * is long because of them. A page has a title, an address and a body in two languages. This
 * file stays short because the thing it manages is small, and it should stay that way: an
 * article type with a cover image and a gallery is M5 and is not this.
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
 * A slug already taken by another page in that locale, reported as a field error.
 *
 * The unique index is the guard; this exists so an organizer gets "that address is taken" naming
 * the field, rather than a driver error. Checked inside the caller's transaction, so a
 * concurrent create still fails on the index rather than slipping past a stale read.
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
  if (!canCreateEvent(input.actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not create a page`);
  }

  const fields = parseOrThrow(input.fields);
  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
    await assertSlugsAreFree(tx, fields, null);

    const [page] = await tx
      .insert(pages)
      .values({
        navOrder: fields.navOrder,
        createdByStaffUserId: input.actor.id,
        updatedByStaffUserId: input.actor.id,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    // Both languages from the start: publication requires every locale to be complete, and a
    // page created in one is a page that discovers that rule at the worst moment.
    await tx.insert(pageTranslations).values(
      routing.locales.map((locale) => ({
        pageId: page.id,
        locale,
        slug: fields.translations[locale].slug,
        title: fields.translations[locale].title,
        bodyJson: textToBody(fields.translations[locale].body),
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
 * One form, one button, one transaction (the rule `DECISIONS.md` §36 established for events).
 *
 * The page row and both translations are written together or not at all, and a stale version on
 * *either* fails the whole save. Two organizers editing one page get a CONFLICT rather than one
 * of them silently losing the English half.
 */
export async function savePage<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Actor; pageId: string; expectedVersion: number; fields: unknown; now?: Date },
): Promise<Page> {
  if (!canEditEventFields(input.actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not edit a page`);
  }

  const fields = parseOrThrow(input.fields);
  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
    await assertSlugsAreFree(tx, fields, input.pageId);

    const [page] = await tx
      .update(pages)
      .set({
        navOrder: fields.navOrder,
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
          bodyJson: textToBody(translation.body),
          seoTitle: translation.seoTitle,
          seoDescription: translation.seoDescription,
          updatedAt: now,
        })
        .where(and(eq(pageTranslations.pageId, input.pageId), eq(pageTranslations.locale, locale)));
    }

    return page;
  });
}

/**
 * Which locales are not ready to be published, and what each is missing.
 *
 * A title and an address are the two a CHECK already guarantees are non-empty; a body is not,
 * because a page may legitimately be drafted title-first. Publishing an empty one, however, puts
 * a blank page on the public site, so the body counts here and not in the column.
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
      const sections = (translation.bodyJson as { sections?: unknown[] } | null)?.sections ?? [];
      if (sections.length === 0) missing.push("body");
      return { locale, missing };
    })
    .filter((entry) => entry.missing.length > 0);
}

export async function transitionPage<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Actor; pageId: string; expectedVersion: number; to: EditorialStatus; now?: Date },
): Promise<Page> {
  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
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

    // AGENTS.md §11.2: both languages go live together, and PUBLISHED is refused while either
    // is incomplete. A page that 404s in English is what BR-REQ-040-02 exists to prevent.
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
        // First publication stamps the date; later ones leave it, because it is what slug
        // stability dates from.
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
}

/**
 * Delete a page outright.
 *
 * Permitted where deleting an event is not, and the difference is what is attached: an event
 * with a registration against it is refused because somebody's entry hangs off it (§15.11).
 * Nothing hangs off a page — no registration, no acceptance, no audit subject — so deleting one
 * made by mistake loses only what its author typed. Archiving remains the answer for a page that
 * was real and is now over.
 */
export async function deletePage<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Actor; pageId: string },
): Promise<void> {
  if (!canEditEventFields(input.actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not delete a page`);
  }

  const [deleted] = await db.delete(pages).where(eq(pages.id, input.pageId)).returning();
  if (!deleted) throw new DomainError("NOT_FOUND", "no such page");
}

export { allowedTransitions };
