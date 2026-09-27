import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events, eventTranslations } from "@/db/schema/events";
import { groupRunDeclarations } from "@/db/schema/group-run-declarations";
import { type LegalDocumentKey, legalDocumentTranslations, legalDocuments } from "@/db/schema/legal-documents";
import type { Database } from "@/db/types";
import { type Locale, routing } from "@/i18n/routing";
import { seriesKey } from "@/modules/events/domain/series";
import type { SeriesSignature } from "./domain";

/**
 * The rows of a group run's optional self-declarations (§393). No update: a signature is what it
 * was when it was made (§57), apart from the identity document the retention sweep clears at seven
 * days, and the date it hangs on when that date is deleted (`rehomeGroupRunDeclarationsOfEvent`).
 * Rows are kept until the signer asks for their deletion (§503): they leave by the Administrator's
 * erase, when the same person signs a newer version for the same run (§NNN), or with the run's last
 * date.
 *
 * **A declaration belongs to the run, not to one date (§NNN).** A weekly run is many rows of
 * `events` (§113), and a returning runner signs once. The row still points at the date it was signed
 * on — `{{eventDate}}` in its text is "from the run on …", and the seven-day identity-document sweep
 * counts from it — but everything that reads the declarations reads the whole series: the dates
 * §113 groups, the same type and the same title (trimmed, case-folded), in the default language.
 * Recognised, not recorded, like the listing's one line: no migration, and a date renamed on purpose
 * ("… — ediție de Crăciun") leaves the series and asks its own declaration, as it leaves the line.
 */

export type NewGroupRunDeclaration = typeof groupRunDeclarations.$inferInsert;

export async function insertGroupRunDeclaration<T extends Record<string, unknown>>(
  db: Database<T>,
  values: NewGroupRunDeclaration,
): Promise<typeof groupRunDeclarations.$inferSelect> {
  const [row] = await db.insert(groupRunDeclarations).values(values).returning();
  if (!row) throw new Error("the declaration was not written");
  return row;
}

/**
 * Every date of the run an event belongs to, itself included, soonest first (§NNN): the events of
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
  const [self] = await db
    .select({ type: events.type, title: eventTranslations.title, startsAt: events.startsAt })
    .from(events)
    .leftJoin(eventTranslations, and(eq(eventTranslations.eventId, events.id), eq(eventTranslations.locale, routing.defaultLocale)))
    .where(eq(events.id, eventId))
    .limit(1);
  if (!self) return [];
  if (self.title === null) return [{ id: eventId, startsAt: self.startsAt }];
  const key = seriesKey({ type: self.type, title: self.title });
  const candidates = await db
    .select({ id: events.id, type: events.type, title: eventTranslations.title, startsAt: events.startsAt })
    .from(events)
    .innerJoin(eventTranslations, and(eq(eventTranslations.eventId, events.id), eq(eventTranslations.locale, routing.defaultLocale)))
    .where(eq(events.type, self.type))
    .orderBy(asc(events.startsAt));
  const members = candidates.filter((row) => row.id === eventId || seriesKey(row) === key).map(({ id, startsAt }) => ({ id, startsAt }));
  return members.some((row) => row.id === eventId) ? members : [...members, { id: eventId, startsAt: self.startsAt }];
}

/**
 * What the backoffice lists (§393): who, when, and against which version of the text (§499) —
 * and, since §NNN, on which date of the run it was signed, for the PDF's address. Never the
 * identity document or the address.
 */
export type GroupRunDeclarationListRow = { id: string; eventId: string; typedName: string; acceptedAt: Date; locale: Locale; version: number };

/**
 * The declarations of the run an event belongs to (§NNN): every date's, since one signature covers
 * them all — the same list on each date's backoffice page, in the order they were signed.
 */
export async function listGroupRunDeclarations<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
): Promise<GroupRunDeclarationListRow[]> {
  const dates = (await listSeriesDatesOf(db, eventId)).map((date) => date.id);
  if (dates.length === 0) return [];
  return db
    .select({
      id: groupRunDeclarations.id,
      eventId: groupRunDeclarations.eventId,
      typedName: groupRunDeclarations.typedName,
      acceptedAt: groupRunDeclarations.acceptedAt,
      locale: groupRunDeclarations.locale,
      version: groupRunDeclarations.declarationVersion,
    })
    .from(groupRunDeclarations)
    .where(inArray(groupRunDeclarations.eventId, dates))
    .orderBy(asc(groupRunDeclarations.acceptedAt));
}

/**
 * The signatures of one kind of text kept for a run's dates (§NNN): what the signing press reads to
 * keep one declaration per person per series (`planSeriesSignature`). The kind is the legal key —
 * asphalt and trail are different declarations — so a run that changed surface asks for the other.
 */
export async function listSeriesSignatures<T extends Record<string, unknown>>(
  db: Database<T>,
  eventIds: readonly string[],
  key: LegalDocumentKey,
): Promise<SeriesSignature[]> {
  if (eventIds.length === 0) return [];
  return db
    .select({
      id: groupRunDeclarations.id,
      legalDocumentId: groupRunDeclarations.legalDocumentId,
      email: groupRunDeclarations.email,
      typedName: groupRunDeclarations.typedName,
      acceptedAt: groupRunDeclarations.acceptedAt,
    })
    .from(groupRunDeclarations)
    .innerJoin(legalDocuments, eq(legalDocuments.id, groupRunDeclarations.legalDocumentId))
    .where(and(inArray(groupRunDeclarations.eventId, [...eventIds]), eq(legalDocuments.key, key)))
    .orderBy(asc(groupRunDeclarations.acceptedAt));
}

/**
 * Deletes declarations by id, and first the outbox rows about them (§393's order: a message about a
 * row that is gone carries the signer's address and can never render). The signing press uses it
 * for the rows a new signature supersedes (§NNN); the erase keeps its own, audited, path.
 */
export async function deleteGroupRunDeclarations<T extends Record<string, unknown>>(db: Database<T>, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.delete(emailOutbox).where(inArray(sql`${emailOutbox.payloadJson}->>'groupRunDeclarationId'`, [...ids]));
  await db.delete(groupRunDeclarations).where(inArray(groupRunDeclarations.id, [...ids]));
}

/**
 * Before a date of a run is deleted (§NNN): its declarations cover the run's other dates too, so
 * they move to the run's earliest remaining date rather than cascading away with this one. Returns
 * how many moved; none when the date was the run's only one — then they go with it, as before
 * (§393), their outbox rows first (`deleteGroupRunDeclarationMessagesOfEvent`).
 */
export async function rehomeGroupRunDeclarationsOfEvent<T extends Record<string, unknown>>(db: Database<T>, eventId: string): Promise<number> {
  const [any] = await db.select({ id: groupRunDeclarations.id }).from(groupRunDeclarations).where(eq(groupRunDeclarations.eventId, eventId)).limit(1);
  if (!any) return 0;
  const [target] = (await listSeriesDatesOf(db, eventId)).filter((date) => date.id !== eventId);
  if (!target) return 0;
  const moved = await db
    .update(groupRunDeclarations)
    .set({ eventId: target.id })
    .where(eq(groupRunDeclarations.eventId, eventId))
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
      // The day the signed version took effect, for the PDF's version line (§499).
      effectiveAt: legalDocuments.effectiveAt,
      locale: groupRunDeclarations.locale,
      typedName: groupRunDeclarations.typedName,
      idDocument: groupRunDeclarations.idDocument,
      email: groupRunDeclarations.email,
      acceptedAt: groupRunDeclarations.acceptedAt,
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

/** An outbox row's declaration id (§393), or null when its payload carries none. */
export function groupRunDeclarationIdOf(payload: unknown): string | null {
  const id = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>).groupRunDeclarationId : undefined;
  return typeof id === "string" ? id : null;
}
