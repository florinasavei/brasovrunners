import { getDb } from "@/db/client";
import type { LegalDocumentKey } from "@/db/schema/legal-documents";
import {
  computeContentHash,
  type LegalDocumentTranslationInput,
} from "@/modules/legal-documents/domain/content-hash";
import { LEGAL_TEMPLATES } from "@/modules/legal-documents/templates/catalogue";
import { LEGAL_DOCUMENT_KEYS } from "@/modules/legal-documents/domain/keys";
import {
  findLatestVersion,
  insertLegalDocumentVersion,
  nextVersionNumber,
} from "@/modules/legal-documents/repository";

/**
 * Sample legal documents for every environment but production (§29, superseding §27), so the
 * participant journey can be walked on QA; registration refuses without an approved privacy
 * notice (BR-REQ-053-01). Production is refused hard (`tests/integration/legal/versions.test.ts`).
 *
 * Each document opens with a not-approved banner in its rendered body, in both languages, and
 * leaves every club fact as a visible `<PLACEHOLDER>` — never a plausible invention (AGENTS.md §1.2).
 */

const SAMPLE_BANNER_RO = [
  "TEXT DE EXEMPLU. Acest document NU a fost aprobat încă de club, nu este consultanță juridică și nu produce efecte juridice.",
  "Există pentru ca fluxul de înscriere să poată fi încercat pe un sistem de test. Textul este complet și descrie exact ce face platforma; datele clubului (denumirea juridică, sediul, numărul de înregistrare, adresa de contact) sunt lăsate între paranteze unghiulare — <AȘA> — și se completează de club la aprobare.",
  "În producție, clubul îl aprobă în /admin/legal (Documente legale, Versiune nouă, „Pornește de la șablon”) după ce l-a citit și a completat cele patru date.",
];

const SAMPLE_BANNER_EN = [
  "SAMPLE TEXT. This document has NOT been approved yet by the club, is not legal advice, and has no legal effect.",
  "It exists so the registration flow can be tried on a test system. The text is complete and describes exactly what the platform does; the club's own facts (legal name, registered address, registration number, contact address) are left in angle brackets — <LIKE THIS> — and are filled in by the club when it approves.",
  "In production the club approves it in /admin/legal (Legal documents, New version, “Start from the template”) after reading it and filling in the four facts.",
];

const REVIEW_NOTE_RO = [
  "Stare: proiect. Un singur recenzent desemnat: <NUME RECENZENT>, <ROL>. Data recenziei: <DATA>.",
  "Versiunea aprobată se scrie și se aprobă în /admin/legal; din acel moment textul este fix, iar o corectură este versiunea următoare.",
];

const REVIEW_NOTE_EN = [
  "Status: draft. One named reviewer: <REVIEWER NAME>, <ROLE>. Review date: <DATE>.",
  "The approved version is written and approved in /admin/legal; from that moment the text is fixed, and a correction is the next version.",
];

/**
 * The platform's template wrapped in the banner and the review note. Sections go in as they are,
 * never through `fillClubFacts`: every `{{field}}` stays a field and every club fact stays its
 * `<PLACEHOLDER>` (§132, §357; `tests/integration/legal/sample-seed.test.ts`).
 */
function sample(key: LegalDocumentKey, locale: "ro" | "en"): LegalDocumentTranslationInput {
  const template = LEGAL_TEMPLATES[key][locale];
  return {
    locale,
    title: `${template.title} (${locale === "ro" ? "EXEMPLU, NEAPROBAT" : "SAMPLE, NOT APPROVED"})`,
    body: {
      sections: [
        { heading: locale === "ro" ? "TEXT DE EXEMPLU — NEAPROBAT" : "SAMPLE TEXT — NOT APPROVED", paragraphs: locale === "ro" ? SAMPLE_BANNER_RO : SAMPLE_BANNER_EN },
        ...template.body.sections,
        { heading: locale === "ro" ? "Stare și recenzie" : "Status and review", paragraphs: locale === "ro" ? REVIEW_NOTE_RO : REVIEW_NOTE_EN },
      ],
    },
  };
}

export const SAMPLE_DOCUMENTS: ReadonlyArray<{
  key: LegalDocumentKey;
  translations: LegalDocumentTranslationInput[];
}> = LEGAL_DOCUMENT_KEYS.map((key) => ({
  key,
  translations: [sample(key, "ro"), sample(key, "en")],
}));

/**
 * Seed one approved version of each key unless the same text is already the latest. Never a
 * delete: a version an acceptance references is immutable (AGENTS.md §12.5), so changed text
 * becomes the next version.
 */
export async function seedSampleLegalDocuments(now: Date = new Date()): Promise<void> {
  assertSampleLegalDocumentsAllowed();

  const db = getDb();

  for (const document of SAMPLE_DOCUMENTS) {
    const contentSha256 = computeContentHash(document.translations);
    const latest = await findLatestVersion(db, document.key);

    if (latest?.contentSha256 === contentSha256) {
      console.log(`${document.key}: version ${latest.version} already carries this text`);
      continue;
    }

    // `nextVersionNumber`, not `latest.version + 1`: a deleted number stays retired (§151).
    const version = await nextVersionNumber(db, document.key);
    await insertLegalDocumentVersion(db, {
      key: document.key,
      version,
      effectiveAt: now,
      isApproved: true,
      contentSha256,
      translations: document.translations,
      now,
    });
    console.log(`${document.key}: inserted sample version ${version}`);
  }
}

/**
 * Throws rather than skipping: in production, sample text would be what a real person is told
 * they agreed to, and a silent no-op would look like success.
 */
export function assertSampleLegalDocumentsAllowed(): void {
  const appEnv = process.env.APP_ENV ?? "local";
  if (appEnv === "production") {
    throw new Error(
      "Refusing to seed sample legal documents into APP_ENV=production. DECISIONS.md §29: the club's approved wording arrives through a migration, per docs/RUNBOOKS.md § Legal document version.",
    );
  }
}
