import type { LegalDocumentKey } from "@/db/schema/legal-documents";
import type { Locale } from "@/i18n/routing";
import type { LegalDocumentBody } from "../domain/content-hash";
import { type ClubFacts, fillClubFacts } from "./club-facts";
import { declarationRoadEn, declarationRoadRo, declarationTrailEn, declarationTrailRo } from "./declaration";
import { groupRunAsphaltEn, groupRunAsphaltRo, groupRunTrailEn, groupRunTrailRo } from "./group-run-declaration";
import { privacyNoticeEn, privacyNoticeRo } from "./privacy-notice";
import { termsEn, termsRo } from "./terms";

/**
 * The platform's own legal texts (§95), complete but for the club's four facts marked
 * <LIKE THIS>. Read by the seed (with a not-approved banner outside production) and by
 * `/admin/legal/new?template=<key>`; the club still reads and approves (AGENTS.md §11.1).
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
  // One body with a risk section per course (§515); trail keeps the key older signatures carry.
  EVENT_DECLARATION: {
    ro: { title: "Declarație pe propria răspundere — cursă trail", body: declarationTrailRo },
    en: { title: "Self-declaration — trail race", body: declarationTrailEn },
  },
  EVENT_DECLARATION_ROAD: {
    ro: { title: "Declarație pe propria răspundere — cursă pe asfalt / în parc", body: declarationRoadRo },
    en: { title: "Self-declaration — road / park race", body: declarationRoadEn },
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
 * What "start from the platform's text" puts in the draft (§95, §190): the template with the
 * known club facts written in (§132) and nothing else — every `{{field}}` stays a field, merged
 * only when shown, signed or printed (§357).
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
