import { eq } from "drizzle-orm";
import { legalDocuments, legalDocumentTranslations } from "@/db/schema/legal-documents";
import type { LegalDocumentKey } from "@/db/schema/legal-documents";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { canManageStaff } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import {
  computeContentHash,
  type LegalDocumentTranslationInput,
} from "./domain/content-hash";
import { isEmptyBody } from "./domain/body-text";
import { findLatestVersion, listVersionsForBackoffice } from "./repository";

/**
 * Writing legal documents from the backoffice (BR-REQ-053-02, `DECISIONS.md` §46).
 *
 * `AGENTS.md` §12.5 said V1 has no editor screen for these, and the reasoning was sound but
 * over-broad. What must never happen is **editing a version somebody has accepted**: a
 * participant signed version 3, `declaration_acceptances` records that they signed version 3,
 * and rewriting its words afterwards would leave every one of those signatures pointing at text
 * nobody ever agreed to. That is the rule, and nothing here weakens it.
 *
 * What the rule accidentally also prevented was *creating* a version, which put a developer and
 * a migration on the critical path of a decision that is entirely the club's — and left the
 * club's own approved wording as the last thing blocking a real registration. Nothing about
 * immutability requires that.
 *
 * So the shape here is: a version is a **draft** until it is approved, editable only while it is
 * a draft, and frozen the moment it is approved or referenced. Approval is one-way. A correction
 * to approved text is a new version, which is what versioning is for.
 */

/** Only the role that already administers staff may write the club's legal text. */
function assertMayEdit(actor: Pick<StaffUser, "role">): void {
  if (!canManageStaff(actor.role)) {
    throw new DomainError(
      "FORBIDDEN",
      `role ${actor.role} may not write legal documents; they are the club's own commitments`,
    );
  }
}

function assertTranslationsUsable(translations: readonly LegalDocumentTranslationInput[]): void {
  /**
   * Both languages, always.
   *
   * A privacy notice that exists only in Romanian is a page an English reader is asked to accept
   * without being able to read it. BR-REQ-040-02 forbids falling back to the other language, so
   * the alternative to both is not "one for now" — it is a public page that cannot render.
   */
  for (const locale of ["ro", "en"] as const) {
    const translation = translations.find((entry) => entry.locale === locale);
    if (!translation) {
      throw new DomainError("VALIDATION_ERROR", `the ${locale} version is missing`);
    }
    if (translation.title.trim() === "") {
      throw new DomainError("VALIDATION_ERROR", `the ${locale} title is empty`);
    }
    if (isEmptyBody(translation.body)) {
      throw new DomainError("VALIDATION_ERROR", `the ${locale} text is empty`);
    }
  }
}

/**
 * Whether this version may still be written to, and the answer is a fact about the data rather
 * than a permission: approved, accepted by anybody, or pointed at by an event — any one of those
 * and it is history.
 */
async function assertStillADraft<T extends Record<string, unknown>>(
  db: Database<T>,
  versionId: string,
): Promise<void> {
  const rows = await listVersionsForBackoffice(db);
  const row = rows.find((candidate) => candidate.id === versionId);
  if (!row) throw new DomainError("NOT_FOUND", "no such legal document version");

  if (row.isApproved) {
    throw new DomainError(
      "CONFLICT",
      "an approved version cannot be edited; publish a correction as a new version",
    );
  }
  if (row.acceptanceCount > 0 || row.eventCount > 0) {
    throw new DomainError(
      "CONFLICT",
      "this version is already referenced and cannot be edited; create a new version instead",
    );
  }
}

export type SaveDraftInput = {
  key: LegalDocumentKey;
  translations: readonly LegalDocumentTranslationInput[];
};

/**
 * Create the next draft version of one document.
 *
 * The version number is derived rather than chosen: whatever the highest is for this key, plus
 * one. Nobody types a version number, so nobody can reuse one — `UNIQUE(key, version)` would
 * refuse it anyway, and a form that can produce a constraint violation is a form with a trap in
 * it.
 */
export async function createDraftVersion<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  input: SaveDraftInput,
  now: Date,
): Promise<string> {
  assertMayEdit(actor);
  assertTranslationsUsable(input.translations);

  const latest = await findLatestVersion(db, input.key);
  const version = (latest?.version ?? 0) + 1;

  return db.transaction(async (tx) => {
    const [document] = await tx
      .insert(legalDocuments)
      .values({
        key: input.key,
        version,
        // A draft is not in force, and `effective_at` only means anything once it is approved.
        // `now` is a placeholder that approval replaces with the real moment.
        effectiveAt: now,
        isApproved: false,
        contentSha256: computeContentHash(input.translations),
        createdByStaffUserId: actor.id,
        approvedByStaffUserId: null,
        createdAt: now,
      })
      .returning({ id: legalDocuments.id });

    await tx.insert(legalDocumentTranslations).values(
      input.translations.map((translation) => ({
        legalDocumentId: document.id,
        locale: translation.locale,
        title: translation.title.trim(),
        bodyJson: translation.body,
        createdAt: now,
      })),
    );

    return document.id;
  });
}

/**
 * Rewrite a draft in place, hash and all.
 *
 * Replaces the translations rather than patching them: a body is a whole document, and a partial
 * update would leave the stored hash describing text that is no longer there. The hash is
 * recomputed from what is actually saved, every time, so it can never drift from the words.
 */
export async function updateDraftVersion<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  versionId: string,
  translations: readonly LegalDocumentTranslationInput[],
  now: Date,
): Promise<void> {
  assertMayEdit(actor);
  assertTranslationsUsable(translations);
  await assertStillADraft(db, versionId);

  await db.transaction(async (tx) => {
    await tx
      .delete(legalDocumentTranslations)
      .where(eq(legalDocumentTranslations.legalDocumentId, versionId));

    await tx.insert(legalDocumentTranslations).values(
      translations.map((translation) => ({
        legalDocumentId: versionId,
        locale: translation.locale,
        title: translation.title.trim(),
        bodyJson: translation.body,
        createdAt: now,
      })),
    );

    await tx
      .update(legalDocuments)
      // No `updated_at` on this table, and that is not an omission: a row here is written
      // once and approved once, so the timestamps that matter are `created_at` and
      // `effective_at`. A draft being retyped is not an event anybody needs dated.
      .set({ contentSha256: computeContentHash(translations) })
      .where(eq(legalDocuments.id, versionId));
  });
}

/**
 * Approve a draft, which is the moment it becomes the club's word and stops being editable.
 *
 * One-way on purpose. Un-approving would mean a participant could accept a version on Monday
 * that the club treats as never having been in force by Wednesday, and the acceptance row would
 * still say they signed it. A mistake in approved text is corrected the way every other mistake
 * in a versioned document is: by approving the next version.
 */
export async function approveVersion<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  versionId: string,
  now: Date,
): Promise<void> {
  assertMayEdit(actor);
  await assertStillADraft(db, versionId);

  await db
    .update(legalDocuments)
    .set({
      isApproved: true,
      approvedByStaffUserId: actor.id,
      // In force from the moment somebody took responsibility for it, not from whenever the
      // draft happened to be typed.
      effectiveAt: now,
    })
    .where(eq(legalDocuments.id, versionId));
}
