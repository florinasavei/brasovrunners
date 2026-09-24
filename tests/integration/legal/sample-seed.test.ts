import { asc, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { legalDocuments } from "@/db/schema/legal-documents";
import type { LegalDocumentKey } from "@/db/schema/legal-documents";
import { computeContentHash, type LegalDocumentBody, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { mergeFieldsIn } from "@/modules/legal-documents/domain/merge-fields";
import { findCurrentApprovedDocument, insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { LEGAL_TEMPLATES } from "@/modules/legal-documents/templates/catalogue";
import { remainingPlaceholders } from "@/modules/legal-documents/templates/club-facts";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

let db: TestDatabase;
vi.mock("@/db/client", () => ({ getDb: () => db }));

const { SAMPLE_DOCUMENTS, seedSampleLegalDocuments } = await import("@/db/seeds/sample-legal-documents");

/**
 * `yarn db:seed:legal` against a real PostgreSQL (PGlite), the way QA is seeded (§29, §357).
 *
 * The owner, 2026-09-24: "I need to seed and migrate that declaration of participation …", then
 * "when I seed a document I must have the placeholders as well!". Migrating a legal text here is
 * not a database migration: the template changes, and the seed — which never deletes, because an
 * acceptance may point at any version (AGENTS.md §12.5) — compares the text's content hash with
 * the latest version's and inserts the next version when they differ. Production is refused, and
 * gets the text only when the club approves it in `/admin/legal`.
 */
const NOW = new Date("2026-09-24T12:00:00.000Z");
const KEYS: readonly LegalDocumentKey[] = ["PRIVACY_NOTICE", "TERMS", "EVENT_DECLARATION"];

const texts = (body: LegalDocumentBody) => body.sections.flatMap((section) => [section.heading ?? "", ...section.paragraphs]);
const sampleOf = (key: LegalDocumentKey) => SAMPLE_DOCUMENTS.find((document) => document.key === key)!;

/** The declaration as it stood before the runner took ownership of the risks: the new bullets and sentence gone. */
function declarationBeforeThisChange(): LegalDocumentTranslationInput[] {
  const added = /animalelor sălbatice|wild animals|porțiuni abrupte|steep sections|lanternă frontală|headlamp|vremea se poate schimba|weather can change|în ritmul meu|own pace|ariile naturale protejate|protected natural areas|Obiectele personale|personal belongings|Îmi asum responsabilitatea|I take responsibility for my own safety/;
  return sampleOf("EVENT_DECLARATION").translations.map((translation) => ({
    ...translation,
    body: { sections: translation.body.sections.map((section) => ({ ...section, paragraphs: section.paragraphs.filter((p) => !added.test(p)) })) },
  }));
}

async function versionsOf(key: LegalDocumentKey) {
  return db.select({ version: legalDocuments.version, contentSha256: legalDocuments.contentSha256, isApproved: legalDocuments.isApproved }).from(legalDocuments).where(eq(legalDocuments.key, key)).orderBy(asc(legalDocuments.version));
}

describe("§357 the sample legal documents, seeded and re-seeded", () => {
  const originalAppEnv = process.env.APP_ENV;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetTables(db);
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    process.env.APP_ENV = originalAppEnv;
    vi.restoreAllMocks();
  });

  it("stores every merge field and every club-fact placeholder of each template, in both languages", async () => {
    await seedSampleLegalDocuments(NOW);

    for (const key of KEYS) {
      expect(await versionsOf(key), key).toEqual([{ version: 1, contentSha256: computeContentHash(sampleOf(key).translations), isApproved: true }]);
      for (const locale of ["ro", "en"] as const) {
        const stored = await findCurrentApprovedDocument(db, key, locale, NOW);
        const body = stored!.body as LegalDocumentBody;
        const template = LEGAL_TEMPLATES[key][locale].body;
        // What came back from the database is the template, unfilled, between the banner and the note.
        expect(body.sections.slice(1, -1), `${key} ${locale}`).toEqual(template.sections);
        expect([...mergeFieldsIn(body)].sort()).toEqual([...mergeFieldsIn(template)].sort());
        for (const placeholder of remainingPlaceholders(template)) expect(texts(body).join("\n"), `${key} ${locale} ${placeholder}`).toContain(placeholder);
      }
    }
    // The declaration's own fields, by name, as the page and the PDF will fill them.
    const declaration = (await findCurrentApprovedDocument(db, "EVENT_DECLARATION", "ro", NOW))!.body;
    for (const field of ["participant", "participantIdDocument", "guardian", "guardianIdDocument", "event", "eventDate", "eventLocation"]) {
      expect(mergeFieldsIn(declaration).has(field as never), field).toBe(true);
    }
  });

  it("does nothing when re-run with the same text", async () => {
    await seedSampleLegalDocuments(NOW);
    await seedSampleLegalDocuments(new Date(NOW.getTime() + 60_000));
    for (const key of KEYS) expect((await versionsOf(key)).map((row) => row.version), key).toEqual([1]);
  });

  it("inserts the next version of the declaration when the template has changed, and leaves the other two alone", async () => {
    // QA as it stands before this change: the declaration without the new risks, the other two current.
    const before = declarationBeforeThisChange();
    expect(computeContentHash(before)).not.toBe(computeContentHash(sampleOf("EVENT_DECLARATION").translations));
    const earlier = new Date("2026-09-20T12:00:00.000Z");
    await insertLegalDocumentVersion(db, { key: "EVENT_DECLARATION", version: 1, effectiveAt: earlier, isApproved: true, contentSha256: computeContentHash(before), translations: before, now: earlier });
    for (const key of ["PRIVACY_NOTICE", "TERMS"] as const) {
      const translations = sampleOf(key).translations;
      await insertLegalDocumentVersion(db, { key, version: 1, effectiveAt: earlier, isApproved: true, contentSha256: computeContentHash(translations), translations, now: earlier });
    }

    await seedSampleLegalDocuments(NOW);

    const declarationVersions = await versionsOf("EVENT_DECLARATION");
    expect(declarationVersions.map((row) => row.version)).toEqual([1, 2]);
    expect(declarationVersions[1]).toEqual({ version: 2, contentSha256: computeContentHash(sampleOf("EVENT_DECLARATION").translations), isApproved: true });
    for (const key of ["PRIVACY_NOTICE", "TERMS"] as const) expect((await versionsOf(key)).map((row) => row.version), key).toEqual([1]);

    // The version in force now is the new text, risks and fields and all; version 1 is kept as it was.
    for (const locale of ["ro", "en"] as const) {
      const current = await findCurrentApprovedDocument(db, "EVENT_DECLARATION", locale, NOW);
      expect(current?.version).toBe(2);
      const words = texts(current!.body as LegalDocumentBody).join("\n");
      expect(words).toContain(locale === "ro" ? "lanternă frontală funcțională" : "working headlamp");
      expect(words).toContain("{{participantIdDocument}}");
      expect(words).toContain(locale === "ro" ? "<DENUMIREA JURIDICĂ COMPLETĂ A CLUBULUI>" : "<THE CLUB'S FULL LEGAL NAME>");
    }
    expect((await findCurrentApprovedDocument(db, "EVENT_DECLARATION", "ro", new Date("2026-09-21T00:00:00.000Z")))?.version).toBe(1);

    // And a second run finds the new text already in force.
    await seedSampleLegalDocuments(new Date(NOW.getTime() + 60_000));
    expect((await versionsOf("EVENT_DECLARATION")).map((row) => row.version)).toEqual([1, 2]);
  });

  it("refuses production before it writes anything", async () => {
    process.env.APP_ENV = "production";
    await expect(seedSampleLegalDocuments(NOW)).rejects.toThrow(/Refusing to seed/);
    expect(await db.select().from(legalDocuments)).toEqual([]);
  });
});
