import { getDb } from "@/db/client";
import { legalDocumentTranslations, legalDocuments } from "@/db/schema/legal-documents";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";

/**
 * Seed one PLACEHOLDER, approved version of each legal document key (DECISIONS.md §27).
 *
 * Guarded twice, the same shape as the development staff switcher: refused here at the
 * function itself, and never called at all outside local/test by `pilot.ts`. Registration
 * refuses when no approved version exists (BR-REQ-053-01), so an environment with none simply
 * cannot accept a registration — a property of the data, not a flag someone has to remember to
 * flip before a deploy.
 *
 * The text below is invented, says so in both languages, and must never reach a real
 * participant — inventing legal wording that could is forbidden outright (AGENTS.md §1.2).
 */
export async function seedPlaceholderLegalDocuments(now: Date = new Date()): Promise<void> {
  const appEnv = process.env.APP_ENV ?? "local";
  if (appEnv !== "local" && appEnv !== "test") {
    throw new Error(
      `Refusing to seed placeholder legal documents into APP_ENV=${appEnv}. DECISIONS.md §27: no invented legal text may reach qa or production.`,
    );
  }

  const db = getDb();

  // Safe to re-run, the same as `pilot.ts`'s event seed: clear first. Only ever reaches here
  // in local/test, so there is no acceptance evidence (`declaration_acceptances`) anywhere
  // that could reference a version this is about to remove.
  await db.delete(legalDocumentTranslations);
  await db.delete(legalDocuments);

  const placeholder = (titleRo: string, titleEn: string): LegalDocumentTranslationInput[] => [
    {
      locale: "ro",
      title: titleRo,
      body: {
        sections: [
          {
            paragraphs: [
              "TEXT PROVIZORIU — nu a fost aprobat de club și nu trebuie folosit cu participanți reali.",
              "Acest text există doar pentru ca fluxul de înregistrare să poată fi construit și testat local.",
            ],
          },
        ],
      },
    },
    {
      locale: "en",
      title: titleEn,
      body: {
        sections: [
          {
            paragraphs: [
              "PLACEHOLDER TEXT — not approved by the club and must never be used with real participants.",
              "This text exists only so the registration flow can be built and tested locally.",
            ],
          },
        ],
      },
    },
  ];

  const documents: Array<{
    key: "PRIVACY_NOTICE" | "TERMS" | "EVENT_DECLARATION";
    translations: LegalDocumentTranslationInput[];
  }> = [
    { key: "PRIVACY_NOTICE", translations: placeholder("Notă de confidențialitate (PROVIZORIU)", "Privacy notice (PLACEHOLDER)") },
    { key: "TERMS", translations: placeholder("Termeni și condiții (PROVIZORIU)", "Terms and conditions (PLACEHOLDER)") },
    { key: "EVENT_DECLARATION", translations: placeholder("Declarație pe proprie răspundere (PROVIZORIE)", "Event declaration (PLACEHOLDER)") },
  ];

  for (const document of documents) {
    await insertLegalDocumentVersion(db, {
      key: document.key,
      version: 1,
      effectiveAt: now,
      isApproved: true,
      contentSha256: computeContentHash(document.translations),
      translations: document.translations,
      now,
    });
  }

  console.log(`seeded ${documents.length} PLACEHOLDER legal document versions into APP_ENV=${appEnv}`);
}
