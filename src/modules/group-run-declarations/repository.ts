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
 * The rows of a group run's optional self-declarations (§393). No update: a signature is what it
 * was when it was made (§57), apart from the identity document the retention sweep clears at seven
 * days, the date a series' declaration hangs on when that date is deleted
 * (`rehomeGroupRunDeclarationsOfEvent`), and the signer's own link, minted when their copy is sent
 * (`setGroupRunDeclarationViewToken`). Rows are kept until the signer asks for their deletion
 * (§503): they leave by the Administrator's erase, audited, or with the run's last date — never
 * by a public press (§523).
 *
 * **A series' declaration belongs to the run, not to one date (§523).** A weekly run is many rows of
 * `events` (§113), and a returning runner signs once. The row points at the date it was signed on
 * and records the series it covers (`series_key`, as `seriesKey` wrote it then); everything that
 * reads the declarations reads the whole series: the dates §113 groups, the same type and the same
 * title (trimmed, case-folded), in the default language — the listing's own rule. A date renamed on
 * purpose ("… — ediție de Crăciun") leaves the series and asks its own declaration, as it leaves the
 * line. A one-off run's declaration (`series_key` null), and every row from before §523, covers its
 * own date only, as its text said.
 */

export type NewGroupRunDeclaration = typeof groupRunDeclarations.$inferInsert;

/**
 * Writes one signature, or nothing when the same person's signature of the same version already
 * covers the same series (or date): the unique index `group_run_declarations_one_per_series_signer_version`
 * decides, so two presses at once write one row and the second gets undefined — and reads the first.
 */
export async function insertGroupRunDeclaration<T extends Record<string, unknown>>(
  db: Database<T>,
  values: NewGroupRunDeclaration,
): Promise<typeof groupRunDeclarations.$inferSelect | undefined> {
  const [row] = await db.insert(groupRunDeclarations).values(values).onConflictDoNothing().returning();
  return row;
}

/**
 * Every date of the run an event belongs to, itself included, soonest first (§523): the events of
 * its type whose default-language title is the same run's by `seriesKey` (§113) — the listing's own
 * rule, so the declaration covers exactly the dates the reader sees as one line. An event with no
 * default-language title is a series of one. The titles of one type are few (a weekly run for a few
 * seasons is a few hundred rows of two short columns), so they are compared here with the listing's
 * own function rather than a second, SQL spelling of it.
 */
export async function listSeriesDatesOf<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
): Promise<{ id: string; startsAt: Date }[]> {
  return (await findRunSeries(db, eventId)).dates;
}

/**
 * The run an event belongs to (§523): its dates, soonest first, and the series' key — null for a
 * one-off run, a date the grouping gives no other.
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

/**
 * The condition "this row covers that date" (§523): signed on it, or signed for the series on any of
 * the series' dates. A one-off's, or a row from before §523, covers only its own date.
 */
function coversDate(eventId: string, seriesDates: readonly string[]) {
  return or(
    eq(groupRunDeclarations.eventId, eventId),
    and(isNotNull(groupRunDeclarations.seriesKey), inArray(groupRunDeclarations.eventId, [...seriesDates, eventId])),
  );
}

/**
 * What the backoffice lists (§393): who, when, and against which version of the text (§499) —
 * and, since §523, on which date of the run it was signed, for the PDF's address, and whether it
 * covers the series (`series`, the row's «serie» mark). Never the identity document or the address.
 */
export type GroupRunDeclarationListRow = {
  id: string;
  eventId: string;
  typedName: string;
  acceptedAt: Date;
  locale: Locale;
  version: number;
  series: boolean;
  /** The SHA-256 of the exact text signed (§NNN); null on a row from before it. */
  textHash: string | null;
  /** «Păstrează: reclamație / litigiu în curs» (§NNN): whether, why, when and by whom. */
  retentionHold: boolean;
  retentionHoldReason: string | null;
  retentionHoldAt: Date | null;
  retentionHoldByName: string | null;
};

/**
 * The declarations of the run an event belongs to (§523): every date's, since one signature covers
 * them all — the same list on each date's backoffice page, in the order they were signed.
 */
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

/**
 * The signatures of the version in force that cover a date (§523): what the signing press reads to
 * keep one declaration per person, series and version (`keptSignature`).
 */
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
 * Before a date of a run is deleted (§523): a series' declarations cover the run's other dates too,
 * so they move to another date rather than cascading away with this one — the next date after it,
 * or, when it was the last, the latest before it, so the evidence is never lost while the run has a
 * date. What a moved declaration says does not move with it: its PDF is drawn from what the blanks
 * said at the signing (`signed_facts`). A one-off's, and a row from before §523, covered this date
 * only, and go with it as before (§393), their outbox rows first (`deleteGroupRunDeclarationMessagesOfEvent`).
 * Returns how many moved.
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

/**
 * One signed declaration with the text it was signed against: the version by id, in the language
 * it was signed in — what the PDF is drawn from. The hash is the row's own copy (§57).
 */
export async function findSignedGroupRunDeclaration<T extends Record<string, unknown>>(db: Database<T>, id: string) {
  const [row] = await db
    .select({
      id: groupRunDeclarations.id,
      eventId: groupRunDeclarations.eventId,
      key: legalDocuments.key,
      version: groupRunDeclarations.declarationVersion,
      contentSha256: groupRunDeclarations.contentSha256,
      // The fingerprint of the exact text signed (§NNN); null on a row from before it.
      textHash: groupRunDeclarations.textHash,
      // The day the signed version took effect, for the PDF's version line (§499).
      effectiveAt: legalDocuments.effectiveAt,
      locale: groupRunDeclarations.locale,
      typedName: groupRunDeclarations.typedName,
      idDocument: groupRunDeclarations.idDocument,
      email: groupRunDeclarations.email,
      acceptedAt: groupRunDeclarations.acceptedAt,
      // What the blanks said at the signing, and whether it covers the series (§523).
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

/**
 * The signer's own link (§523): the hash of the secret their copy carries, set when that copy is sent
 * — a newer copy's replaces it, so the newest email's link is the one that reads.
 */
export async function setGroupRunDeclarationViewToken<T extends Record<string, unknown>>(db: Database<T>, id: string, tokenHash: string): Promise<void> {
  await db.update(groupRunDeclarations).set({ viewTokenHash: tokenHash }).where(eq(groupRunDeclarations.id, id));
}

/**
 * The declaration a link names, if it covers this date (§523): signed on it, or for the series on one
 * of the series' dates — and of the kind of text the date offers. A read, bound to the hash (never the
 * secret, §12.8), that tells the page nothing about anybody else; undefined for any other link.
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

/**
 * The date a signer's link should open (§523): the run's next date still to come, or the date signed
 * on when the run has none — so the email's button leads to a page that still offers the run.
 */
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
 * The outbox rows about an event's declarations (§393), deleted before the event goes: the
 * declarations cascade with it, and a message about one would then be a row that carries the
 * signer's address and can never render. The same match the erase uses —
 * the payload's id compared as text, so a payload of any other shape is simply not matched.
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
 * Before a date of a run is deleted (§NNN): a held declaration still on it — a one-off's, or a
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
