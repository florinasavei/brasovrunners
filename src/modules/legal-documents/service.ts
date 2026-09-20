import { and, eq, isNull } from "drizzle-orm";
import { legalDocuments, legalDocumentTranslations } from "@/db/schema/legal-documents";
import type { LegalDocumentKey } from "@/db/schema/legal-documents";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import type { Locale } from "@/i18n/routing";
import { recordAuditEvent } from "@/modules/audit/repository";
import { canManageStaff } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import {
  computeContentHash,
  isLegalDocumentBody,
  type LegalDocumentTranslationInput,
} from "./domain/content-hash";
import { isEmptyBody } from "./domain/body-text";
import {
  findCurrentApprovedDocument,
  findCurrentApprovedVersionId,
  findLatestVersion,
  findVersionWithTranslations,
  type LegalDocumentVersionRow,
  listVersionsForBackoffice,
} from "./repository";
import { LEGAL_TEMPLATES } from "./templates/catalogue";
import { type ClubFacts, fillClubFacts, remainingPlaceholders } from "./templates/club-facts";

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

/**
 * Everything withdrawal requires, asked as one question (`DECISIONS.md` §46, §53).
 *
 * Called twice per withdrawal — once outside the transaction so the screen gets a sentence
 * naming the actual obstacle, and once inside it so the decision is taken on rows nothing can
 * have changed underneath. Two calls of the same function rather than a cheap check and a
 * thorough one, because a guard that differs between the two is a guard that can be talked past.
 */
async function assertWithdrawable<T extends Record<string, unknown>>(
  db: Database<T>,
  versionId: string,
  now: Date,
): Promise<LegalDocumentVersionRow> {
  const rows = await listVersionsForBackoffice(db);
  const row = rows.find((candidate) => candidate.id === versionId);
  if (!row) throw new DomainError("NOT_FOUND", "no such legal document version");

  if (!row.isApproved) {
    throw new DomainError(
      "CONFLICT",
      "a draft was never in force, so there is nothing to withdraw; delete it instead",
    );
  }
  if (row.withdrawnAt) {
    throw new DomainError("CONFLICT", "this version has already been withdrawn");
  }
  if (
    isReliedOn({
      acceptances: row.acceptanceCount,
      events: row.eventCount,
      privacyAcknowledgements: row.privacyAcknowledgementCount,
    })
  ) {
    throw new DomainError(
      "CONFLICT",
      "somebody has relied on this version; it stays exactly where it is",
    );
  }

  /*
    And the one a count cannot see: the version the site is serving right now.

    Zero signatures is not "unused" for a notice — it is what the notice of a quiet week looks
    like, while every visitor to /legal/privacy is reading it. Withdrawing the version in force
    would take the club's privacy notice off the public site and, per BR-REQ-053-01, stop every
    registration in the same instant. The successor is approved first; then this one is free.
  */
  const inForce = await findCurrentApprovedVersionId(db, row.key, now);
  if (inForce === versionId) {
    throw new DomainError(
      "CONFLICT",
      "this version is the one currently in force; approve its successor before withdrawing it",
    );
  }

  return row;
}

/**
 * Take an approved version out of circulation without taking it out of the record
 * (BR-REQ-053-02, `DECISIONS.md` §46, §53).
 *
 * The owner asked to be able to delete an approved document, and the answer is *almost* yes.
 * §46 and `AGENTS.md` §12.5 say an approved version is never deleted, and underneath the
 * principle there is an arithmetic hazard that makes the principle load-bearing:
 * `registrations.privacy_notice_version` is a plain integer with no foreign key, and
 * `createDraftVersion` takes `max(version) + 1`. Delete version 4 and the next draft is version
 * 4 again — with different words. Every registration that recorded "privacy notice 4" would
 * then be a consent to text nobody showed anybody, and nothing in the database would notice.
 *
 * Withdrawal keeps the row, the number and the words, and removes only the offering: after this
 * the version is not resolved as current, not offered to the event editor, not counted as "this
 * key already has approved text", and not shown on the club's list unless the club asks for it.
 * What it can never do is remove something that was relied on, or the text the site is serving
 * at this moment — `assertWithdrawable` above is the whole of that rule.
 *
 * The audit row goes in first, and in the same transaction, so the fact of the version survives
 * the change of state: the key, the number, the date it took effect, who approved it and the
 * hash of each language's text. If the guarded update then matches nothing — somebody withdrew
 * it in another tab — the transaction rolls back and takes the audit row with it, because a
 * trail that records changes which did not happen is worse than no trail.
 */
export async function withdrawApprovedVersion<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  versionId: string,
  now: Date,
): Promise<void> {
  assertMayEdit(actor);
  await assertWithdrawable(db, versionId, now);

  await db.transaction(async (tx) => {
    const row = await assertWithdrawable(tx, versionId, now);
    const document = await findVersionWithTranslations(tx, versionId);

    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "legal_document.withdrawn",
      entityType: "legal_document",
      entityId: versionId,
      /*
        The shape of what was withdrawn, never the text of it (§12.12). A title is the club's
        own name for its own document, which is what makes the row readable a year later; the
        body is the thing §12.12 forbids copying, and the hash stands in for it — the same hash
        the version's own `content_sha256` is computed with, so the words can be checked against
        this row rather than described by it.
      */
      metadata: {
        documentKey: row.key,
        version: row.version,
        effectiveAt: row.effectiveAt.toISOString(),
        approvedByStaffUserId: row.approvedByStaffUserId,
        contentSha256: document?.contentSha256 ?? null,
        translations: (document?.translations ?? []).map((translation) => ({
          locale: translation.locale,
          title: translation.title,
          contentSha256: isLegalDocumentBody(translation.body)
            ? computeContentHash([
                {
                  locale: translation.locale as Locale,
                  title: translation.title,
                  body: translation.body,
                },
              ])
            : null,
        })),
      },
      now,
    });

    /*
      The conditions again in the `WHERE`, for the reason `deleteDraftVersion` gives: the reads
      above are this transaction's, but the row can still have moved between this statement and
      another connection's. Matching nothing is the honest outcome, and it is reported rather
      than swallowed.
    */
    const [withdrawn] = await tx
      .update(legalDocuments)
      .set({ withdrawnAt: now, withdrawnByStaffUserId: actor.id })
      .where(
        and(
          eq(legalDocuments.id, versionId),
          eq(legalDocuments.isApproved, true),
          isNull(legalDocuments.withdrawnAt),
        ),
      )
      .returning({ id: legalDocuments.id });

    if (!withdrawn) {
      throw new DomainError("CONFLICT", "this version changed while it was being withdrawn");
    }
  });
}

/**
 * The platform's three texts, with the club's facts written in, created and approved in one act
 * (`DECISIONS.md` §132): what "New version → start from the platform's text → read → save →
 * approve, three times" did, as one press by the person who takes responsibility for them.
 *
 * The same rules as the long way, because it is the long way: a Superadministrator's act
 * (`assertMayEdit`), a version number derived and never chosen, the hash computed from what is
 * stored, `effective_at` the moment of approval, the approver on the row. Two refusals of its
 * own: a text whose facts are not all known is not approved — a `<PLACEHOLDER>` on a privacy
 * notice is not a notice — and a document that already has an approved version is left alone,
 * because the club's words in force are never replaced by a button (§46, §53).
 */
export type PlatformApproval = {
  /** The keys approved by this call. */
  approved: LegalDocumentKey[];
  /** The keys that already had an approved version and were left as they are. */
  alreadyApproved: LegalDocumentKey[];
};

export async function approvePlatformTemplates<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  facts: ClubFacts,
  now: Date,
): Promise<PlatformApproval> {
  assertMayEdit(actor);

  const keys: LegalDocumentKey[] = ["PRIVACY_NOTICE", "TERMS", "EVENT_DECLARATION"];
  const result: PlatformApproval = { approved: [], alreadyApproved: [] };

  for (const key of keys) {
    /*
      "Already approved" means "has text in force", and a withdrawn version is not that —
      `findCurrentApprovedDocument` skips it now. So a club that approved the platform's text,
      withdrew it before anybody relied on it, and pressed the button again gets the text back,
      as the next version number rather than the old one. The alternative would be a key with
      no legal text and a button that politely refuses to supply any.
    */
    const inForce = await findCurrentApprovedDocument(db, key, "ro", now);
    if (inForce) {
      result.alreadyApproved.push(key);
      continue;
    }
    const translations: LegalDocumentTranslationInput[] = (["ro", "en"] as const).map((locale) => ({
      locale,
      title: LEGAL_TEMPLATES[key][locale].title,
      body: fillClubFacts(LEGAL_TEMPLATES[key][locale].body, facts),
    }));
    const blanks = [...new Set(translations.flatMap((translation) => remainingPlaceholders(translation.body)))];
    if (blanks.length > 0) {
      throw new DomainError(
        "VALIDATION_ERROR",
        `the club's facts are not all set — ${key} still reads ${blanks.join(", ")}; set CLUB_LEGAL_NAME, CLUB_REGISTRATION_NUMBER, CLUB_REGISTERED_ADDRESS and EMAIL_REPLY_TO`,
      );
    }
    const versionId = await createDraftVersion(db, actor, { key, translations }, now);
    await approveVersion(db, actor, versionId, now);
    result.approved.push(key);
  }

  return result;
}
