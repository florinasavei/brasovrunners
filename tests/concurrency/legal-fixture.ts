import { inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { legalDocuments } from "@/db/schema/legal-documents";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion, nextVersionNumber } from "@/modules/legal-documents/repository";

/**
 * §NNN — the approved notices a concurrency suite needs in force, whatever the database holds already.
 *
 * A seeded database (every cloud session's) carries the sample notices at version 1, 2… effective *now*; the suites
 * pin a September clock, at which none of them is in force, and a fixed «version 1, effective 2020» insert collided
 * with the seeded number and was swallowed — then every submission was refused for want of a notice. Each document
 * here takes the next free version number, above whatever exists, effective long before any suite's clock, and is
 * removed again by `removeApprovedNotices` once the suite's own rows (which reference it) are gone.
 */
export async function approveNotices(
  db: NodePgDatabase,
  keys: ReadonlyArray<"PRIVACY_NOTICE" | "TERMS" | "EVENT_DECLARATION">,
  now: Date,
): Promise<string[]> {
  const ids: string[] = [];
  for (const key of keys) {
    const translations: LegalDocumentTranslationInput[] = [
      { locale: "ro", title: key, body: { sections: [{ paragraphs: ["p"] }] } },
      { locale: "en", title: key, body: { sections: [{ paragraphs: ["p"] }] } },
    ];
    ids.push(
      await insertLegalDocumentVersion(db, {
        key,
        version: await nextVersionNumber(db, key),
        effectiveAt: new Date("2020-01-01T00:00:00.000Z"),
        isApproved: true,
        contentSha256: computeContentHash(translations),
        translations,
        now,
      }),
    );
  }
  return ids;
}

/**
 * Remove the documents `approveNotices` inserted (their translations go with them); call after the suite's registrations are deleted.
 * The version numbers are not retired in `legal_document_numbering`, so the next run on the same local database reuses them —
 * which §151 forbids for real documents, and harmless here: the suite's database is a local, throwaway one.
 */
export async function removeApprovedNotices(db: NodePgDatabase, ids: readonly string[]): Promise<void> {
  if (ids.length > 0) await db.delete(legalDocuments).where(inArray(legalDocuments.id, [...ids]));
}
