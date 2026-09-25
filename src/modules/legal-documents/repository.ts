import { and, desc, eq, isNull, lte, sql } from "drizzle-orm";
import { declarationAcceptances } from "@/db/schema/declaration-acceptances";
import { events } from "@/db/schema/events";
import { groupRunDeclarations } from "@/db/schema/group-run-declarations";
import {
  legalDocumentNumbering,
  legalDocumentTranslations,
  legalDocuments,
  type LegalDocumentKey,
} from "@/db/schema/legal-documents";
import { registrations } from "@/db/schema/registrations";
import type { Database } from "@/db/types";
import type { Locale } from "@/i18n/routing";
import type { LegalDocumentTranslationInput } from "./domain/content-hash";
import { asksForMinorSignature } from "./domain/merge-fields";

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
 * approved, not withdrawn, and whose `effective_at` has passed (§12.5: "resolved by
 * `effective_at`").
 *
 * Used both by the public legal routes and by registration (BR-REQ-053-01: registration
 * refuses when this returns nothing).
 *
 * `withdrawn_at IS NULL` is what makes withdrawal mean anything: a withdrawn version keeps its
 * row, its number and its words, and stops being offered anywhere. It can never be the version
 * this returns *today* — the one in force is refused withdrawal — but it can be one the club
 * approved ahead of its effective date and thought better of, which without this filter would
 * quietly become the public text on the day it was dated for.
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
        isNull(legalDocuments.withdrawnAt),
        lte(legalDocuments.effectiveAt, now),
      ),
    )
    .orderBy(desc(legalDocuments.version))
    .limit(1);

  return row ? { ...row, locale } : undefined;
}

/**
 * Whether the declaration in effect in `locale` asks a minor to sign beside the parent, with the
 * minor's own document (§330, `asksForMinorSignature`) — false while no declaration is approved,
 * since then nothing is signed at all.
 *
 * For the screens that say what a minor's paper must carry before the press (the desk, the
 * registration's page, the event's printable form): they ask the text in the registration's
 * language, the one `signDeclaration` and the paper confirmation bind to, so the sentence and what
 * the press records agree.
 */
export async function declarationAsksMinorToSign<T extends Record<string, unknown>>(
  db: Database<T>,
  locale: Locale,
  now: Date,
): Promise<boolean> {
  const document = await findCurrentApprovedDocument(db, "EVENT_DECLARATION", locale, now);
  return document ? asksForMinorSignature(document.body) : false;
}

/**
 * Whether the club has an approved group-run declaration in force for each surface (§NNN) — what
 * the editor's "Declarație opțională pe propria răspundere" asks before it lets itself be ticked.
 * Asked in Romanian: both languages are required before a version can be approved (§46).
 */
export async function groupRunDeclarationsInForce<T extends Record<string, unknown>>(
  db: Database<T>,
  now: Date,
): Promise<Record<"ASPHALT" | "TRAIL", boolean>> {
  const [asphalt, trail] = await Promise.all([
    findCurrentApprovedDocument(db, "GROUP_RUN_DECLARATION_ASPHALT", "ro", now),
    findCurrentApprovedDocument(db, "GROUP_RUN_DECLARATION_TRAIL", "ro", now),
  ]);
  return { ASPHALT: asphalt !== undefined, TRAIL: trail !== undefined };
}

/** `declarationAsksMinorToSign` for each language, for a list whose rows are in either (§330). */
export async function declarationAsksMinorToSignByLocale<T extends Record<string, unknown>>(
  db: Database<T>,
  now: Date,
): Promise<Record<Locale, boolean>> {
  const [ro, en] = await Promise.all([declarationAsksMinorToSign(db, "ro", now), declarationAsksMinorToSign(db, "en", now)]);
  return { ro, en };
}

/**
 * Every instant at which `findCurrentApprovedDocument(key, …)` can change its answer without a
 * write: the effective dates of the approved, not withdrawn versions of `key` (`DECISIONS.md`
 * §333). The same three conditions as that query, so the two cannot disagree about which dates
 * matter; the public cache keys the text in force by the stretch `now` is in
 * (`public-cache/clock.ts`), which is how a version approved today for next month takes effect
 * on the day without anybody saving anything.
 */
export async function listEffectiveDates<T extends Record<string, unknown>>(
  db: Database<T>,
  key: LegalDocumentKey,
): Promise<Date[]> {
  const rows = await db
    .select({ effectiveAt: legalDocuments.effectiveAt })
    .from(legalDocuments)
    .where(and(eq(legalDocuments.key, key), eq(legalDocuments.isApproved, true), isNull(legalDocuments.withdrawnAt)));
  return rows.map((row) => row.effectiveAt);
}

/**
 * Which row of `key` is in force at `now`, as an id — the question withdrawal has to answer.
 *
 * The same predicate as `findCurrentApprovedDocument` with the translation join taken out, and
 * that difference is the whole reason it exists rather than being answered by calling that one.
 * The joined version asks "what does the public page render in this language", and a version
 * with no `ro` translation answers *nothing* there — which, asked as "may this be withdrawn",
 * would say yes about the very row the site is serving in the other language. The unjoined
 * question has one answer per key and errs towards refusing.
 */
export async function findCurrentApprovedVersionId<T extends Record<string, unknown>>(
  db: Database<T>,
  key: LegalDocumentKey,
  now: Date,
): Promise<string | undefined> {
  const [row] = await db
    .select({ id: legalDocuments.id })
    .from(legalDocuments)
    .where(
      and(
        eq(legalDocuments.key, key),
        eq(legalDocuments.isApproved, true),
        isNull(legalDocuments.withdrawnAt),
        lte(legalDocuments.effectiveAt, now),
      ),
    )
    .orderBy(desc(legalDocuments.version))
    .limit(1);

  return row?.id;
}

/**
 * A specific version, for confirming a registration's acknowledged version is still the exact
 * text it was shown (BR-REQ-053-01 criterion 3: an acceptance references the version accepted,
 * not merely "whatever is current now").
 *
 * Withdrawn versions are excluded, and it costs nothing: withdrawal requires zero acceptances
 * and zero acknowledgements, so no registration can be pointing at one. Excluding them here
 * keeps "approved and still offered" a single meaning across the module rather than two that
 * differ by one row.
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
    .where(
      and(
        eq(legalDocuments.key, key),
        eq(legalDocuments.version, version),
        eq(legalDocuments.isApproved, true),
        isNull(legalDocuments.withdrawnAt),
      ),
    )
    .limit(1);

  return row;
}

/**
 * The highest version of a key, whatever its approval state — what "the next version" counts
 * from. A version number is never reused (`docs/RUNBOOKS.md` § Legal document version), so this
 * is the only safe way to ask for one.
 *
 * A withdrawn version still counts, and that is the point of withdrawing rather than deleting.
 * `registrations.privacy_notice_version` is a plain integer with no foreign key; if version 4
 * were removed and the next draft became 4 again, every registration that recorded "notice 4"
 * would become a consent to words written after it was given. The number stays taken.
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
 * The number the next draft of `key` gets — the one answer to "which version is this"
 * (`DECISIONS.md` §151).
 *
 * `max(version) + 1` over the surviving rows is no longer enough, because a row can now stop
 * existing: an approved version nothing relied on can be deleted outright, and if its number
 * came back the words it was published under would be reissued to different text. Every
 * registration carries `privacy_notice_version` as a plain integer with no foreign key, so
 * nothing in the database would notice and nothing in the application could tell afterwards.
 *
 * So the answer is the higher of two things: the largest version still present, and the largest
 * one ever destroyed (`legal_document_numbering`). Deleting the top version therefore skips its
 * number permanently; deleting a middle one changes nothing, because the surviving maximum is
 * already above the floor.
 *
 * Read in one place and used in one place — `createDraftVersion`. A second caller computing
 * `max + 1` for itself is exactly how the floor would be forgotten.
 */
export async function nextVersionNumber<T extends Record<string, unknown>>(
  db: Database<T>,
  key: LegalDocumentKey,
): Promise<number> {
  const latest = await findLatestVersion(db, key);
  const [floor] = await db
    .select({ highest: legalDocumentNumbering.highestRetiredVersion })
    .from(legalDocumentNumbering)
    .where(eq(legalDocumentNumbering.key, key))
    .limit(1);

  return Math.max(latest?.version ?? 0, floor?.highest ?? 0) + 1;
}

/**
 * Take a version number out of circulation for good, as part of the transaction that destroys
 * the row carrying it.
 *
 * `GREATEST` rather than an assignment, so the floor can only ever rise: two deletions
 * committing in either order leave the same number behind, and a stale write cannot lower a
 * floor a later deletion already raised. The row is created on first use — a document nothing
 * has ever been deleted from has no row here at all, which is also what makes this table
 * readable as "these keys have lost a version".
 */
export async function retireVersionNumber<T extends Record<string, unknown>>(
  db: Database<T>,
  key: LegalDocumentKey,
  version: number,
  now: Date,
): Promise<void> {
  await db
    .insert(legalDocumentNumbering)
    .values({ key, highestRetiredVersion: version, updatedAt: now })
    .onConflictDoUpdate({
      target: legalDocumentNumbering.key,
      set: {
        highestRetiredVersion: sql`greatest(${legalDocumentNumbering.highestRetiredVersion}, excluded.highest_retired_version)`,
        updatedAt: now,
      },
    });
}

/**
 * Every approved version of a key, newest first, with its title in one locale — what the event
 * editor offers when an organizer picks the declaration a participant will sign.
 *
 * A *selection*, never an edit: §11.1 keeps legal text out of the CMS entirely, and nothing
 * here or in the editor can change a word of one of these rows.
 *
 * Withdrawn versions are gone from the list, and no event loses its selected value by it: an
 * event pointing at a version is one of the three counts that refuse withdrawal, so a withdrawn
 * version is by construction one nothing here had chosen.
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
    .where(
      and(
        eq(legalDocuments.key, key),
        eq(legalDocuments.isApproved, true),
        isNull(legalDocuments.withdrawnAt),
      ),
    )
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
  /**
   * When the club took this version out of circulation, or `null` — the one reader that keeps
   * withdrawn rows rather than filtering them out.
   *
   * Everything else in this module excludes them, which is what withdrawal *is*. This screen is
   * the exception on purpose: the row still exists, it still holds its number, and the club has
   * to be able to see that — a version that vanished from every list including the one that
   * administers it would look deleted, which is precisely the impression this mechanism exists
   * to avoid giving.
   */
  withdrawnAt: Date | null;
  withdrawnByStaffUserId: string | null;
  locales: string[];
  acceptanceCount: number;
  eventCount: number;
  /**
   * Registrations that recorded this version's *number* as the privacy notice they
   * acknowledged — the reliance the database cannot see.
   *
   * `registrations.privacy_notice_version` is a plain `integer` with no foreign key, as are
   * `results_consent_version` and `health_consent_version`. So a privacy notice hundreds of
   * people acknowledged looks, to `acceptanceCount` and `eventCount`, exactly like one nobody
   * has ever touched — and PostgreSQL would raise nothing at all if it were deleted. Only
   * `EVENT_DECLARATION` versions get a `declaration_acceptances` row; this is the equivalent
   * count for the other key, and it is the reason withdrawing a notice people registered under
   * is refused.
   */
  privacyAcknowledgementCount: number;
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
      withdrawnAt: legalDocuments.withdrawnAt,
      withdrawnByStaffUserId: legalDocuments.withdrawnByStaffUserId,
      locales: sql<string[]>`coalesce(array_agg(distinct ${legalDocumentTranslations.locale}::text) filter (where ${legalDocumentTranslations.locale} is not null), '{}')`,
      // Every signature against this version: a race's acceptances, and a group run's optional
      // self-declarations (§NNN) — both are somebody relying on these exact words.
      acceptanceCount: sql<number>`(
        (select count(*)::int from ${declarationAcceptances} where ${declarationAcceptances.legalDocumentId} = ${legalDocuments.id})
        + (select count(*)::int from ${groupRunDeclarations} where ${groupRunDeclarations.legalDocumentId} = ${legalDocuments.id})
      )`,
      eventCount: sql<number>`(select count(*)::int from ${events} where ${events.declarationDocumentId} = ${legalDocuments.id})`,
      // Matched on the version *number*, and only for the notice key, because that is the only
      // shape this reference has: there is no id to join on.
      privacyAcknowledgementCount: sql<number>`(
        select count(*)::int from ${registrations}
        where ${legalDocuments.key} = 'PRIVACY_NOTICE'
          and (
            ${registrations.privacyNoticeVersion} = ${legalDocuments.version}
            or ${registrations.resultsConsentVersion} = ${legalDocuments.version}
            or ${registrations.healthConsentVersion} = ${legalDocuments.version}
          )
      )`,
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
 * How many registrations of this environment agreed to "the terms" while a version was in force —
 * the evidence a terms version has instead of a count (`DECISIONS.md` §316).
 *
 * A registration records `privacy_notice_version` and never a terms version, so nothing points at
 * a TERMS row. But agreeing leaves an instant behind, and whatever was in force at that instant is
 * what was agreed to; so "did anybody accept version 2" is "did any registration agree inside
 * version 2's window", and that needs no new column. There are two such instants, and a
 * registration counts once if either falls inside:
 *
 * - **The form, submitted.** The terms box is ticked when the form is posted.
 * - **The declaration, signed.** Its text says "Sunt de acord cu termenii, condițiile și
 *   regulamentul evenimentului" — "I agree with the event's terms, conditions and rules" — and
 *   each signing is a `declaration_acceptances` row with its own `accepted_at`, usually days after
 *   the form (the participation window, §104). A registration submitted under version 1 whose
 *   declaration was signed under version 2 agreed to "the terms" under version 2 as well. Whether
 *   that sentence means the platform's terms or only the event's own rules is not something the
 *   code can settle, so it is read the wide way: counting it can refuse a version nobody meant,
 *   and not counting it could pass one somebody signed under. Paper signatures recorded at the
 *   desk count the same way; they carry the same sentence.
 *
 * **Every submission this table can still see, and a little more.** A registration's first
 * submission is `created_at` (and `submitted_at`, set with it); each re-submission of a cancelled
 * or expired row rewrites `privacy_acknowledged_at` to its own instant. A restart in between two
 * others is overwritten and leaves no trace — so a row whose earliest and latest submissions
 * *straddle* the window counts too, because one of its lost restarts may have fallen inside it.
 * That can refuse a version nobody in fact accepted; it cannot pass one somebody did. Signatures
 * need no such allowance: every one keeps its row.
 *
 * **Every kind and every source.** A `TEST` registration on QA ticked the same box as a real one,
 * and a staff-entered registration was entered under the terms in force; neither is a count the
 * club is given as a figure about its participants (§30), so counting them costs nothing and
 * leaving them out would be the one way to be wrong. An erased registration is gone, its
 * declaration acceptance with it (§44), and is not counted, exactly as it is not counted for the
 * privacy notice.
 */
export async function countRegistrationsAgreeingWithin<T extends Record<string, unknown>>(
  db: Database<T>,
  window: { from: Date; until: Date | null },
): Promise<number> {
  const from = sql`${window.from.toISOString()}::timestamptz`;
  const until = window.until ? sql`${window.until.toISOString()}::timestamptz` : null;

  const earliest = sql`least(${registrations.createdAt}, ${registrations.submittedAt}, ${registrations.privacyAcknowledgedAt})`;
  const latest = sql`greatest(${registrations.createdAt}, ${registrations.submittedAt}, ${registrations.privacyAcknowledgedAt})`;
  const submittedWithin = sql`(${latest} >= ${from}${until ? sql` and ${earliest} < ${until}` : sql``})`;

  // Correlated on the registration, so a row with several signatures — a re-signed declaration —
  // is still one registration. `declaration_acceptances_registration_accepted_at_idx` answers it.
  const signedWithin = sql`exists (
    select 1 from ${declarationAcceptances}
    where ${declarationAcceptances.registrationId} = ${registrations.id}
      and ${declarationAcceptances.acceptedAt} >= ${from}${until ? sql` and ${declarationAcceptances.acceptedAt} < ${until}` : sql``}
  )`;

  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(registrations)
    .where(sql`${submittedWithin} or ${signedWithin}`);

  return row?.count ?? 0;
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
      withdrawnAt: Date | null;
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
      // Read but never filtered on: this is the page somebody lands on from the withdrawn fold,
      // and a version that renders as though nothing happened to it would be a lie of omission.
      withdrawnAt: legalDocuments.withdrawnAt,
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
