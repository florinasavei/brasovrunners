import { getDb } from "@/db/client";
import type { LegalDocumentKey } from "@/db/schema/legal-documents";
import {
  computeContentHash,
  type LegalDocumentTranslationInput,
} from "@/modules/legal-documents/domain/content-hash";
import { LEGAL_TEMPLATES } from "@/modules/legal-documents/templates/catalogue";
import {
  findLatestVersion,
  insertLegalDocumentVersion,
  nextVersionNumber,
} from "@/modules/legal-documents/repository";

/**
 * Sample privacy notice, terms and event declaration — complete in structure, blank in
 * substance (`DECISIONS.md` §29, superseding §27).
 *
 * §27 seeded a two-sentence PLACEHOLDER in local and test only, and refused every other
 * environment outright. That was the right rule for the machinery; it is the wrong rule for a
 * QA system nobody can register on, because registration correctly refuses when no approved
 * privacy notice exists (BR-REQ-053-01) and so the whole participant journey was unreachable
 * anywhere a colleague could look at it. **Production stays refused, hard**, and
 * `tests/integration/legal/versions.test.ts` is the test of that refusal.
 *
 * Three rules govern the text below, and they are the reason this file is long:
 *
 *   1. **Every document opens with a banner in its own rendered body, in both languages**,
 *      saying that this is sample text, not approved by the club, not legal advice, and that it
 *      must be replaced before a real participant registers. In the body, not a code comment and
 *      not a column nobody renders: the public page is where somebody has to be able to see it.
 *   2. **Complete in structure, blank in substance.** Every section such a document normally
 *      carries is here; every club-specific fact is an obvious `<ANGLE BRACKET>` placeholder
 *      rather than a plausible invention. AGENTS.md §1.2 forbids inventing legal wording, and a
 *      well-formed invention is far more dangerous than a visible gap — a lawyer edits a
 *      concrete draft in an afternoon and never notices a fabricated retention period.
 *   3. **The privacy notice describes what this application actually does**, read from the
 *      schema rather than guessed: `participants` holds a delivery email, a normalized and a
 *      canonical form of it and a name; `registrations` holds the lifecycle and its timestamps,
 *      the acknowledged privacy-notice version and the results-name consent;
 *      `declaration_acceptances` holds a typed name, a version and a hash; `email_outbox` holds
 *      the queued messages. Nothing else about a person exists, and §12.13 keeps it that way.
 *
 * Each language is written as its own complete text rather than translated sentence by sentence,
 * and both are marked as drafts awaiting one named reviewer.
 */

const SAMPLE_BANNER_RO = [
  "TEXT DE EXEMPLU. Acest document NU a fost aprobat încă de club, nu este consultanță juridică și nu produce efecte juridice.",
  "Există pentru ca fluxul de înscriere să poată fi încercat pe un sistem de test. Textul este complet și descrie exact ce face platforma; datele clubului (denumirea juridică, sediul, numărul de înregistrare, adresa de contact) sunt lăsate între paranteze unghiulare — <AȘA> — și se completează de club la aprobare.",
  "În producție, clubul îl aprobă în /admin/legal (Documente legale, Versiune nouă, „pornește de la textul platformei”) după ce l-a citit și a completat cele patru date.",
];

const SAMPLE_BANNER_EN = [
  "SAMPLE TEXT. This document has NOT been approved yet by the club, is not legal advice, and has no legal effect.",
  "It exists so the registration flow can be tried on a test system. The text is complete and describes exactly what the platform does; the club's own facts (legal name, registered address, registration number, contact address) are left in angle brackets — <LIKE THIS> — and are filled in by the club when it approves.",
  "In production the club approves it in /admin/legal (Legal documents, New version, “start from the platform's text”) after reading it and filling in the four facts.",
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
 * The platform's text, wrapped: the banner first, the review note last (both tests).
 *
 * The template's sections go in **as they are** — never through `fillClubFacts`, never through
 * a merge. The owner, 2026-09-24: "when I seed a document I must have the placeholders as well!"
 * So every `{{field}}` the template carries is still a field in the seeded version (filled only
 * when the declaration is shown, signed or printed for one person at one event), and every club
 * fact is still its `<PLACEHOLDER>` (a sample must not look approved, §132).
 * `tests/integration/legal/sample-seed.test.ts` fails if either is ever lost (§NNN).
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
}> = (["PRIVACY_NOTICE", "TERMS", "EVENT_DECLARATION"] as const).map((key) => ({
  key,
  translations: [sample(key, "ro"), sample(key, "en")],
}));

/**
 * Seed one approved version of each key, unless the same text is already the latest one.
 *
 * Never a delete-and-reinsert, unlike the event seed: a version an acceptance references is
 * immutable (AGENTS.md §12.5), and by the time QA has a registration on it there is acceptance
 * evidence pointing at these rows. Re-running with unchanged text does nothing; re-running after
 * the text here changes inserts the next version, which is exactly what a correction is.
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

    // Through `nextVersionNumber`, not `latest.version + 1`: since §151 a number whose row was
    // deleted stays retired, and the seed must step over it like every other writer. `latest` is
    // still what answers "is this text already the newest one", which is a different question.
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
 * Production is refused, and it is refused in kind rather than in degree.
 *
 * Everywhere else, sample text is a draft somebody is reviewing on a system no participant has
 * ever entered a race on. In production it would be the wording a real person is told they have
 * agreed to — text that says of itself that it has no legal effect, presented as the notice
 * under which their data is processed. There is no configuration that makes that acceptable, so
 * this throws rather than skipping quietly: a seed that silently did nothing would be indistinguishable
 * from one that worked, and the difference matters on exactly one deployment.
 */
export function assertSampleLegalDocumentsAllowed(): void {
  const appEnv = process.env.APP_ENV ?? "local";
  if (appEnv === "production") {
    throw new Error(
      "Refusing to seed sample legal documents into APP_ENV=production. DECISIONS.md §29: the club's approved wording arrives through a migration, per docs/RUNBOOKS.md § Legal document version.",
    );
  }
}
