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
import { routing, type Locale } from "@/i18n/routing";
import type { LegalDocumentTranslationInput } from "./domain/content-hash";
import { GROUP_RUN_DECLARATION_KEYS, raceDeclarationKeysFor, RACE_DECLARATION_KEYS } from "./domain/keys";
import {
  asksForMinorSignature,
  describesListSocials,
  describesListStates,
  describesNewsletter,
  describesTeamPage,
  MINIMUM_AGE_MERGE_FIELD,
  mergeFieldsIn,
} from "./domain/merge-fields";

/**
 * Reading and writing `legal_documents`/`legal_document_translations` (AGENTS.md §12.5). No update
 * function, on purpose: a version is immutable once inserted, so no request handler can edit legal
 * text (AGENTS.md §11.1).
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
 * The version of `key` in force for `locale` at `now`: the highest approved, not withdrawn, whose
 * `effective_at` has passed (AGENTS.md §12.5). Registration refuses without one (BR-REQ-053-01).
 * The `withdrawn_at` filter keeps a version approved ahead of its date and then withdrawn from
 * taking effect on its day.
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
 * The declaration a race's participant signs (§515), per `raceDeclarationKeysFor`. Every screen,
 * signature, paper and desk reads it here so none can name a different text. An unknown event gets
 * the trail text's answer.
 */
export async function findEventDeclaration<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
  locale: Locale,
  now: Date,
): Promise<CurrentLegalDocument | undefined> {
  const [event] = await db
    .select({ surface: events.surface, chosenKey: legalDocuments.key })
    .from(events)
    .leftJoin(legalDocuments, eq(legalDocuments.id, events.declarationDocumentId))
    .where(eq(events.id, eventId))
    .limit(1);
  for (const key of raceDeclarationKeysFor({ surface: event?.surface ?? null, chosenKey: event?.chosenKey ?? null })) {
    const document = await findCurrentApprovedDocument(db, key, locale, now);
    if (document) return document;
  }
  return undefined;
}

/**
 * Whether the declaration in force asks a minor to sign beside the parent (§330); false while none
 * is approved. Asked in the registration's language, as `signDeclaration` binds. Without an event
 * (a list spanning events), the trail text's answer.
 */
export async function declarationAsksMinorToSign<T extends Record<string, unknown>>(
  db: Database<T>,
  locale: Locale,
  now: Date,
  eventId?: string,
): Promise<boolean> {
  const document = eventId
    ? await findEventDeclaration(db, eventId, locale, now)
    : await findCurrentApprovedDocument(db, "EVENT_DECLARATION", locale, now);
  return document ? asksForMinorSignature(document.body) : false;
}

/**
 * The group-run declaration version in force per surface, or null (§393, §448). Asked in Romanian:
 * approval requires both languages (§46).
 */
export async function groupRunDeclarationsInForce<T extends Record<string, unknown>>(
  db: Database<T>,
  now: Date,
): Promise<Record<"ASPHALT" | "TRAIL", { version: number } | null>> {
  const [asphalt, trail] = await Promise.all([
    findCurrentApprovedDocument(db, "GROUP_RUN_DECLARATION_ASPHALT", "ro", now),
    findCurrentApprovedDocument(db, "GROUP_RUN_DECLARATION_TRAIL", "ro", now),
  ]);
  return { ASPHALT: asphalt ? { version: asphalt.version } : null, TRAIL: trail ? { version: trail.version } : null };
}

/**
 * Both race declarations are in force in every language from the shared body that names
 * `{{minimumAge}}` (§515) — `/admin/tasks`' «Declarațiile de concurs» row.
 */
export async function raceDeclarationsCurrent<T extends Record<string, unknown>>(db: Database<T>, now: Date): Promise<boolean> {
  const texts = await Promise.all(
    RACE_DECLARATION_KEYS.flatMap((key) => routing.locales.map((locale) => findCurrentApprovedDocument(db, key, locale, now))),
  );
  return texts.every((document) => document !== undefined && mergeFieldsIn(document.body).has(MINIMUM_AGE_MERGE_FIELD));
}

/**
 * Every group-run text in force, in every language, names `{{series}}` (§523); null while none is
 * in force. `/admin/tasks`' series row.
 */
export async function groupRunDeclarationsSeriesCurrent<T extends Record<string, unknown>>(db: Database<T>, now: Date): Promise<boolean | null> {
  const texts = await Promise.all(
    GROUP_RUN_DECLARATION_KEYS.flatMap((key) => routing.locales.map((locale) => findCurrentApprovedDocument(db, key, locale, now))),
  );
  const inForce = texts.filter((document) => document !== undefined);
  if (inForce.length === 0) return null;
  return inForce.every((document) => mergeFieldsIn(document.body).has("series"));
}

/** Per language, for a list whose rows are in either (§330). */
export async function declarationAsksMinorToSignByLocale<T extends Record<string, unknown>>(
  db: Database<T>,
  now: Date,
  eventId?: string,
): Promise<Record<Locale, boolean>> {
  const [ro, en] = await Promise.all([declarationAsksMinorToSign(db, "ro", now, eventId), declarationAsksMinorToSign(db, "en", now, eventId)]);
  return { ro, en };
}

/**
 * Per event, for a list spanning events (§515): each race's own declaration may ask differently.
 * One read per distinct event.
 */
export async function declarationAsksMinorToSignByEvent<T extends Record<string, unknown>>(
  db: Database<T>,
  now: Date,
  eventIds: readonly string[],
): Promise<Record<string, Record<Locale, boolean>>> {
  const distinct = [...new Set(eventIds)];
  const answers = await Promise.all(distinct.map((eventId) => declarationAsksMinorToSignByLocale(db, now, eventId)));
  return Object.fromEntries(distinct.map((eventId, index) => [eventId, answers[index]]));
}

/**
 * The notice in force describes the list's states (§396) in every language — the list is one list.
 * Backoffice read; public pages use `cachedListStatesDisclosed`.
 */
export async function noticeDescribesListStates<T extends Record<string, unknown>>(db: Database<T>, now: Date): Promise<boolean> {
  const notices = await Promise.all(routing.locales.map((locale) => findCurrentApprovedDocument(db, "PRIVACY_NOTICE", locale, now)));
  return notices.every((notice) => notice !== undefined && describesListStates(notice.body));
}

/** Same for the socials (§500); public pages use `cachedListSocialsDisclosed`. */
export async function noticeDescribesListSocials<T extends Record<string, unknown>>(db: Database<T>, now: Date): Promise<boolean> {
  const notices = await Promise.all(routing.locales.map((locale) => findCurrentApprovedDocument(db, "PRIVACY_NOTICE", locale, now)));
  return notices.every((notice) => notice !== undefined && describesListSocials(notice.body));
}

/** Same for the newsletter (§445); the contact page uses `cachedNewsletterOffered`. */
export async function noticeDescribesNewsletter<T extends Record<string, unknown>>(db: Database<T>, now: Date): Promise<boolean> {
  const notices = await Promise.all(routing.locales.map((locale) => findCurrentApprovedDocument(db, "PRIVACY_NOTICE", locale, now)));
  return notices.every((notice) => notice !== undefined && describesNewsletter(notice.body));
}

/** Same for «Echipa» (§459). */
export async function noticeDescribesTeamPage<T extends Record<string, unknown>>(db: Database<T>, now: Date): Promise<boolean> {
  const notices = await Promise.all(routing.locales.map((locale) => findCurrentApprovedDocument(db, "PRIVACY_NOTICE", locale, now)));
  return notices.every((notice) => notice !== undefined && describesTeamPage(notice.body));
}

/**
 * The lowest approved, not withdrawn notice version describing the list's states in every language,
 * or null (§421, narrowing §396). Only registrations that recorded this version or later are shown
 * as pending or waiting; the confirmed list is unchanged.
 *
 * Assumes the marker, once approved, is never dropped by a later version: the gate is
 * `privacy_notice_version >= this`. Nothing in `/admin/legal` enforces it; to be exact, return the
 * set of versions and gate with `inArray` instead.
 */
export async function findFirstStatesNoticeVersion<T extends Record<string, unknown>>(db: Database<T>): Promise<number | null> {
  const rows = await db
    .select({ version: legalDocuments.version, locale: legalDocumentTranslations.locale, body: legalDocumentTranslations.bodyJson })
    .from(legalDocuments)
    .innerJoin(legalDocumentTranslations, eq(legalDocumentTranslations.legalDocumentId, legalDocuments.id))
    .where(and(eq(legalDocuments.key, "PRIVACY_NOTICE"), eq(legalDocuments.isApproved, true), isNull(legalDocuments.withdrawnAt)))
    .orderBy(legalDocuments.version);
  const byVersion = new Map<number, Map<string, unknown>>();
  for (const row of rows) {
    const bodies = byVersion.get(row.version) ?? new Map<string, unknown>();
    bodies.set(row.locale, row.body);
    byVersion.set(row.version, bodies);
  }
  for (const [version, bodies] of [...byVersion.entries()].sort(([a], [b]) => a - b)) {
    if (routing.locales.every((locale) => bodies.has(locale) && describesListStates(bodies.get(locale)))) return version;
  }
  return null;
}

/**
 * The instants at which `findCurrentApprovedDocument` can change its answer without a write (§333),
 * by the same conditions; the public cache keys the text in force by them (`public-cache/clock.ts`).
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
 * The id in force for `key` at `now`, for withdrawal. Unjoined on purpose: the translation join
 * would answer nothing for a version missing one locale, and wrongly allow withdrawing the row
 * served in the other.
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
 * The highest version of a key in any state. Withdrawn versions count: registrations refer to
 * notice versions by plain integer, so a number is never reused (`docs/RUNBOOKS.md`).
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
 * The next draft's number (§151): the higher of the largest surviving version and the largest ever
 * deleted (`legal_document_numbering`), so a deleted number never returns. Only
 * `createDraftVersion` may call it.
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
 * Retire a version number, inside the transaction that deletes its row. `GREATEST`, so the floor
 * only rises whatever order deletions commit in; the row is created on first use.
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
 * Approved versions of a key, newest first, for the event editor's declaration choice — a selection,
 * never an edit (AGENTS.md §11.1). Withdrawn ones are omitted; no event can point at one, since an
 * event's choice refuses withdrawal.
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

/** Both race declarations' approved versions (§515): trail then road, each newest first. */
export async function listApprovedRaceDeclarations<T extends Record<string, unknown>>(
  db: Database<T>,
  locale: Locale,
): Promise<Array<{ id: string; key: (typeof RACE_DECLARATION_KEYS)[number]; version: number; title: string; effectiveAt: Date }>> {
  const lists = await Promise.all(
    RACE_DECLARATION_KEYS.map(async (key) => (await listApprovedVersions(db, key, locale)).map((row) => ({ ...row, key }))),
  );
  return lists.flat();
}

/**
 * Every version of every key for the backoffice, with both titles and the reference counts — so the
 * screen shows who relies on a version (AGENTS.md §12.5).
 */
export type LegalDocumentVersionRow = {
  id: string;
  key: LegalDocumentKey;
  version: number;
  isApproved: boolean;
  effectiveAt: Date;
  approvedByStaffUserId: string | null;
  /** `computeContentHash`, compared by «Regenerează din șabloane» (§532). */
  contentSha256: string;
  /** The one reader that keeps withdrawn rows, so a withdrawn version never looks deleted. */
  withdrawnAt: Date | null;
  withdrawnByStaffUserId: string | null;
  locales: string[];
  acceptanceCount: number;
  eventCount: number;
  /**
   * Registrations that recorded this version's number as notice or terms (§421). These columns are
   * plain integers with no foreign key, so the database cannot see this reliance.
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
      contentSha256: legalDocuments.contentSha256,
      withdrawnAt: legalDocuments.withdrawnAt,
      withdrawnByStaffUserId: legalDocuments.withdrawnByStaffUserId,
      locales: sql<string[]>`coalesce(array_agg(distinct ${legalDocumentTranslations.locale}::text) filter (where ${legalDocumentTranslations.locale} is not null), '{}')`,
      // A race's acceptances and a group run's self-declarations (§393).
      acceptanceCount: sql<number>`(
        (select count(*)::int from ${declarationAcceptances} where ${declarationAcceptances.legalDocumentId} = ${legalDocuments.id})
        + (select count(*)::int from ${groupRunDeclarations} where ${groupRunDeclarations.legalDocumentId} = ${legalDocuments.id})
      )`,
      eventCount: sql<number>`(select count(*)::int from ${events} where ${events.declarationDocumentId} = ${legalDocuments.id})`,
      // By number, per key — there is no id to join on. Terms since §421; older rows are answered
      // by the in-force window (§316).
      privacyAcknowledgementCount: sql<number>`(
        select count(*)::int from ${registrations}
        where (
          ${legalDocuments.key} = 'PRIVACY_NOTICE'
          and (
            ${registrations.privacyNoticeVersion} = ${legalDocuments.version}
            or ${registrations.resultsConsentVersion} = ${legalDocuments.version}
            or ${registrations.healthConsentVersion} = ${legalDocuments.version}
          )
        ) or (
          ${legalDocuments.key} = 'TERMS'
          and ${registrations.termsVersion} = ${legalDocuments.version}
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
 * Registrations that agreed to "the terms" while a version was in force — a terms version's
 * evidence for rows without `terms_version` (§316). A registration counts if its form submission or
 * a declaration signature (which also agrees to the terms, read widely) falls in the window.
 *
 * Errs towards refusing deletion: a restart overwrites earlier submission instants, so a row whose
 * earliest and latest submissions straddle the window counts. Every kind and source counts (TEST
 * and staff entries included, §30); erased registrations are gone (§44).
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

  // One per registration however many signatures; `declaration_acceptances_registration_accepted_at_idx`.
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

/** One version's text in every locale, drafts included — they are read before approval. */
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
      // Read, never filtered: the withdrawn fold links here.
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
