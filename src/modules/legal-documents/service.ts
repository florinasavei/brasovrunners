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
 * Writing legal documents from the backoffice (BR-REQ-053-02, §46). A version is a draft, editable,
 * until approved; approval is one-way, and an approved or referenced version is frozen
 * (AGENTS.md §12.5). A correction is a new version.
 */

/** Administrator and above (§450). */
function assertMayEdit(actor: Pick<StaffUser, "role">): void {
  if (!canWriteLegalTexts(actor.role)) {
    throw new DomainError(
      "FORBIDDEN",
      `role ${actor.role} may not write legal documents; they are the club's own commitments`,
    );
  }
}

function assertTranslationsUsable(translations: readonly LegalDocumentTranslationInput[]): void {
  // Both languages, always: there is no fallback (BR-REQ-040-02). Each refusal names the posted
  // box (`<locale>Title`, `<locale>Body`) so the form can link to it (§315).
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
 * One version's backoffice row, or a refusal. Every guard reads this same row and its dependant
 * counts, so "relied upon" has one definition.
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
 * Nothing depends on this version and the site is not serving it (§46, §53, §151). Shared by
 * withdrawal and deletion so the destructive one can never be a condition short; the version in
 * force is refused whatever the counts (BR-REQ-053-01).
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
 * One refusal per obstacle, all `CONFLICT`. The terms refusal also names itself in `fields` (§290),
 * since a bare `CONFLICT` reads as "somebody else saved meanwhile".
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
 * One `DeletionFacts` per row, in order, for `deletionObstacle` (§290, §316). Exported so the
 * service, delete screen and list share one answer. `versions` is every backoffice row (a terms
 * window needs its siblings); one in-force lookup per key, not per row.
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

/** A fact about the data, not a permission: approved, accepted or chosen by an event is history. */
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
 * Create the next draft of one document. The number is derived by `nextVersionNumber`, which skips
 * retired numbers (§151), never typed.
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
        // Placeholder; approval sets the real moment.
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

/** Rewrite a draft in place: translations replaced whole, the hash recomputed from what is saved. */
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
      // No `updated_at` on this table: rows are written once and approved once.
      .set({ contentSha256: computeContentHash(translations) })
      .where(eq(legalDocuments.id, versionId));
  });
}

/**
 * Approve a draft; it becomes the club's word and stops being editable. One-way on purpose — an
 * acceptance must never point at a version later treated as never in force.
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
    The result is checked: a draft deleted between the check and this update would otherwise be
    reported as approved (AGENTS.md §1.5).
  */
  const [approved] = await db
    .update(legalDocuments)
    .set({
      isApproved: true,
      approvedByStaffUserId: actor.id,
      // In force from the approval, not from when the draft was typed.
      effectiveAt: now,
    })
    .where(and(eq(legalDocuments.id, versionId), eq(legalDocuments.isApproved, false)))
    .returning({ id: legalDocuments.id });

  if (!approved) {
    throw new DomainError("CONFLICT", "this version changed while it was being approved");
  }
  // The public pages read through the cache (§333) and must show it on the next visit.
  revalidatePublicContent("legal");
}

/**
 * Delete a draft (BR-REQ-053-02, §53). A draft was never in force, so nothing can rely on it. Only
 * drafts: an approved version has `deleteApprovedVersion`. A draft's number is not retired — nothing
 * recorded it. Translations cascade.
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
    `is_approved = false` again in the `WHERE`, so a concurrent approval makes this match nothing
    rather than race it — and no raw foreign-key violation reaches the user (AGENTS.md §14.3).
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
 * Everything withdrawal requires (§46, §53). Called outside the transaction, for a precise refusal,
 * and again inside the transaction — the same function both times.
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

  // Shared with deletion.
  await assertNothingDependsOn(db, row, now);

  return row;
}

/**
 * Withdraw an approved version (BR-REQ-053-02, §46, §53): the row, number and words stay; it is no
 * longer resolved as current, offered to the editor, or listed by default. Never something relied
 * on or in force (`assertWithdrawable`). The audit row goes first in the same transaction; if the
 * guarded update matches nothing, both roll back.
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
      Conditions repeated in the `WHERE`, as in `deleteDraftVersion`; matching nothing is reported.
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
  // A version dated ahead is already cached as the coming stretch's text (`public-cache/clock.ts`, §333).
  revalidatePublicContent("legal");
}

/**
 * What an audit row may say about a legal version (AGENTS.md §12.12): its shape and hash, never its
 * text. One function for withdrawal and deletion — for deletion it is the only record left.
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
  /** As typed, e.g. `GDPR 2`. */
  typedConfirmation: string;
  /** Goes in the audit row, which is all that survives. */
  reason: string;
  now: Date;
};

/**
 * Delete an approved version outright — row, text, translations (BR-REQ-053-02, §151).
 *
 * Safe because the number is retired in `legal_document_numbering` in the same transaction, so it
 * is never reissued to different words (registrations refer to it by plain integer). Refused, with
 * no override and in every environment: anything `dependantObstacle` finds, a draft (it has its own
 * verb), and a terms version agreed to during its window (§316). Guarded by the Administrator role
 * (§450), a typed phrase, a reason and an audit row.
 *
 * Order in the transaction: audit row, retired number, delete with `is_approved` in the `WHERE`;
 * if the delete matches nothing, everything rolls back.
 */
export async function deleteApprovedVersion<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  input: DeleteApprovedVersionInput,
): Promise<{ key: LegalDocumentKey; version: number }> {
  /*
    The role first, so an unauthorised user is not told their phrase was mistyped (BR-REQ-060-01).
    The same gate as creation (§450).
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

  // Checked here for a precise refusal, and again inside the transaction.
  const preflight = await assertDeletable(db, input.versionId, input.now);

  /* The typed confirmation, checked on the server (BR-REQ-060-01); see `matchesConfirmation`. */
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
 * The destruction inside the caller's transaction, after `assertDeletable`: audit row, retired
 * number, delete — one body for single and batch deletes (§151, §532).
 */
async function destroyApprovedVersion<T extends Record<string, unknown>>(
  tx: Database<T>,
  actor: Pick<StaffUser, "id">,
  row: LegalDocumentVersionRow,
  reason: string,
  now: Date,
  extra: Record<string, unknown>,
): Promise<void> {
  // First: once the delete commits, this row is the only record (`audit_logs.entity_id` has no foreign key).
  await recordAuditEvent(tx, {
    actorStaffUserId: actor.id,
    action: "legal_document.deleted",
    entityType: "legal_document",
    entityId: row.id,
    metadata: {
      ...(await describeVersionForAudit(tx, row)),
      reason: reason.slice(0, 500),
      // Explicit for readers who do not know `legal_document_numbering`.
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
 * Everything deletion requires — `deletionObstacle` fed by `readDeletionFacts`, asked twice like
 * withdrawal's. A withdrawn version passes the shared part by construction. The terms window is
 * deletion's alone (§203): deletion destroys the words. Inside the transaction the window is past,
 * so the second asking can only be stricter.
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
 * Create and approve every platform text (`PLATFORM_APPROVAL_KEYS`) in one press (§132, §515), by
 * the same rules as the long way (§450). Refuses a text with a `<PLACEHOLDER>` left, and leaves
 * alone a key that already has text in force (§46, §53).
 */
export type PlatformApproval = {
  approved: LegalDocumentKey[];
  /** Already had text in force; left as they are. */
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
      "Already approved" means "has text in force"; a withdrawn version does not count, so the
      text comes back as a new version.
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
 * A key's template as draft translations, prefilled as "start from the platform's text" does (§357),
 * so the one press (§132) and «Regenerează» (§532) hash the same words.
 */
export function templateTranslations(key: LegalDocumentKey, facts: ClubFacts): LegalDocumentTranslationInput[] {
  const prefill = templatePrefill(key, facts);
  return (["ro", "en"] as const).map((locale) => ({ locale, ...prefill[locale] }));
}

export type RegenerationPlanItem = {
  key: LegalDocumentKey;
  outcome: RegenerationOutcome;
  /** An unknown club fact is still a `<PLACEHOLDER>`. */
  hasPlaceholders: boolean;
};

/** «Regenerează din șabloane»'s plan for every text (§532), read-only; the press asks it again. */
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
 * One text for `/admin/legal`'s card and «Versiune nouă» (§539): its summary, `regenerationOutcome`,
 * whether the template is newer, and the next draft's number.
 */
export type LegalKindOverview = {
  summary: LegalKindSummary;
  inForceId: string | undefined;
  regeneration: RegenerationOutcome;
  /** An unknown club fact is still a `<PLACEHOLDER>`. */
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
 * A new draft per key whose template says something neither the text in force nor a waiting draft
 * says (§532). Drafts only: approval stays its own press (§46, `approveDrafts`); unknown facts stay
 * `<PLACEHOLDER>`s. A key another tab already drafted is skipped.
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

  // One transaction (each `createDraftVersion` a savepoint): all drafts or none. No revalidation —
  // drafts are on no public page (§333).
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
      // One audit row per draft (§539), in the same transaction.
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

/** In either language. */
async function versionHasPlaceholders<T extends Record<string, unknown>>(db: Database<T>, versionId: string): Promise<boolean> {
  const document = await findVersionWithTranslations(db, versionId);
  return (document?.translations ?? []).some(
    (translation) => isLegalDocumentBody(translation.body) && remainingPlaceholders(translation.body).length > 0,
  );
}

/** Every draft with its `draftApprovalOutcome` (§532), read-only. */
export async function planDraftApproval<T extends Record<string, unknown>>(db: Database<T>): Promise<DraftApprovalItem[]> {
  const versions = await listVersionsForBackoffice(db);
  return Promise.all(
    versions
      .filter((row) => !row.isApproved)
      .map(async (row) => ({ row, outcome: draftApprovalOutcome(row, versions, await versionHasPlaceholders(db, row.id)) })),
  );
}

/** Every named draft still `ready`, or the whole press is refused. */
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
 * Approve the listed drafts in one transaction, each by `approveVersion` (§532, §46, §450). Every
 * one must still be `ready`, else the whole press is refused: the club approved the list it read.
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

  // Checked before the transaction for a precise refusal, and again inside it.
  assertDraftsReady(await planDraftApproval(db), ids);
  await db.transaction(async (tx) => {
    assertDraftsReady(await planDraftApproval(tx), ids);
    for (const id of ids) await approveVersion(tx, actor, id, now);
  });
  // Again after the commit: `approveVersion` revalidated before the rows were visible.
  revalidatePublicContent("legal");
  return ids.length;
}

export type DeleteVersionsInput = {
  versionIds: readonly string[];
  /** `batchConfirmationPhrase`; unread when no approved version is included. */
  typedConfirmation: string;
  /** In every approved version's audit row; unread when only drafts are deleted. */
  reason: string;
  now: Date;
};

export type DeletedVersions = { drafts: number; approved: number };

/** In the words of the matching one-version verb. */
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
 * Delete several versions in one transaction, all or none (§532), each as its one-version verb
 * would (§53, §151, §316). One reason and one `DELETE <n>` phrase cover the approved ones. Checked
 * before and inside the transaction, in `deletionOrder`; a version that became undeletable stops
 * the press with `LegalBatchVersionRefused`, since the phrase and reason describe the listed set.
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
