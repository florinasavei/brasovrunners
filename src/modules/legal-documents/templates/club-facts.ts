import type { LegalDocumentBody, LegalDocumentSection } from "../domain/content-hash";

/**
 * The club's own facts, filled into the platform's legal templates before the club reads them
 * (`DECISIONS.md` §119): what is known is written in; what is not stays a visible
 * `<PLACEHOLDER>` for the Administrator to replace before approving.
 *
 * The legal name is the one on the club's own paper declaration ("Prin Organizator se
 * înțelege …"). The contact address is the deployment's `EMAIL_REPLY_TO`, the mailbox every
 * email already says to reply to — one fact, one place. The registered address and the
 * registration number are not in this repository (a public one, §98) and not in any document
 * the club handed over, so they stay blanks; the seed's sample texts keep every blank.
 */
export const CLUB_LEGAL_NAME = "Asociația Sportivă Alergători cu Jumătate de Normă";

export type ClubFacts = {
  legalName?: string | null;
  contactEmail?: string | null;
  registeredAddress?: string | null;
  registrationNumber?: string | null;
};

/** Every placeholder the templates use, in both languages, and the fact it stands for. */
const PLACEHOLDERS: ReadonlyArray<[keyof ClubFacts, readonly string[]]> = [
  ["legalName", ["<DENUMIREA JURIDICĂ COMPLETĂ A CLUBULUI>", "<THE CLUB'S FULL LEGAL NAME>"]],
  ["contactEmail", ["<EMAIL DE CONTACT>", "<CONTACT EMAIL>"]],
  ["registeredAddress", ["<ADRESA SEDIULUI>", "<REGISTERED ADDRESS>"]],
  ["registrationNumber", ["<NUMĂR DE ÎNREGISTRARE / CUI>", "<REGISTRATION NUMBER>"]],
];

function fillText(text: string, facts: ClubFacts): string {
  let out = text;
  for (const [fact, tokens] of PLACEHOLDERS) {
    const value = facts[fact];
    if (!value) continue;
    for (const token of tokens) out = out.split(token).join(value);
  }
  return out;
}

/** The same body with the known facts written in; unknown ones untouched. */
export function fillClubFacts(body: LegalDocumentBody, facts: ClubFacts): LegalDocumentBody {
  const sections: LegalDocumentSection[] = body.sections.map((section) => ({
    ...section,
    ...(section.heading !== undefined ? { heading: fillText(section.heading, facts) } : {}),
    paragraphs: section.paragraphs.map((paragraph) => fillText(paragraph, facts)),
  }));
  return { sections };
}

/** The placeholders still standing in a body — what the Administrator has left to type. */
export function remainingPlaceholders(body: LegalDocumentBody): string[] {
  const found = new Set<string>();
  for (const section of body.sections) {
    for (const text of [section.heading ?? "", ...section.paragraphs]) {
      for (const match of text.matchAll(/<[A-ZĂÂÎȘȚ'’][^<>]{3,}>/g)) found.add(match[0]);
    }
  }
  return [...found];
}
