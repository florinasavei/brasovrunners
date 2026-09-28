import { and, eq, isNull } from "drizzle-orm";
import { legalDocuments, legalDocumentTranslations } from "@/db/schema/legal-documents";
import type { LegalDocumentKey } from "@/db/schema/legal-documents";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import type { Locale } from "@/i18n/routing";
import { recordAuditEvent } from "@/modules/audit/repository";
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import { canWriteLegalTexts } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import {
  computeContentHash,
  isLegalDocumentBody,
  type LegalDocumentTranslationInput,
} from "./domain/content-hash";
import { isEmptyBody } from "./domain/body-text";
import { matchesBatchConfirmation, matchesConfirmation } from "./domain/confirmation";
import {
  deletionOrder,
  type DraftApprovalOutcome,
  draftApprovalOutcome,
  LegalBatchVersionRefused,
  type RegenerationOutcome,
  regenerationOutcome,
} from "./domain/batch";
import {
  type DeletionFacts,
  type DeletionObstacle,
  deletionObstacle,
  dependantObstacle,
  inForceWindow,
  isReliedOn,
  type TermsReliance,
} from "./domain/deletability";
import {
  countRegistrationsAgreeingWithin,
  findCurrentApprovedDocument,
  findCurrentApprovedVersionId,
  findVersionWithTranslations,
  type LegalDocumentVersionRow,
  listVersionsForBackoffice,
  nextVersionNumber,
  retireVersionNumber,
} from "./repository";
import { templatePrefill } from "./templates/catalogue";
import { kindSummary, type LegalKindSummary, templateIsNewer } from "./domain/overview";
import { type ClubFacts, remainingPlaceholders } from "./templates/club-facts";
import { LEGAL_DOCUMENT_KEYS, PLATFORM_APPROVAL_KEYS } from "./domain/keys";

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

/** The Administrator writes the club's legal text, and everyone above them (§450). */
function assertMayEdit(actor: Pick<StaffUser, "role">): void {
  if (!canWriteLegalTexts(actor.role)) {
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
  // Each refusal names the box the form posts (`<locale>Title`, `<locale>Body`), so the form can
  // link to it (§315).
  for (const locale of ["ro", "en"] as const) {
    const translation = translations.find((entry) => entry.locale === locale);
    if (!translation) {
      throw new DomainError("VALIDATION_ERROR", `the ${locale} version is missing`, [`${locale}Title`, `${locale}Body`]);
    }
    if (translation.title.trim() === "") {
      throw new DomainError("VALIDATION_ERROR", `the ${locale} title is empty`, [`${locale}Title`]);
    }
    if (isEmptyBody(translation.body)) {
      throw new DomainError("VALIDATION_ERROR", `the ${locale} text is empty`, [`${locale}Body`]);
    }
  }
}

/**
 * One version's backoffice row, or a refusal that says which version is missing.
 *
 * Every guard below starts here, and they all read the same row from the same query — the one
 * that carries the three dependant counts. A guard that counted for itself would be a second
 * definition of "relied upon", and the first time the two disagreed the disagreement would be
 * silent. (`assertDeletable` runs the same query and keeps every row, because a terms version's
 * window is computed from its siblings.)
 */
async function findVersionRow<T extends Record<string, unknown>>(
  db: Database<T>,
  versionId: string,
): Promise<LegalDocumentVersionRow> {
  const rows = await listVersionsForBackoffice(db);
  const row = rows.find((candidate) => candidate.id === versionId);
  if (!row) throw new DomainError("NOT_FOUND", "no such legal document version");
  return row;
}

/**
 * Nothing in the database depends on this version, and the site is not serving it
 * (`DECISIONS.md` §46, §53, §151).
 *
 * Shared by withdrawal and by deletion, because they ask exactly the same question: is anything
 * standing on these words. The two verbs differ in what they then do — one stops offering the
 * version, the other destroys it — and if the conditions were written twice, the destructive one
 * would eventually be the copy that is one condition short.
 *
 * The last check is the one no count can express. Zero signatures is not "unused" for a notice;
 * it is what the notice of a quiet week looks like, while every visitor to /legal/privacy is
 * reading it. Removing the version in force would take the club's privacy notice off the public
 * site and, per BR-REQ-053-01, stop every registration in the same instant.
 */
async function assertNothingDependsOn<T extends Record<string, unknown>>(
  db: Database<T>,
  row: LegalDocumentVersionRow,
  now: Date,
): Promise<void> {
  const inForce = (await findCurrentApprovedVersionId(db, row.key, now)) === row.id;
  const obstacle = dependantObstacle({ ...row, inForce });
  if (obstacle) throw refusalFor(obstacle);
}

/**
 * The refusal that goes with each obstacle — one sentence per reason, whichever verb met it.
 *
 * `CONFLICT` for all four: nothing about the request is malformed, the data says no. The terms
 * refusal also names itself in `fields` (§290), because the backoffice renders a bare `CONFLICT`
 * as "somebody else saved meanwhile" — true of a race and a lie about a rule.
 */
function refusalFor(obstacle: DeletionObstacle): DomainError {
  switch (obstacle.kind) {
    case "draft":
      return new DomainError(
        "CONFLICT",
        "this version was never approved; a draft is deleted by deleteDraftVersion, which needs no confirmation and retires no number",
      );
    case "referenced":
      return new DomainError(
        "CONFLICT",
        "somebody has relied on this version; it stays exactly where it is",
      );
    case "inForce":
      return new DomainError(
        "CONFLICT",
        "this version is the one currently in force; approve its successor before removing it",
      );
    case "termsAccepted":
      return new DomainError(
        "CONFLICT",
        `${obstacle.registrations} registration(s) were submitted, or had their declaration signed, while this terms version was in force (${obstacle.window.from.toISOString()} – ${obstacle.window.until?.toISOString() ?? "now"}); neither records a terms version, so any of them may have accepted it`,
        ["termsAccepted"],
      );
  }
}

/**
 * Everything the deletion rule reads about each of `rows`, for `deletionObstacle` (§290, §316) —
 * one `DeletionFacts` per row, in the order given.
 *
 * Exported because three callers must get the same answer — the service before it destroys, the
 * delete screen before it offers the form, the list before it offers the link — and the one that
 * did not ask is how the owner came to press "Șterge definitiv" three times on a version the
 * service would always refuse. `versions` is every row of `listVersionsForBackoffice`, which each
 * caller has already read; a terms version's window is computed from its siblings. `rows` is the
 * ones to judge: the service and the delete screen pass the one they are about, the list passes
 * all of them.
 *
 * **Plural so the list costs what it should.** Reads only: one in-force lookup per *key* among
 * `rows` — three at most, however many versions there are — and one count per terms version that
 * was ever in force. Asked a row at a time, the list made an in-force lookup for every privacy
 * notice and declaration it drew, the same three answers over and over.
 */
export async function readDeletionFacts<T extends Record<string, unknown>>(
  db: Database<T>,
  rows: readonly LegalDocumentVersionRow[],
  versions: readonly LegalDocumentVersionRow[],
  now: Date,
): Promise<DeletionFacts[]> {
  const keys = [...new Set(rows.map((row) => row.key))];
  const [inForceIds, terms] = await Promise.all([
    Promise.all(keys.map((key) => findCurrentApprovedVersionId(db, key, now))),
    Promise.all(rows.map((row) => termsRelianceOf(db, row, versions, now))),
  ]);
  const inForce = new Set(inForceIds.filter((id): id is string => id !== undefined));

  return rows.map((row, index) => ({
    isApproved: row.isApproved,
    acceptanceCount: row.acceptanceCount,
    eventCount: row.eventCount,
    privacyAcknowledgementCount: row.privacyAcknowledgementCount,
    inForce: inForce.has(row.id),
    terms: terms[index],
  }));
}

async function termsRelianceOf<T extends Record<string, unknown>>(
  db: Database<T>,
  row: LegalDocumentVersionRow,
  versions: readonly LegalDocumentVersionRow[],
  now: Date,
): Promise<TermsReliance | null> {
  if (row.key !== "TERMS") return null;
  const window = inForceWindow(row, versions, now);
  if (!window) return null;
  return { window, registrations: await countRegistrationsAgreeingWithin(db, window) };
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
  const row = await findVersionRow(db, versionId);

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
 *
 * "Whatever the highest is" is `nextVersionNumber`, and since §151 it counts the numbers that no
 * longer have a row as well as the ones that do. A deleted approved version leaves its number
 * retired in `legal_document_numbering`, so the next draft steps over it rather than inheriting
 * a number that registrations already recorded against different words.
 */
export async function createDraftVersion<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  input: SaveDraftInput,
  now: Date,
): Promise<string> {
  assertMayEdit(actor);
  assertTranslationsUsable(input.translations);

  const version = await nextVersionNumber(db, input.key);

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
  // In force from now, on `/termeni` and `/confidentialitate` — which read the text through the
  // public cache (§333) and must show it on the next visit, not the next day.
  revalidatePublicContent("legal");
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
 * **A draft, and nothing else.** An approved version has its own verb since §151 —
 * `deleteApprovedVersion`, with a typed confirmation, a reason, an audit row and a retired
 * number — and this one refuses an approved row rather than quietly doing half of that. Aim the
 * draft's delete at an approved version and it says so, naming the verb that does apply.
 *
 * **A draft's number is not retired**, which is the other half of the difference and the reason
 * the two deletes cannot be the same function. A draft's number never left the backoffice: a
 * registration records the version *in force*, and a draft is never in force, so nothing can be
 * pointing at the old meaning of it. Retiring it as well would make the club's version numbers
 * skip for a reason nothing on the screen could explain.
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

  const row = await findVersionRow(db, versionId);

  if (row.isApproved) {
    throw new DomainError(
      "CONFLICT",
      "an approved version is not deleted by this verb; use deleteApprovedVersion, which asks for the typed confirmation and retires the number",
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
  const row = await findVersionRow(db, versionId);

  if (!row.isApproved) {
    throw new DomainError(
      "CONFLICT",
      "a draft was never in force, so there is nothing to withdraw; delete it instead",
    );
  }
  if (row.withdrawnAt) {
    throw new DomainError("CONFLICT", "this version has already been withdrawn");
  }

  // The three counts, then the version the site is serving — one definition, shared with
  // deletion, so the two verbs can never come to disagree about what "unused" means.
  await assertNothingDependsOn(db, row, now);

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

    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "legal_document.withdrawn",
      entityType: "legal_document",
      entityId: versionId,
      metadata: await describeVersionForAudit(tx, row),
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
  // Never the version in force — but one dated ahead of it, which the public cache has already
  // filed as the text of the coming stretch (`public-cache/clock.ts`, §333).
  revalidatePublicContent("legal");
}

/**
 * What an audit row is allowed to say about a version of the club's legal text (§12.12).
 *
 * The shape of the document, never the text of it. A title is the club's own name for its own
 * document, which is what makes the row readable a year later; the body is the thing §12.12
 * forbids copying, and the hash stands in for it — the same hash the version's own
 * `content_sha256` is computed with, so the words can be *checked* against this row rather than
 * described by it.
 *
 * One function for both verbs, because for deletion this is no longer a record beside the row:
 * it is the only record. A withdrawal that carried the effective date and a deletion that
 * forgot it would be discovered exactly once, by somebody asking a year later which text was in
 * force in September and finding that the answer depended on which verb was used.
 */
async function describeVersionForAudit<T extends Record<string, unknown>>(
  db: Database<T>,
  row: LegalDocumentVersionRow,
): Promise<Record<string, unknown>> {
  const document = await findVersionWithTranslations(db, row.id);

  return {
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
  };
}

export type DeleteApprovedVersionInput = {
  versionId: string;
  /** `GDPR 2` — the document's code and its number, as the person typed it. */
  typedConfirmation: string;
  /** Why. It goes in the audit row, which is all that survives. */
  reason: string;
  now: Date;
};

/**
 * Delete an approved version outright — the row, the text, both translations
 * (BR-REQ-053-02, `DECISIONS.md` §151).
 *
 * ## What changed, and what did not
 *
 * §46 and §53 said an approved version is never deleted, and the reason underneath the
 * principle was arithmetic: `registrations.privacy_notice_version`, `results_consent_version`
 * and `health_consent_version` are plain integers with no foreign key, and `createDraftVersion`
 * took `max(version) + 1`. Delete version 4 and the next draft became version 4 again, with
 * different words, and every registration that recorded "privacy notice 4" silently became a
 * consent to text nobody was ever shown. PostgreSQL has nothing to raise about it.
 *
 * That hazard is *removed* here rather than accepted: the number is retired in
 * `legal_document_numbering` inside the same transaction that destroys the row, and
 * `nextVersionNumber` counts retired numbers as taken. After this, version 4 of that key cannot
 * be issued again by any writer — the editor, the platform-templates button or the seed.
 *
 * With the arithmetic answered, what was left of the refusal was the club's own bookkeeping,
 * and the club is who that belongs to. The owner, looking at five approved versions he made
 * while testing, on a production system no participant has ever registered on: "am zis ca vreau
 * sa fac curatenie in documente si sa le pot sterge". Withdrawal — §46's answer — does not do
 * it: the rows stay, folded away, for ever.
 *
 * ## What still refuses, and it is most of it
 *
 * `dependantObstacle`, the same question withdrawal asks: no signature, no event, no
 * registration that recorded this number, and not the version the site is serving right now. A
 * version anybody has relied on is not deletable and never becomes deletable — this verb has no
 * force flag, no "delete anyway", and no environment in which those checks are skipped. A draft
 * is refused too, and told which verb applies: `deleteDraftVersion` needs no confirmation and
 * retires no number, and quietly doing one verb's work under the other's name is how a draft
 * would start costing a version number. And a terms version is refused while any registration
 * was submitted, or had its declaration signed, during its time in force (§316), because neither
 * records a terms version and those two instants are the only evidence of which text was agreed
 * to.
 *
 * **In production as well.** §30 keeps *test registrations* out of production because a
 * synthetic row corrupts the club's real counts; nothing follows from it about the club tidying
 * its own documents, and production is where the five junk versions actually are. A verb that
 * worked only on QA would be a verb that never worked. What guards this is an Administrator (§450),
 * a phrase typed by hand, a reason, an audit row written first, and the impossibility of
 * touching anything a person has relied on.
 *
 * ## The order inside the transaction
 *
 * Audit row, then the retired number, then the delete — and `is_approved` in the `WHERE` again,
 * because the reads are this transaction's but another connection can still have moved the row.
 * If the delete matches nothing the whole thing rolls back, audit row included: a trail that
 * records a destruction which did not happen is worse than no trail.
 */
export async function deleteApprovedVersion<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  input: DeleteApprovedVersionInput,
): Promise<{ key: LegalDocumentKey; version: number }> {
  /*
    The role first, before the screen's own fields are looked at: somebody who may not do this
    is told that, rather than being told their confirmation was mistyped (BR-REQ-060-01).

    `assertMayEdit` — `canWriteLegalTexts`, the Administrator since §450 — and deliberately the
    same gate as `createDraftVersion`: it is the club's own published word, and the role that
    may write it is the role that may unwrite it. Gating destruction lower than creation would be
    the odd choice to have to defend; what guards it beyond the role is the typed phrase, the
    reason and the audit row.
  */
  assertMayEdit(actor);

  const reason = input.reason.trim();
  if (reason.length < 3) {
    throw new DomainError(
      "VALIDATION_ERROR",
      "a deletion needs a reason; it is the only thing that survives it",
      ["reason"],
    );
  }

  // Outside the transaction, so the screen gets a sentence naming the actual obstacle before
  // anything is opened; inside it again below, so the decision is taken on rows nothing can
  // have changed underneath.
  const preflight = await assertDeletable(db, input.versionId, input.now);

  /*
    The typed confirmation, checked on the server (BR-REQ-060-01). The phrase carries the
    *number*, not the title, because the club's five approved versions of one document all have
    the same title — a typed title would match every one of them, which is the opposite of what
    this field is for. `matchesConfirmation` explains the rest.
  */
  if (!matchesConfirmation(input.typedConfirmation, preflight.key, preflight.version)) {
    throw new DomainError(
      "VALIDATION_ERROR",
      "the typed confirmation does not name this version; nothing was deleted",
      ["typedConfirmation"],
    );
  }

  const deletedVersion = await db.transaction(async (tx) => {
    const row = await assertDeletable(tx, input.versionId, input.now);
    await destroyApprovedVersion(tx, actor, row, reason, input.now, {});
    return { key: row.key, version: row.version };
  });
  revalidatePublicContent("legal");
  return deletedVersion;
}

/**
 * The destruction itself, inside the caller's transaction and after its `assertDeletable`: the
 * audit row, the retired number, the delete — one body for the single delete and the batch
 * (§151, §532), so the batch cannot be the copy that forgets the number.
 */
async function destroyApprovedVersion<T extends Record<string, unknown>>(
  tx: Database<T>,
  actor: Pick<StaffUser, "id">,
  row: LegalDocumentVersionRow,
  reason: string,
  now: Date,
  extra: Record<string, unknown>,
): Promise<void> {
  // First, and in this transaction: the row that says this happened. It outlives the version
  // — `audit_logs.entity_id` carries no foreign key — and once the delete below commits it is
  // the only record that the club ever published these words, under this number.
  await recordAuditEvent(tx, {
    actorStaffUserId: actor.id,
    action: "legal_document.deleted",
    entityType: "legal_document",
    entityId: row.id,
    metadata: {
      ...(await describeVersionForAudit(tx, row)),
      reason: reason.slice(0, 500),
      // Stated rather than implied: whoever reads this row a year from now should not have to
      // know about `legal_document_numbering` to know the number went with it.
      versionNumberRetired: true,
      ...extra,
    },
    now,
  });

  await retireVersionNumber(tx, row.key, row.version, now);

  const [deleted] = await tx
    .delete(legalDocuments)
    .where(and(eq(legalDocuments.id, row.id), eq(legalDocuments.isApproved, true)))
    .returning({ id: legalDocuments.id });

  if (!deleted) {
    throw new DomainError("CONFLICT", "this version changed while it was being deleted");
  }
}

/**
 * Everything deletion requires, asked as one question — and asked twice, like withdrawal's.
 *
 * The question is `deletionObstacle`, the pure rule the delete screen and the list ask too, fed
 * by `readDeletionFacts`: a draft first, so aiming this at a draft is answered by naming the verb
 * that applies; then the question shared with withdrawal (`dependantObstacle`), so the two verbs
 * can never disagree about what "unused" means; then, for TERMS, whether any registration was
 * submitted, or had its declaration signed, while the version was in force.
 *
 * A withdrawn version passes the shared part: it has no dependants by construction — withdrawal
 * refused it otherwise — and it is by definition not in force. That is the natural second step,
 * and the reason the fold on the list is not a place rows go to stay for ever.
 *
 * **Why the terms question is deletion's alone (§203).** Withdrawal keeps the row, its number and
 * its words and stops only the offering, so nothing is lost if the counts are blind. Deletion
 * destroys the words, and after it the audit row's hash is the only evidence of what the club
 * published — so for the one key whose counts are vacuous it needs the window to be empty.
 *
 * Inside the transaction the window is in the past, so no new submission or signature can land
 * in it; a restart can only stretch a registration *across* it, which is counted (see
 * `countRegistrationsAgreeingWithin`), so the second asking can only be stricter than the first.
 */
async function assertDeletable<T extends Record<string, unknown>>(
  db: Database<T>,
  versionId: string,
  now: Date,
): Promise<LegalDocumentVersionRow> {
  const versions = await listVersionsForBackoffice(db);
  const row = versions.find((candidate) => candidate.id === versionId);
  if (!row) throw new DomainError("NOT_FOUND", "no such legal document version");

  const [facts] = await readDeletionFacts(db, [row], versions, now);
  const obstacle = deletionObstacle(facts);
  if (obstacle) throw refusalFor(obstacle);

  return row;
}

/**
 * The platform's texts (`PLATFORM_APPROVAL_KEYS`: since §515 every text of the catalogue — the
 * notice, the terms, both race declarations and the group runs' two optional ones), with the club's
 * facts written in, created and approved in one act
 * (`DECISIONS.md` §132): what "New version → start from the platform's text → read → save →
 * approve", once per text, did, as one press by the person who takes responsibility for them.
 *
 * The same rules as the long way, because it is the long way: an Administrator's act (§450)
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

  const keys: readonly LegalDocumentKey[] = PLATFORM_APPROVAL_KEYS;
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
    const translations = templateTranslations(key, facts);
    const blanks = [...new Set(translations.flatMap((translation) => remainingPlaceholders(translation.body)))];
    if (blanks.length > 0) {
      throw new DomainError(
        "VALIDATION_ERROR",
        `the club's facts are not all set — ${key} still reads ${blanks.join(", ")}; set CLUB_LEGAL_NAME, CLUB_REGISTRATION_NUMBER, CLUB_REGISTERED_ADDRESS, and a contact address — EMAIL_REPLY_TO or the club's Gmail under «Adresa de contact afișată» on /admin/emails`,
      );
    }
    const versionId = await createDraftVersion(db, actor, { key, translations }, now);
    await approveVersion(db, actor, versionId, now);
    result.approved.push(key);
  }

  return result;
}

/**
 * A key's platform template as the two translations a draft is made of: the same prefill as
 * "start from the platform's text" — the fields kept, the facts written in (§357) — read by the
 * one press (§132) and by «Regenerează din șabloane» (§532), so both hash the same words.
 */
export function templateTranslations(key: LegalDocumentKey, facts: ClubFacts): LegalDocumentTranslationInput[] {
  const prefill = templatePrefill(key, facts);
  return (["ro", "en"] as const).map((locale) => ({ locale, ...prefill[locale] }));
}

export type RegenerationPlanItem = {
  key: LegalDocumentKey;
  outcome: RegenerationOutcome;
  /** A club fact the deployment does not know is still a `<PLACEHOLDER>` in the template's text. */
  hasPlaceholders: boolean;
};

/**
 * What «Regenerează din șabloane» would do with every text of the catalogue (§532), read-only:
 * the page shows it, its confirm dialog names the `create` keys, and the press asks it again
 * of the rows as they are then.
 */
export async function planTemplateRegeneration<T extends Record<string, unknown>>(
  db: Database<T>,
  facts: ClubFacts,
  now: Date,
): Promise<RegenerationPlanItem[]> {
  const versions = await listVersionsForBackoffice(db);
  return Promise.all(
    LEGAL_DOCUMENT_KEYS.map(async (key) => {
      const translations = templateTranslations(key, facts);
      const inForceId = await findCurrentApprovedVersionId(db, key, now);
      return {
        key,
        outcome: regenerationOutcome(key, computeContentHash(translations), versions, inForceId),
        hasPlaceholders: translations.some((translation) => remainingPlaceholders(translation.body).length > 0),
      };
    }),
  );
}

/**
 * One text as `/admin/legal`'s card and «Versiune nouă»'s button read it (§NNN): its summary
 * (what is in force, which draft waits), what «Regenerează din șablon» would do with it — the same
 * `regenerationOutcome` §532's press asks — whether its template is newer than the text in force,
 * and the number its next draft would get (for the confirm dialog's «versiunea N»).
 */
export type LegalKindOverview = {
  summary: LegalKindSummary;
  inForceId: string | undefined;
  regeneration: RegenerationOutcome;
  /** A club fact is still a `<PLACEHOLDER>` in the template's text, the deployment's facts written in. */
  hasPlaceholders: boolean;
  templateNewer: boolean;
  nextVersion: number;
};

export async function readLegalOverview<T extends Record<string, unknown>>(
  db: Database<T>,
  facts: ClubFacts,
  now: Date,
  versions?: readonly LegalDocumentVersionRow[],
): Promise<Record<LegalDocumentKey, LegalKindOverview>> {
  const rows = versions ?? (await listVersionsForBackoffice(db));
  const entries = await Promise.all(
    LEGAL_DOCUMENT_KEYS.map(async (key) => {
      const translations = templateTranslations(key, facts);
      const filledHash = computeContentHash(translations);
      const inForceId = await findCurrentApprovedVersionId(db, key, now);
      const summary = kindSummary(key, rows, inForceId);
      const inForceRow = rows.find((row) => row.id === summary.inForce?.id);
      const overview: LegalKindOverview = {
        summary,
        inForceId,
        regeneration: regenerationOutcome(key, filledHash, rows, inForceId),
        hasPlaceholders: translations.some((translation) => remainingPlaceholders(translation.body).length > 0),
        templateNewer: templateIsNewer(inForceRow, filledHash),
        nextVersion: await nextVersionNumber(db, key),
      };
      return [key, overview] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<LegalDocumentKey, LegalKindOverview>;
}

/**
 * Every legal text regenerated from the platform's current template, in one press (§532): a new
 * **draft** per key whose template now says something neither the text in force nor a draft
 * waiting says. The templates moved several times in a week (§418, §515, §523), and each move
 * was six rounds of "Versiune nouă → pornește de la textul platformei → Salvează".
 *
 * Drafts only, and that is the rule, not caution: nothing is in force until the club reads it and
 * approves it (§46), and approval stays its own press — one version at a time, or every draft at
 * once through `approveDrafts`, which the page offers next. A draft is made by `createDraftVersion`,
 * the long way's own function: the number derived, the hash computed from what is stored, the
 * author on the row. A text whose facts the deployment does not know keeps its `<PLACEHOLDER>`,
 * exactly as "start from the platform's text" leaves it, for the Administrator to type — and
 * `approveDrafts` will not approve it until then.
 *
 * `keys` is what the page's confirm dialog named; a key the rows no longer call for (another tab
 * made the draft meanwhile) is skipped rather than doubled.
 */
export type TemplateRegeneration = {
  created: LegalDocumentKey[];
  skipped: LegalDocumentKey[];
};

export async function regenerateFromTemplates<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  facts: ClubFacts,
  keys: readonly string[],
  now: Date,
): Promise<TemplateRegeneration> {
  assertMayEdit(actor);
  const asked = new Set(keys);
  if (asked.size === 0) throw new DomainError("VALIDATION_ERROR", "no text was named to regenerate", ["key"]);

  // One transaction for every draft (each `createDraftVersion` nests as a savepoint): a press
  // that fails at the fourth text leaves no three drafts behind it to explain. No revalidation
  // after the commit — a draft is on no public page, and expiring the cache for one would only
  // wake the database for the next visitor (§333).
  return db.transaction(async (tx) => {
    const plan = await planTemplateRegeneration(tx, facts, now);
    const result: TemplateRegeneration = { created: [], skipped: [] };
    for (const item of plan) {
      if (!asked.has(item.key)) continue;
      if (item.outcome !== "create") {
        result.skipped.push(item.key);
        continue;
      }
      const draftId = await createDraftVersion(
        tx,
        actor,
        { key: item.key, translations: templateTranslations(item.key, facts) },
        now,
      );
      // Who made which draft (§NNN): one row per draft, in the same transaction, so a press that
      // fails leaves neither a draft nor a row about one. Only the number is read back.
      const [draft] = await tx
        .select({ version: legalDocuments.version })
        .from(legalDocuments)
        .where(eq(legalDocuments.id, draftId));
      await recordAuditEvent(tx, {
        actorStaffUserId: actor.id,
        action: "legal_document.regenerated",
        entityType: "legal_document",
        entityId: draftId,
        metadata: { documentKey: item.key, version: draft?.version ?? null },
        now,
      });
      result.created.push(item.key);
    }
    return result;
  });
}

export type DraftApprovalItem = { row: LegalDocumentVersionRow; outcome: DraftApprovalOutcome };

/** Whether a version's text still carries a club-fact `<PLACEHOLDER>` in either language. */
async function versionHasPlaceholders<T extends Record<string, unknown>>(db: Database<T>, versionId: string): Promise<boolean> {
  const document = await findVersionWithTranslations(db, versionId);
  return (document?.translations ?? []).some(
    (translation) => isLegalDocumentBody(translation.body) && remainingPlaceholders(translation.body).length > 0,
  );
}

/**
 * Every draft, with what «Aprobă toate ciornele» would do with it (`draftApprovalOutcome`, §532):
 * read-only, for the page, its confirm dialog and the press.
 */
export async function planDraftApproval<T extends Record<string, unknown>>(db: Database<T>): Promise<DraftApprovalItem[]> {
  const versions = await listVersionsForBackoffice(db);
  return Promise.all(
    versions
      .filter((row) => !row.isApproved)
      .map(async (row) => ({ row, outcome: draftApprovalOutcome(row, versions, await versionHasPlaceholders(db, row.id)) })),
  );
}

/** Every named draft still in the plan and still `ready`, or the whole press refused (`approveDrafts`). */
function assertDraftsReady(plan: readonly DraftApprovalItem[], ids: readonly string[]): void {
  for (const id of ids) {
    const item = plan.find((candidate) => candidate.row.id === id);
    if (!item) throw new DomainError("NOT_FOUND", "no such draft");
    if (item.outcome !== "ready") {
      throw new DomainError(
        "CONFLICT",
        `version ${item.row.key} ${item.row.version} is no longer ready to approve (${item.outcome}); nothing was approved`,
      );
    }
  }
}

/**
 * The drafts the page listed, approved in one press (§532) — each by `approveVersion`, the
 * one-version verb, in one transaction: all of them or none.
 *
 * `versionIds` is what the confirm dialog named, and every one must still be `ready` when the
 * press lands — the newest draft of its key, above every approved version still offered, no
 * placeholder left. One that is not (a draft edited into a placeholder, a newer draft typed in
 * another tab) refuses the whole press with a `CONFLICT`, because an approval is one-way and the
 * club approved the list it read, not the one the rows became. Approval stays the
 * Administrator's (`assertMayEdit`, §450), and one-way (§46).
 */
export async function approveDrafts<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  versionIds: readonly string[],
  now: Date,
): Promise<number> {
  assertMayEdit(actor);
  const ids = [...new Set(versionIds)];
  if (ids.length === 0) throw new DomainError("VALIDATION_ERROR", "no draft was named to approve", ["versionId"]);

  // Checked twice, like the batch delete: before the transaction, so a refusal names the draft
  // before anything is opened, and again inside it, against the rows the approvals will change —
  // a draft that lost readiness between the two (a newer draft saved in another tab, a
  // placeholder typed back in) refuses the whole press there too.
  assertDraftsReady(await planDraftApproval(db), ids);
  await db.transaction(async (tx) => {
    assertDraftsReady(await planDraftApproval(tx), ids);
    for (const id of ids) await approveVersion(tx, actor, id, now);
  });
  // After the commit as well: `approveVersion` revalidated inside the transaction, before the
  // rows were visible to anybody else.
  revalidatePublicContent("legal");
  return ids.length;
}

export type DeleteVersionsInput = {
  versionIds: readonly string[];
  /** `DELETE 3` — the number of approved versions among them (`batchConfirmationPhrase`); unread when there are none. */
  typedConfirmation: string;
  /** Why; in every approved version's audit row. Unread when only drafts are deleted. */
  reason: string;
  now: Date;
};

export type DeletedVersions = { drafts: number; approved: number };

/** The first reason `row` may not be deleted, in the words of whichever one-version verb it is for. */
function batchObstacle(row: LegalDocumentVersionRow, facts: DeletionFacts): DomainError | null {
  if (!row.isApproved) {
    return isReliedOn({
      acceptances: row.acceptanceCount,
      events: row.eventCount,
      privacyAcknowledgements: row.privacyAcknowledgementCount,
    })
      ? new DomainError("CONFLICT", "this version is referenced and cannot be deleted")
      : null;
  }
  const obstacle = deletionObstacle(facts);
  return obstacle ? refusalFor(obstacle) : null;
}

/**
 * Several versions deleted in one press (§532): drafts as `deleteDraftVersion` deletes one (§53),
 * approved versions as `deleteApprovedVersion` does (§151, §316) — the same obstacles, the same
 * audit row per version written first, the same retired number — in one transaction, all or none.
 *
 * What is shared across the batch is only what a person types: one reason for every approved
 * version's audit row, and one phrase, `DELETE <n>`, where n is how many approved versions the
 * screen listed. With only drafts ticked, neither is asked, as for one draft.
 *
 * Checked twice, like the single delete: once before the transaction, so a refusal names what
 * stands in the way before anything is opened, and again inside it, one version at a time in
 * `deletionOrder`, each against the rows as the earlier deletions left them.
 *
 * All or none, and not "delete the rest, skip the one that became blocked": the screen asked
 * `DELETE <n>` and one reason for exactly the approved versions it listed, and an audit row's
 * reason and the typed count describe that list — deleting a different one under them would make
 * both untrue. A version that became undeletable between the screen and the press therefore stops
 * the whole press with `LegalBatchVersionRefused`, which names it (`GDPR 2`); the screen, read
 * again, lists it under what stays, with the reason, and the rest go on the next press.
 */
export async function deleteVersionsInBatch<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  input: DeleteVersionsInput,
): Promise<DeletedVersions> {
  assertMayEdit(actor);
  const ids = [...new Set(input.versionIds)];
  if (ids.length === 0) throw new DomainError("VALIDATION_ERROR", "no version was selected", ["versionId"]);

  const versions = await listVersionsForBackoffice(db);
  const rows = ids.map((id) => {
    const row = versions.find((candidate) => candidate.id === id);
    if (!row) throw new DomainError("NOT_FOUND", "no such legal document version");
    return row;
  });
  const facts = await readDeletionFacts(db, rows, versions, input.now);
  rows.forEach((row, index) => {
    const refusal = batchObstacle(row, facts[index]);
    if (refusal) throw new LegalBatchVersionRefused(row, refusal);
  });

  const approvedCount = rows.filter((row) => row.isApproved).length;
  const reason = input.reason.trim();
  if (approvedCount > 0) {
    if (reason.length < 3) {
      throw new DomainError("VALIDATION_ERROR", "a deletion needs a reason; it is the only thing that survives it", ["reason"]);
    }
    if (!matchesBatchConfirmation(input.typedConfirmation, approvedCount)) {
      throw new DomainError(
        "VALIDATION_ERROR",
        "the typed confirmation does not name this many approved versions; nothing was deleted",
        ["typedConfirmation"],
      );
    }
  }

  await db.transaction(async (tx) => {
    for (const planned of deletionOrder(rows)) {
      const fresh = await listVersionsForBackoffice(tx);
      const row = fresh.find((candidate) => candidate.id === planned.id);
      if (!row || row.isApproved !== planned.isApproved) {
        throw new LegalBatchVersionRefused(planned, new DomainError("CONFLICT", "it changed while the batch was being deleted"));
      }
      const [rowFacts] = await readDeletionFacts(tx, [row], fresh, input.now);
      const refusal = batchObstacle(row, rowFacts);
      if (refusal) throw new LegalBatchVersionRefused(row, refusal);

      if (row.isApproved) {
        await destroyApprovedVersion(tx, actor, row, reason, input.now, { batchSize: rows.length });
        continue;
      }
      const [deleted] = await tx
        .delete(legalDocuments)
        .where(and(eq(legalDocuments.id, row.id), eq(legalDocuments.isApproved, false)))
        .returning({ id: legalDocuments.id });
      if (!deleted) {
        throw new LegalBatchVersionRefused(row, new DomainError("CONFLICT", "it was approved while the batch was being deleted"));
      }
    }
  });
  revalidatePublicContent("legal");
  return { drafts: rows.length - approvedCount, approved: approvedCount };
}
