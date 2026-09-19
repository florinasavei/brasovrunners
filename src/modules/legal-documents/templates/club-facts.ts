import type { LegalDocumentBody, LegalDocumentSection } from "../domain/content-hash";
import type { Env } from "@/shared/config/env";

/**
 * The club's own facts, filled into the platform's legal templates before the club reads them
 * (`DECISIONS.md` §132): what the deployment knows is written in; what it does not stays a
 * visible `<PLACEHOLDER>` for the Administrator to replace before approving.
 *
 * The facts come from the environment, never from this file: the repository is public (§98),
 * a registered seat is somebody's address, and the club's domain is kept out of `src/` for
 * the same reason (§8). `CLUB_LEGAL_NAME`, `CLUB_REGISTRATION_NUMBER` and
 * `CLUB_REGISTERED_ADDRESS` are on the Vercel projects; the contact address is
 * `EMAIL_REPLY_TO`, the mailbox every email already says to reply to. The seed's sample texts
 * keep every blank: a sample must not look approved.
 */
export type ClubFacts = {
  legalName?: string | null;
  contactEmail?: string | null;
  registeredAddress?: string | null;
  registrationNumber?: string | null;
};

export function clubFactsFromEnv(
  env: Pick<Env, "CLUB_LEGAL_NAME" | "CLUB_REGISTRATION_NUMBER" | "CLUB_REGISTERED_ADDRESS" | "EMAIL_REPLY_TO">,
): ClubFacts {
  return {
    legalName: env.CLUB_LEGAL_NAME ?? null,
    registrationNumber: env.CLUB_REGISTRATION_NUMBER ?? null,
    registeredAddress: env.CLUB_REGISTERED_ADDRESS ?? null,
    contactEmail: env.EMAIL_REPLY_TO ?? null,
  };
}

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
