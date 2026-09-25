import type { LegalDocumentKey } from "@/db/schema/legal-documents";
import type { Locale } from "@/i18n/routing";
import type { LegalDocumentBody } from "../domain/content-hash";
import { type ClubFacts, fillClubFacts } from "./club-facts";
import { declarationEn, declarationRo } from "./declaration";
import { groupRunAsphaltEn, groupRunAsphaltRo, groupRunTrailEn, groupRunTrailRo } from "./group-run-declaration";
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
  // The group runs' optional self-declarations, one per surface (§393).
  GROUP_RUN_DECLARATION_ASPHALT: {
    ro: { title: "Declarație pe propria răspundere (alergare de grup, asfalt)", body: groupRunAsphaltRo },
    en: { title: "Self-declaration (group run, asphalt)", body: groupRunAsphaltEn },
  },
  GROUP_RUN_DECLARATION_TRAIL: {
    ro: { title: "Declarație pe propria răspundere (alergare de grup, trail)", body: groupRunTrailRo },
    en: { title: "Self-declaration (group run, trail)", body: groupRunTrailEn },
  },
};

export function isLegalDocumentKey(value: string): value is LegalDocumentKey {
  return value in LEGAL_TEMPLATES;
}

/**
 * What "start from the platform's text" puts in the draft (`/admin/legal/new?template=<key>`,
 * §95, §190): the template in both languages, with the club facts the deployment knows written in
 * (§132) and nothing else touched.
 *
 * A function of its own so the one promise it makes can be tested (§357): every `{{field}}` of
 * the template reaches the draft as a field — the merge happens when the declaration is shown,
 * signed or printed, never here — and every club-fact `<PLACEHOLDER>` the environment does not
 * know stays standing for the Administrator to type. A fact the environment does know is its
 * value, which is §132's answer to "have them already filled in", not a value written into the
 * template: it comes from the Vercel project, and it is the club's own.
 */
export function templatePrefill(
  key: LegalDocumentKey,
  facts: ClubFacts,
): Record<Locale, { title: string; body: LegalDocumentBody }> {
  const template = LEGAL_TEMPLATES[key];
  return {
    ro: { title: template.ro.title, body: fillClubFacts(template.ro.body, facts) },
    en: { title: template.en.title, body: fillClubFacts(template.en.body, facts) },
  };
}
