import { and, desc, eq, lte, sql } from "drizzle-orm";
import { declarationAcceptances } from "@/db/schema/declaration-acceptances";
import { events } from "@/db/schema/events";
import {
  legalDocumentTranslations,
  legalDocuments,
  type LegalDocumentKey,
} from "@/db/schema/legal-documents";
import type { Database } from "@/db/types";
import type { Locale } from "@/i18n/routing";
import type { LegalDocumentTranslationInput } from "./domain/content-hash";

/**
 * Reading and writing `legal_documents`/`legal_document_translations` (AGENTS.md §12.5).
 *
 * There is no update function here, on purpose. A version referenced by an acceptance is
 * immutable (§12.5), and nothing in this module ever changes a row once inserted — the only
 * writers are `service.ts`'s seed path and, eventually, whoever authors the migration that
 * records the club's real approved wording. There is no path from a request handler to a write
 * here at all, which is what makes "no CMS screen edits legal text" true structurally rather
 * than by review.
 */

export type CurrentLegalDocument = {
  id: string;
  key: LegalDocumentKey;
  version: number;
  effectiveAt: Date;
  contentSha256: string;
  locale: Locale;
  title: string;
  body: unknown;
};

/**
 * The version of `key` that is current for `locale` at `now` — the highest `version` that is
 * approved and whose `effective_at` has passed (§12.5: "resolved by `effective_at`").
 *
 * Used both by the public legal routes and by registration (BR-REQ-053-01: registration
 * refuses when this returns nothing).
 */
export async function findCurrentApprovedDocument<T extends Record<string, unknown>>(
  db: Database<T>,
  key: LegalDocumentKey,
  locale: Locale,
  now: Date,
): Promise<CurrentLegalDocument | undefined> {
  const [row] = await db
    .select({
      id: legalDocuments.id,
      key: legalDocuments.key,
      version: legalDocuments.version,
      effectiveAt: legalDocuments.effectiveAt,
      contentSha256: legalDocuments.contentSha256,
      title: legalDocumentTranslations.title,
      body: legalDocumentTranslations.bodyJson,
    })
    .from(legalDocuments)
    .innerJoin(
      legalDocumentTranslations,
      and(
        eq(legalDocumentTranslations.legalDocumentId, legalDocuments.id),
        eq(legalDocumentTranslations.locale, locale),
      ),
    )
    .where(
      and(
        eq(legalDocuments.key, key),
        eq(legalDocuments.isApproved, true),
        lte(legalDocuments.effectiveAt, now),
      ),
    )
    .orderBy(desc(legalDocuments.version))
    .limit(1);

  return row ? { ...row, locale } : undefined;
}

/**
 * A specific version, for confirming a registration's acknowledged version is still the exact
 * text it was shown (BR-REQ-053-01 criterion 3: an acceptance references the version accepted,
 * not merely "whatever is current now").
 */
export async function findApprovedDocumentVersion<T extends Record<string, unknown>>(
  db: Database<T>,
  key: LegalDocumentKey,
  version: number,
): Promise<Pick<CurrentLegalDocument, "id" | "key" | "version" | "contentSha256"> | undefined> {
  const [row] = await db
    .select({
      id: legalDocuments.id,
      key: legalDocuments.key,
      version: legalDocuments.version,
      contentSha256: legalDocuments.contentSha256,
    })
    .from(legalDocuments)
    .where(and(eq(legalDocuments.key, key), eq(legalDocuments.version, version), eq(legalDocuments.isApproved, true)))
    .limit(1);

  return row;
}

/**
 * The highest version of a key, whatever its approval state — what "the next version" counts
 * from. A version number is never reused (`docs/RUNBOOKS.md` § Legal document version), so this
 * is the only safe way to ask for one.
 */
export async function findLatestVersion<T extends Record<string, unknown>>(
  db: Database<T>,
  key: LegalDocumentKey,
): Promise<{ id: string; version: number; contentSha256: string } | undefined> {
  const [row] = await db
    .select({
      id: legalDocuments.id,
      version: legalDocuments.version,
      contentSha256: legalDocuments.contentSha256,
    })
    .from(legalDocuments)
    .where(eq(legalDocuments.key, key))
    .orderBy(desc(legalDocuments.version))
    .limit(1);
  return row;
}

/**
 * Every approved version of a key, newest first, with its title in one locale — what the event
 * editor offers when an organizer picks the declaration a participant will sign.
 *
 * A *selection*, never an edit: §11.1 keeps legal text out of the CMS entirely, and nothing
 * here or in the editor can change a word of one of these rows.
 */
export async function listApprovedVersions<T extends Record<string, unknown>>(
  db: Database<T>,
  key: LegalDocumentKey,
  locale: Locale,
): Promise<Array<{ id: string; version: number; title: string; effectiveAt: Date }>> {
  return db
    .select({
      id: legalDocuments.id,
      version: legalDocuments.version,
      title: legalDocumentTranslations.title,
      effectiveAt: legalDocuments.effectiveAt,
    })
    .from(legalDocuments)
    .innerJoin(
      legalDocumentTranslations,
      and(
        eq(legalDocumentTranslations.legalDocumentId, legalDocuments.id),
        eq(legalDocumentTranslations.locale, locale),
      ),
    )
    .where(and(eq(legalDocuments.key, key), eq(legalDocuments.isApproved, true)))
    .orderBy(desc(legalDocuments.version));
}

/**
 * Every version of every key, for the backoffice — approved or not, with both locales'
 * titles and a count of the registrations that already reference it.
 *
 * The reference count is the whole reason this exists rather than `listApprovedVersions`.
 * §12.5 makes a referenced version immutable, and a screen that shows the text without
 * showing whether anybody has signed against it invites exactly the edit that rule forbids.
 * Reading it here means the answer is a fact on the page, not a warning in a document.
 */
export type LegalDocumentVersionRow = {
  id: string;
  key: LegalDocumentKey;
  version: number;
  isApproved: boolean;
  effectiveAt: Date;
  approvedByStaffUserId: string | null;
  locales: string[];
  acceptanceCount: number;
  eventCount: number;
};

export async function listVersionsForBackoffice<T extends Record<string, unknown>>(
  db: Database<T>,
): Promise<LegalDocumentVersionRow[]> {
  const rows = await db
    .select({
      id: legalDocuments.id,
      key: legalDocuments.key,
      version: legalDocuments.version,
      isApproved: legalDocuments.isApproved,
      effectiveAt: legalDocuments.effectiveAt,
      approvedByStaffUserId: legalDocuments.approvedByStaffUserId,
      locales: sql<string[]>`coalesce(array_agg(distinct ${legalDocumentTranslations.locale}::text) filter (where ${legalDocumentTranslations.locale} is not null), '{}')`,
      acceptanceCount: sql<number>`(select count(*)::int from ${declarationAcceptances} where ${declarationAcceptances.legalDocumentId} = ${legalDocuments.id})`,
      eventCount: sql<number>`(select count(*)::int from ${events} where ${events.declarationDocumentId} = ${legalDocuments.id})`,
    })
    .from(legalDocuments)
    .leftJoin(
      legalDocumentTranslations,
      eq(legalDocumentTranslations.legalDocumentId, legalDocuments.id),
    )
    .groupBy(legalDocuments.id)
    .orderBy(legalDocuments.key, desc(legalDocuments.version));

  return rows;
}

/**
 * One version's text in every locale it has, for reading in the backoffice.
 *
 * Approved or not: an unapproved draft is exactly what somebody needs to look at before
 * approving it, and refusing to render one would make the approval a decision taken blind.
 */
export async function findVersionWithTranslations<T extends Record<string, unknown>>(
  db: Database<T>,
  id: string,
): Promise<
  | {
      id: string;
      key: LegalDocumentKey;
      version: number;
      isApproved: boolean;
      effectiveAt: Date;
      contentSha256: string;
      translations: Array<{ locale: string; title: string; body: unknown }>;
    }
  | undefined
> {
  const [document] = await db
    .select({
      id: legalDocuments.id,
      key: legalDocuments.key,
      version: legalDocuments.version,
      isApproved: legalDocuments.isApproved,
      effectiveAt: legalDocuments.effectiveAt,
      contentSha256: legalDocuments.contentSha256,
    })
    .from(legalDocuments)
    .where(eq(legalDocuments.id, id))
    .limit(1);

  if (!document) return undefined;

  const translations = await db
    .select({
      locale: legalDocumentTranslations.locale,
      title: legalDocumentTranslations.title,
      body: legalDocumentTranslations.bodyJson,
    })
    .from(legalDocumentTranslations)
    .where(eq(legalDocumentTranslations.legalDocumentId, id))
    .orderBy(legalDocumentTranslations.locale);

  return { ...document, translations };
}
export async function insertLegalDocumentVersion<T extends Record<string, unknown>>(
  db: Database<T>,
  input: {
    key: LegalDocumentKey;
    version: number;
    effectiveAt: Date;
    isApproved: boolean;
    contentSha256: string;
    translations: readonly LegalDocumentTranslationInput[];
    createdByStaffUserId?: string | null;
    approvedByStaffUserId?: string | null;
    now: Date;
  },
): Promise<string> {
  return db.transaction(async (tx) => {
    const [document] = await tx
      .insert(legalDocuments)
      .values({
        key: input.key,
        version: input.version,
        effectiveAt: input.effectiveAt,
        isApproved: input.isApproved,
        contentSha256: input.contentSha256,
        createdByStaffUserId: input.createdByStaffUserId ?? null,
        approvedByStaffUserId: input.approvedByStaffUserId ?? null,
        createdAt: input.now,
      })
      .returning({ id: legalDocuments.id });

    await tx.insert(legalDocumentTranslations).values(
      input.translations.map((translation) => ({
        legalDocumentId: document.id,
        locale: translation.locale,
        title: translation.title,
        bodyJson: translation.body,
        createdAt: input.now,
      })),
    );

    return document.id;
  });
}
