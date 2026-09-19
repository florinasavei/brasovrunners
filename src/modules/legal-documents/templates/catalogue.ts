import type { LegalDocumentKey } from "@/db/schema/legal-documents";
import type { Locale } from "@/i18n/routing";
import type { LegalDocumentBody } from "../domain/content-hash";
import { declarationEn, declarationRo } from "./declaration";
import { privacyNoticeEn, privacyNoticeRo } from "./privacy-notice";
import { termsEn, termsRo } from "./terms";

/**
 * The platform's own texts for the three documents (`DECISIONS.md` §95): a privacy notice
 * that describes what this application actually does (GDPR art. 13, Legea 190/2018), terms
 * for a free event platform, and the club's declaration with its merge fields. Complete —
 * the only blanks are the club's legal name, address, registration number and contact
 * address, marked <LIKE THIS> — so that approving them in `/admin/legal` is reading, filling
 * four facts and pressing approve, not drafting.
 *
 * Two readers: the seed, which wraps each in a not-approved banner for every environment but
 * production; and `/admin/legal/new?template=<key>`, which prefills a draft with the text as
 * is. Neither is an interface that writes legal text (`AGENTS.md` §11.1): the club still
 * reads, edits and approves, and what it approves is fixed by its hash.
 */
export const LEGAL_TEMPLATES: Record<LegalDocumentKey, Record<Locale, { title: string; body: LegalDocumentBody }>> = {
  PRIVACY_NOTICE: {
    ro: { title: "Notă de confidențialitate", body: privacyNoticeRo },
    en: { title: "Privacy notice", body: privacyNoticeEn },
  },
  TERMS: {
    ro: { title: "Termeni și condiții", body: termsRo },
    en: { title: "Terms and conditions", body: termsEn },
  },
  EVENT_DECLARATION: {
    ro: { title: "Declarație pe proprie răspundere", body: declarationRo },
    en: { title: "Declaration of own responsibility", body: declarationEn },
  },
};

export function isLegalDocumentKey(value: string): value is LegalDocumentKey {
  return value in LEGAL_TEMPLATES;
}
