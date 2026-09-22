import type { LegalDocumentKey } from "@/db/schema/legal-documents";

/**
 * The one obstacle to deleting an approved legal version that is not a count (§203, §290).
 *
 * `assertNothingDependsOn` asks three questions — signed declarations, events pointing at the
 * version, privacy acknowledgements — and for TERMS all three are vacuous. A registration records
 * `privacy_notice_version`, `results_consent_version` and `health_consent_version` and **never a
 * terms version**, so every TERMS row reads as unused, including one a hundred people accepted at
 * registration. Deletion destroys the words and leaves only the audit row's hash, so it is the
 * verb that has to be able to show nobody relied on them — and for this key it cannot.
 *
 * A terms version that was ever in force is therefore refused. One that never took effect —
 * approved ahead of its date and superseded before it arrived — was accepted by nobody and may go.
 *
 * **Pure, and here, because two callers need the same answer (§1.5).** It lived only inside
 * `assertDeletable`, so the delete screen did not know about it: the screen listed a draft, the
 * three counts and "the text in force now", found none of them, and told the reader "Se poate
 * șterge pentru că nimic nu depinde de ea". They typed the phrase and the reason, pressed, and the
 * service refused with `CONFLICT` — which the backoffice renders as "Altcineva a salvat între
 * timp", a sentence about a concurrent save that never happened (the owner: "inca nu pot sterge
 * unele documente"). One rule, one place, both callers.
 *
 * The proper repair remains a `terms_version` on the registration: a migration and a change to
 * what the form records. Until that exists, this refusal is the honest answer.
 */
export function termsHasBeenInForce(
  version: { key: LegalDocumentKey; effectiveAt: Date | null },
  now: Date,
): boolean {
  return (
    version.key === "TERMS" &&
    version.effectiveAt !== null &&
    version.effectiveAt.getTime() <= now.getTime()
  );
}
