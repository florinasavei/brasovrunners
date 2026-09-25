import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { emailOutbox } from "@/db/schema/email-outbox";
import { groupRunDeclarations } from "@/db/schema/group-run-declarations";
import { legalDocumentTranslations, legalDocuments } from "@/db/schema/legal-documents";
import type { Database } from "@/db/types";
import type { Locale } from "@/i18n/routing";

/**
 * The rows of a group run's optional self-declarations (§NNN). No update: a signature is what it
 * was when it was made (§57). Rows leave by the retention sweep, the Administrator's erase, or with
 * their event.
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

/** What the backoffice lists (§NNN): who and when. Never the identity document or the address. */
export type GroupRunDeclarationListRow = { id: string; typedName: string; acceptedAt: Date; locale: Locale };

export async function listGroupRunDeclarations<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
): Promise<GroupRunDeclarationListRow[]> {
  return db
    .select({
      id: groupRunDeclarations.id,
      typedName: groupRunDeclarations.typedName,
      acceptedAt: groupRunDeclarations.acceptedAt,
      locale: groupRunDeclarations.locale,
    })
    .from(groupRunDeclarations)
    .where(eq(groupRunDeclarations.eventId, eventId))
    .orderBy(asc(groupRunDeclarations.acceptedAt));
}

export async function countGroupRunDeclarations<T extends Record<string, unknown>>(db: Database<T>, eventId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(groupRunDeclarations)
    .where(eq(groupRunDeclarations.eventId, eventId));
  return row?.count ?? 0;
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
 * The outbox rows about an event's declarations (§NNN), deleted before the event goes: the
 * declarations cascade with it, and a message about one would then be a row that carries the
 * signer's address and can never render. The same match the erase and the retention sweep use —
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

/** An outbox row's declaration id (§NNN), or null when its payload carries none. */
export function groupRunDeclarationIdOf(payload: unknown): string | null {
  const id = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>).groupRunDeclarationId : undefined;
  return typeof id === "string" ? id : null;
}
