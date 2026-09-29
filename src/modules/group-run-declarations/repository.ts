import { and, asc, eq, gt, inArray, isNotNull, or, sql } from "drizzle-orm";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events, eventTranslations } from "@/db/schema/events";
import { groupRunDeclarations } from "@/db/schema/group-run-declarations";
import { type LegalDocumentKey, legalDocumentTranslations, legalDocuments } from "@/db/schema/legal-documents";
import { staffUsers } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { type Locale, routing } from "@/i18n/routing";
import { seriesKey } from "@/modules/events/domain/series";
import { heldRefusal } from "@/modules/registrations/declaration-hold";
import type { SeriesSignature } from "./domain";

/**
 * Rows of a group run's self-declarations (§393). Immutable (§57) except the swept identity
 * document, the rehomed date and the view token; kept until the signer asks (§503), removed only by
 * the audited erase or with the run's last date (§523).
 *
 * A series' declaration covers the run (§523): the row points at the date signed on and records
 * `series_key`; readers read every date §113 groups. A one-off's or pre-§523 row covers its date only.
 */

export type NewGroupRunDeclaration = typeof groupRunDeclarations.$inferInsert;

/**
 * Undefined when `group_run_declarations_one_per_series_signer_version` already holds this signer,
 * version and series (or date), so two concurrent presses write one row.
 */
export async function insertGroupRunDeclaration<T extends Record<string, unknown>>(
  db: Database<T>,
  values: NewGroupRunDeclaration,
): Promise<typeof groupRunDeclarations.$inferSelect | undefined> {
  const [row] = await db.insert(groupRunDeclarations).values(values).onConflictDoNothing().returning();
  return row;
}

/** Every date of the event's run, itself included, soonest first (§523, §113). */
export async function listSeriesDatesOf<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
): Promise<{ id: string; startsAt: Date }[]> {
  return (await findRunSeries(db, eventId)).dates;
}

/**
 * The event's run (§523): its dates and the series key, null for a one-off. Grouped in JS with the
 * listing's own `seriesKey` (§113) rather than a second SQL spelling; one type's titles are few.
 */
export async function findRunSeries<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
): Promise<{ key: string | null; dates: { id: string; startsAt: Date }[] }> {
  const [self] = await db
    .select({ type: events.type, title: eventTranslations.title, startsAt: events.startsAt })
    .from(events)
    .leftJoin(eventTranslations, and(eq(eventTranslations.eventId, events.id), eq(eventTranslations.locale, routing.defaultLocale)))
    .where(eq(events.id, eventId))
    .limit(1);
  if (!self) return { key: null, dates: [] };
  if (self.title === null) return { key: null, dates: [{ id: eventId, startsAt: self.startsAt }] };
  const key = seriesKey({ type: self.type, title: self.title });
  const candidates = await db
    .select({ id: events.id, type: events.type, title: eventTranslations.title, startsAt: events.startsAt })
    .from(events)
    .innerJoin(eventTranslations, and(eq(eventTranslations.eventId, events.id), eq(eventTranslations.locale, routing.defaultLocale)))
    .where(eq(events.type, self.type))
    .orderBy(asc(events.startsAt));
  const members = candidates.filter((row) => row.id === eventId || seriesKey(row) === key).map(({ id, startsAt }) => ({ id, startsAt }));
  const dates = members.some((row) => row.id === eventId) ? members : [...members, { id: eventId, startsAt: self.startsAt }];
  return { key: dates.length > 1 ? key : null, dates };
}

/** A row covers a date if signed on it, or signed for the series on any of its dates (§523). */
function coversDate(eventId: string, seriesDates: readonly string[]) {
  return or(
    eq(groupRunDeclarations.eventId, eventId),
    and(isNotNull(groupRunDeclarations.seriesKey), inArray(groupRunDeclarations.eventId, [...seriesDates, eventId])),
  );
}

/** A backoffice row (§393, §499, §523); never the identity document or the address. */
export type GroupRunDeclarationListRow = {
  id: string;
  eventId: string;
  typedName: string;
  acceptedAt: Date;
  locale: Locale;
  version: number;
  series: boolean;
  /** The SHA-256 of the exact text signed (§556); null on a row from before it. */
  textHash: string | null;
  /** «Păstrează: reclamație / litigiu în curs» (§556): whether, why, when and by whom. */
  retentionHold: boolean;
  retentionHoldReason: string | null;
  retentionHoldAt: Date | null;
  retentionHoldByName: string | null;
};

/** Every date's declarations of the event's run, in signing order — the same list on each date (§523). */
export async function listGroupRunDeclarations<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
): Promise<GroupRunDeclarationListRow[]> {
  const dates = (await listSeriesDatesOf(db, eventId)).map((date) => date.id);
  if (dates.length === 0) return [];
  const rows = await db
    .select({
      id: groupRunDeclarations.id,
      eventId: groupRunDeclarations.eventId,
      typedName: groupRunDeclarations.typedName,
      acceptedAt: groupRunDeclarations.acceptedAt,
      locale: groupRunDeclarations.locale,
      version: groupRunDeclarations.declarationVersion,
      seriesKey: groupRunDeclarations.seriesKey,
      textHash: groupRunDeclarations.textHash,
      retentionHold: groupRunDeclarations.retentionHold,
      retentionHoldReason: groupRunDeclarations.retentionHoldReason,
      retentionHoldAt: groupRunDeclarations.retentionHoldAt,
      retentionHoldByName: staffUsers.displayName,
    })
    .from(groupRunDeclarations)
    .leftJoin(staffUsers, eq(staffUsers.id, groupRunDeclarations.retentionHoldByStaffUserId))
    .where(inArray(groupRunDeclarations.eventId, dates))
    .orderBy(asc(groupRunDeclarations.acceptedAt));
  return rows.map(({ seriesKey: key, ...row }) => ({ ...row, series: key !== null }));
}

/** Signatures of `documentId` covering a date, for `keptSignature` (§523). */
export async function listCoveringSignatures<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
  seriesDates: readonly string[],
  documentId: string,
): Promise<SeriesSignature[]> {
  return db
    .select({
      id: groupRunDeclarations.id,
      legalDocumentId: groupRunDeclarations.legalDocumentId,
      email: groupRunDeclarations.email,
      typedName: groupRunDeclarations.typedName,
      acceptedAt: groupRunDeclarations.acceptedAt,
    })
    .from(groupRunDeclarations)
    .where(and(eq(groupRunDeclarations.legalDocumentId, documentId), coversDate(eventId, seriesDates)))
    .orderBy(asc(groupRunDeclarations.acceptedAt));
}

/**
 * Before a date is deleted, moves its series declarations to the next date (else the latest before)
 * so the evidence outlives the date (§523); the PDF still reads `signed_facts`. One-off and pre-§523
 * rows cascade with the date (§393). Returns how many moved.
 */
export async function rehomeGroupRunDeclarationsOfEvent<T extends Record<string, unknown>>(db: Database<T>, eventId: string): Promise<number> {
  const [any] = await db
    .select({ id: groupRunDeclarations.id })
    .from(groupRunDeclarations)
    .where(and(eq(groupRunDeclarations.eventId, eventId), isNotNull(groupRunDeclarations.seriesKey)))
    .limit(1);
  if (!any) return 0;
  const dates = await listSeriesDatesOf(db, eventId);
  const self = dates.find((date) => date.id === eventId);
  const others = dates.filter((date) => date.id !== eventId);
  if (!self || others.length === 0) return 0;
  const target = others.find((date) => date.startsAt.getTime() > self.startsAt.getTime()) ?? others[others.length - 1];
  const moved = await db
    .update(groupRunDeclarations)
    .set({ eventId: target.id })
    .where(and(eq(groupRunDeclarations.eventId, eventId), isNotNull(groupRunDeclarations.seriesKey)))
    .returning({ id: groupRunDeclarations.id });
  return moved.length;
}

/** A signed declaration with the text version and language it was signed in; the hash is the row's own (§57). */
export async function findSignedGroupRunDeclaration<T extends Record<string, unknown>>(db: Database<T>, id: string) {
  const [row] = await db
    .select({
      id: groupRunDeclarations.id,
      eventId: groupRunDeclarations.eventId,
      key: legalDocuments.key,
      version: groupRunDeclarations.declarationVersion,
      contentSha256: groupRunDeclarations.contentSha256,
      // The fingerprint of the exact text signed (§556); null on a row from before it.
      textHash: groupRunDeclarations.textHash,
      // The day the signed version took effect, for the PDF's version line (§499).
      effectiveAt: legalDocuments.effectiveAt,
      locale: groupRunDeclarations.locale,
      typedName: groupRunDeclarations.typedName,
      idDocument: groupRunDeclarations.idDocument,
      email: groupRunDeclarations.email,
      acceptedAt: groupRunDeclarations.acceptedAt,
      // The facts as signed (§523).
      signedFacts: groupRunDeclarations.signedFacts,
      seriesKey: groupRunDeclarations.seriesKey,
      title: legalDocumentTranslations.title,
      body: legalDocumentTranslations.bodyJson,
    })
    .from(groupRunDeclarations)
    .innerJoin(legalDocuments, eq(legalDocuments.id, groupRunDeclarations.legalDocumentId))
    .innerJoin(
      legalDocumentTranslations,
      and(
        eq(legalDocumentTranslations.legalDocumentId, legalDocuments.id),
        eq(legalDocumentTranslations.locale, groupRunDeclarations.locale),
      ),
    )
    .where(eq(groupRunDeclarations.id, id))
    .limit(1);
  return row;
}

export type SignedGroupRunDeclaration = NonNullable<Awaited<ReturnType<typeof findSignedGroupRunDeclaration>>>;

/** The signer's link hash, set when their copy is sent; a newer copy's replaces it (§523). */
export async function setGroupRunDeclarationViewToken<T extends Record<string, unknown>>(db: Database<T>, id: string, tokenHash: string): Promise<void> {
  await db.update(groupRunDeclarations).set({ viewTokenHash: tokenHash }).where(eq(groupRunDeclarations.id, id));
}

/**
 * The declaration a link's hash names, if it covers this date and is of this text kind (§523,
 * AGENTS.md §12.8); undefined otherwise.
 */
export async function findSignatureByViewToken<T extends Record<string, unknown>>(
  db: Database<T>,
  tokenHash: string,
  eventId: string,
  key: LegalDocumentKey,
): Promise<{ legalDocumentId: string; version: number; acceptedAt: Date; series: boolean } | undefined> {
  const dates = (await listSeriesDatesOf(db, eventId)).map((date) => date.id);
  const [row] = await db
    .select({
      legalDocumentId: groupRunDeclarations.legalDocumentId,
      version: groupRunDeclarations.declarationVersion,
      acceptedAt: groupRunDeclarations.acceptedAt,
      series: sql<boolean>`${groupRunDeclarations.seriesKey} IS NOT NULL`,
    })
    .from(groupRunDeclarations)
    .innerJoin(legalDocuments, eq(legalDocuments.id, groupRunDeclarations.legalDocumentId))
    .where(and(eq(groupRunDeclarations.viewTokenHash, tokenHash), eq(legalDocuments.key, key), coversDate(eventId, dates)))
    .limit(1);
  return row;
}

/** The run's next published date, else the one signed on, so the link opens a page still offering the run (§523). */
export async function nextDateOfRun<T extends Record<string, unknown>>(db: Database<T>, eventId: string, now: Date): Promise<string> {
  const { key, dates } = await findRunSeries(db, eventId);
  if (key === null) return eventId;
  // A public signer's link never lands on a date the club made the members' (§552): that page is
  // a 404 for them. A member who signed on a members' date may be sent to any date of the run.
  const [signed] = await db.select({ membersOnly: events.membersOnly }).from(events).where(eq(events.id, eventId)).limit(1);
  const [next] = await db
    .select({ id: events.id })
    .from(events)
    .where(
      and(
        inArray(events.id, dates.map((date) => date.id)),
        gt(events.startsAt, now),
        eq(events.editorialStatus, "PUBLISHED"),
        signed?.membersOnly ? undefined : eq(events.membersOnly, false),
      ),
    )
    .orderBy(asc(events.startsAt))
    .limit(1);
  return next?.id ?? eventId;
}

/**
 * Deletes the outbox rows about an event's declarations before the event goes (§393): otherwise they
 * keep the signer's address and can never render. Matches the payload id as text, as the erase does.
 */
export async function deleteGroupRunDeclarationMessagesOfEvent<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
): Promise<number> {
  const deleted = await db
    .delete(emailOutbox)
    .where(
      inArray(
        sql`${emailOutbox.payloadJson}->>'groupRunDeclarationId'`,
        db
          .select({ id: sql<string>`${groupRunDeclarations.id}::text` })
          .from(groupRunDeclarations)
          .where(eq(groupRunDeclarations.eventId, eventId)),
      ),
    )
    .returning({ id: emailOutbox.id });
  return deleted.length;
}

/**
 * Before a date of a run is deleted (§556): a held declaration still on it — a one-off's, or a
 * series' with no other date to move to (`rehomeGroupRunDeclarationsOfEvent` runs first) — would
 * cascade away with the date, so the delete is refused until an Administrator clears the hold.
 */
export async function refuseHeldGroupRunDeclarationsOfEvent<T extends Record<string, unknown>>(db: Database<T>, eventId: string): Promise<void> {
  // Every row of the date locked until the caller's transaction commits: a hold pressed meanwhile waits.
  const rows = await db
    .select({ held: groupRunDeclarations.retentionHold })
    .from(groupRunDeclarations)
    .where(eq(groupRunDeclarations.eventId, eventId))
    .for("update");
  if (rows.some((row) => row.held)) throw heldRefusal();
}

/** An outbox row's declaration id (§393), or null when its payload carries none. */
export function groupRunDeclarationIdOf(payload: unknown): string | null {
  const id = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>).groupRunDeclarationId : undefined;
  return typeof id === "string" ? id : null;
}
