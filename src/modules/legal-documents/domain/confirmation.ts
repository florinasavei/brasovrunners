import type { LegalDocumentKey } from "@/db/schema/legal-documents";

/**
 * The phrase typed to delete one legal version (§151): a code and the version number, e.g.
 * `GDPR 2`. Not the title — every version of a document shares it — and the same in both
 * languages, typeable without diacritics.
 */
export const DOCUMENT_CODES: Record<LegalDocumentKey, string> = {
  PRIVACY_NOTICE: "GDPR",
  TERMS: "TERMS",
  EVENT_DECLARATION: "DECLARATION",
  // §515.
  EVENT_DECLARATION_ROAD: "ROAD",
  // §393.
  GROUP_RUN_DECLARATION_ASPHALT: "ASPHALT",
  GROUP_RUN_DECLARATION_TRAIL: "TRAIL",
};

/** What the screen shows and the server expects, e.g. `GDPR 2`. */
export function confirmationPhrase(key: LegalDocumentKey, version: number): string {
  return `${DOCUMENT_CODES[key]} ${version}`;
}

/**
 * The phrase for deleting several approved versions at once (§532), e.g. `DELETE 3`. The count of
 * approved versions makes a selection that changed before the press fail to match; drafts need no
 * phrase (§53) and are not counted.
 */
export function batchConfirmationPhrase(approvedCount: number): string {
  return `DELETE ${approvedCount}`;
}

/** Case and space forgiven, as in `matchesConfirmation`. */
export function matchesBatchConfirmation(typed: string, approvedCount: number): boolean {
  return normalize(typed) === batchConfirmationPhrase(approvedCount).toUpperCase();
}

function normalize(typed: string): string {
  return typed.trim().replace(/\s+/g, " ").toUpperCase();
}

/** Case and surrounding space are forgiven; nothing else is — folding case cannot match another version. */
export function matchesConfirmation(
  typed: string,
  key: LegalDocumentKey,
  version: number,
): boolean {
  return normalize(typed) === confirmationPhrase(key, version).toUpperCase();
}
