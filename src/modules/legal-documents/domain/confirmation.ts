import type { LegalDocumentKey } from "@/db/schema/legal-documents";

/**
 * The phrase somebody types to destroy one version of the club's legal text
 * (`DECISIONS.md` §151).
 *
 * ## Why not the title, which is what erasing an event asks for
 *
 * `hardDeleteEvent` asks for the event's title, and that works because an event's title is
 * unique enough to be a name. A legal document's title is not: the five approved versions the
 * owner made while testing are all called "Notă de informare privind protecția datelor", every
 * one of them. A typed title would match all five, so the one field whose entire purpose is to
 * make the wrong row impossible to hit would in fact identify no row at all.
 *
 * The number is the only thing that tells them apart, so the number is what gets typed — and
 * the key with it, because version 2 exists three times over, once per document.
 *
 * ## Why a code rather than the translated name
 *
 * The same string in both languages, on purpose. `GDPR 2` reads the same to whoever is holding
 * the screen and to whoever is reading the screenshot of it afterwards; `Termeni de concurs 2`
 * and `Racing TOS 2` are the same row with two different confirmations, which is a trap for a
 * club that switches the backoffice between languages. A short code is also typeable without
 * diacritics on a phone at the desk, which a Romanian title is not.
 *
 * `GDPR` is already the club's own word for the privacy notice — it is what the list calls it
 * in both catalogues — so two of these three names are simply the ones already on the screen.
 */
export const DOCUMENT_CODES: Record<LegalDocumentKey, string> = {
  PRIVACY_NOTICE: "GDPR",
  TERMS: "TERMS",
  EVENT_DECLARATION: "DECLARATION",
  // The group runs' optional declarations (§NNN): the surface in the code, so the two are told apart.
  GROUP_RUN_DECLARATION_ASPHALT: "ASPHALT",
  GROUP_RUN_DECLARATION_TRAIL: "TRAIL",
};

/** What the screen shows and the server expects, e.g. `GDPR 2`. One string per version. */
export function confirmationPhrase(key: LegalDocumentKey, version: number): string {
  return `${DOCUMENT_CODES[key]} ${version}`;
}

/**
 * Case and surrounding space are forgiven; nothing else is.
 *
 * A case-insensitive compare would be wrong for a title somebody half-remembers — that is the
 * argument `hardDeleteEvent` makes, and it stands. It does not apply to a six-character code
 * that is printed on the screen being read: folding case cannot make this phrase match a
 * *different* version, because the number is still in it and the code still is. What it does
 * prevent is the club typing `gdpr 2`, being refused, and concluding the screen is broken.
 */
export function matchesConfirmation(
  typed: string,
  key: LegalDocumentKey,
  version: number,
): boolean {
  const normalized = typed.trim().replace(/\s+/g, " ").toUpperCase();
  return normalized === confirmationPhrase(key, version).toUpperCase();
}
