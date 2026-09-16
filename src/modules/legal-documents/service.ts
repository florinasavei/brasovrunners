import { and, eq } from "drizzle-orm";
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
  if (row.acceptanceCount > 0 || row.eventCount > 0 || row.privacyAcknowledgementCount > 0) {
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

  /*
    The result is checked, and that is new.

    This was `UPDATE ... WHERE id = $1` with nothing read back. Until drafts could be deleted a
    `legal_documents` row could not stop existing, so a zero-row update was impossible and
    ignoring the count cost nothing. `deleteDraftVersion` changes that: a draft removed between
    the check above and this statement leaves the update matching nothing, and the action would
    have redirected with "version approved" — telling an Administrator the club's legal text was
    in force when no such row exists. A write on a trust-carrying path reports what it did
    (§1.5).
  */
  const [approved] = await db
    .update(legalDocuments)
    .set({
      isApproved: true,
      approvedByStaffUserId: actor.id,
      // In force from the moment somebody took responsibility for it, not from whenever the
      // draft happened to be typed.
      effectiveAt: now,
    })
    .where(and(eq(legalDocuments.id, versionId), eq(legalDocuments.isApproved, false)))
    .returning({ id: legalDocuments.id });

  if (!approved) {
    throw new DomainError("CONFLICT", "this version changed while it was being approved");
  }
}

/**
 * Everything in the database that depends on this version's words (`DECISIONS.md` §53).
 *
 * Deliberately wider than the two foreign keys. A privacy notice is referenced by *number* from
 * `registrations` — `privacy_notice_version`, `results_consent_version` and
 * `health_consent_version` are all plain integers with no key for PostgreSQL to enforce — so a
 * notice hundreds of people acknowledged is invisible to `acceptanceCount` and `eventCount`
 * alike, and the database would raise nothing at all if it were removed. Only
 * `EVENT_DECLARATION` versions ever get a `declaration_acceptances` row; this is what stands in
 * for it on the other key.
 */
export type VersionReliance = {
  acceptances: number;
  events: number;
  privacyAcknowledgements: number;
};

export function isReliedOn(reliance: VersionReliance): boolean {
  return reliance.acceptances > 0 || reliance.events > 0 || reliance.privacyAcknowledgements > 0;
}

/**
 * Delete a version that was never approved (BR-REQ-053-02, `DECISIONS.md` §53).
 *
 * The whole of the new freedom, and narrow on purpose. A draft has never been in force: no
 * public page has rendered it, because `findCurrentApprovedDocument` filters on `is_approved`;
 * no registration can have recorded its number, because a registration records whatever was
 * current; and no acceptance can name it, for the same reason. Nothing can have relied on it,
 * so nothing is lost by removing it — and without this the club's list of legal documents grew
 * by a row every time somebody started typing and thought better of it, with no way back.
 *
 * **An approved version is never deleted**, whatever its counts say, and that is not the same
 * rule as "nothing relies on it". Approval is the club publishing words as its own; the record
 * of what it published, and when, outlives whether anybody happened to act on it. §46's freeze
 * stands untouched for every version that was ever in force.
 *
 * The two translations go with it (`ON DELETE cascade`), which is right: a body belongs to its
 * version and means nothing apart from it.
 */
export async function deleteDraftVersion<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  versionId: string,
): Promise<void> {
  assertMayEdit(actor);

  const rows = await listVersionsForBackoffice(db);
  const row = rows.find((candidate) => candidate.id === versionId);
  if (!row) throw new DomainError("NOT_FOUND", "no such legal document version");

  if (row.isApproved) {
    throw new DomainError(
      "CONFLICT",
      "an approved version cannot be deleted; its words are part of what the club has published",
    );
  }
  if (
    isReliedOn({
      acceptances: row.acceptanceCount,
      events: row.eventCount,
      privacyAcknowledgements: row.privacyAcknowledgementCount,
    })
  ) {
    throw new DomainError("CONFLICT", "this version is referenced and cannot be deleted");
  }

  /*
    `is_approved = false` again in the `WHERE`, because the read above is not in this
    statement's transaction and an approval can land between the two. Without it the delete
    would race an approval and win; with it the delete simply matches nothing and says so.
    That is also what keeps a raw foreign-key violation from reaching an organizer, which
    §14.3 forbids.
  */
  const [deleted] = await db
    .delete(legalDocuments)
    .where(and(eq(legalDocuments.id, versionId), eq(legalDocuments.isApproved, false)))
    .returning({ id: legalDocuments.id });

  if (!deleted) {
    throw new DomainError("CONFLICT", "this version was approved while it was being deleted");
  }
}
