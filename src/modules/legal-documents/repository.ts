import { and, desc, eq, lte } from "drizzle-orm";
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
