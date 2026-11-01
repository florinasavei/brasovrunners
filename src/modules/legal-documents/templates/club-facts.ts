import clubLegal from "@club/legal.json";
import type { LegalDocumentBody, LegalDocumentSection } from "../domain/content-hash";
import { joinContactAddresses } from "@/modules/contact/domain/shown-address";
import type { Env } from "@/shared/config/env";
import { SAFETY_PROGRAMME } from "@/theme/brand";

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
 *
 * Since §442 the contact address is the one the club chose to show on `/admin/emails` («Adresa de
 * contact afișată»): the reply-to mailbox, the club's own sending account, or both — «a sau b» in the Romanian text,
 * "a or b" in the English one. An approved text keeps the address it was approved with; a change
 * of the setting reaches the legal texts through a new version started from the platform's text.
 */
export type ClubFacts = {
  legalName?: string | null;
  /** The contact address(es) as the Romanian text writes them. */
  contactEmail?: string | null;
  /** The same in the English text's words; absent, `contactEmail`. */
  contactEmailEn?: string | null;
  registeredAddress?: string | null;
  registrationNumber?: string | null;
};

export function clubFactsFromEnv(
  env: Pick<Env, "CLUB_LEGAL_NAME" | "CLUB_REGISTRATION_NUMBER" | "CLUB_REGISTERED_ADDRESS" | "EMAIL_REPLY_TO">,
  /** The addresses in force (`shownContactAddresses`); absent, `EMAIL_REPLY_TO` alone. */
  contactAddresses?: readonly string[],
): ClubFacts {
  const addresses = contactAddresses ?? (env.EMAIL_REPLY_TO ? [env.EMAIL_REPLY_TO] : []);
  return {
    legalName: env.CLUB_LEGAL_NAME ?? null,
    registrationNumber: env.CLUB_REGISTRATION_NUMBER ?? null,
    registeredAddress: env.CLUB_REGISTERED_ADDRESS ?? null,
    contactEmail: addresses.length > 0 ? joinContactAddresses(addresses, "ro") : null,
    contactEmailEn: addresses.length > 0 ? joinContactAddresses(addresses, "en") : null,
  };
}

/**
 * The registration number without a label of its own (§565): `CLUB_REGISTRATION_NUMBER` may be
 * written «CIF 12345678» — which is how the legal texts read it, after «sediul în …,» — while the
 * site's identity line and footer block write «CIF» / «C.I.F.» themselves. A leading «CIF», «C.I.F.»,
 * «CUI» or «C.U.I.», with or without a colon, is dropped; «RO…» and the digits stay as they are.
 */
export function bareRegistrationNumber(value: string): string {
  const bare = value.replace(/^\s*(?:C\.?\s?I\.?\s?F|C\.?\s?U\.?\s?I)\.?(?![A-Za-z])\s*:?\s*/i, "").trim();
  return bare || value.trim();
}

/** Every placeholder the templates use, in both languages, and the fact it stands for. */
const PLACEHOLDERS: ReadonlyArray<[keyof ClubFacts, readonly string[]]> = [
  ["legalName", ["<DENUMIREA JURIDICĂ COMPLETĂ A CLUBULUI>", "<THE CLUB'S FULL LEGAL NAME>"]],
  ["contactEmail", ["<EMAIL DE CONTACT>"]],
  ["contactEmailEn", ["<CONTACT EMAIL>"]],
  ["registeredAddress", ["<ADRESA SEDIULUI>", "<REGISTERED ADDRESS>"]],
  ["registrationNumber", ["<NUMĂR DE ÎNREGISTRARE / CUI>", "<REGISTRATION NUMBER>"]],
];

/** Each `<PLACEHOLDER>` replaced by its value, every time it stands; one without a value left standing. */
function fillPlaceholders(text: string, pairs: ReadonlyArray<readonly [string, string | null | undefined]>): string {
  let out = text;
  for (const [token, value] of pairs) {
    if (!value) continue;
    out = out.split(token).join(value);
  }
  return out;
}

function fillText(text: string, facts: ClubFacts): string {
  return fillPlaceholders(
    text,
    PLACEHOLDERS.flatMap(([fact, tokens]) => {
      const value = fact === "contactEmailEn" ? (facts.contactEmailEn ?? facts.contactEmail) : facts[fact];
      return tokens.map((token) => [token, value] as const);
    }),
  );
}

/** The same body with every heading and paragraph passed through `fill`. */
function mapTexts(body: LegalDocumentBody, fill: (text: string) => string): LegalDocumentBody {
  const sections: LegalDocumentSection[] = body.sections.map((section) => ({
    ...section,
    ...(section.heading !== undefined ? { heading: fill(section.heading) } : {}),
    paragraphs: section.paragraphs.map(fill),
  }));
  return { sections };
}

/** The same body with the known facts written in; unknown ones untouched. */
export function fillClubFacts(body: LegalDocumentBody, facts: ClubFacts): LegalDocumentBody {
  return mapTexts(body, (text) => fillText(text, facts));
}

/**
 * The club's own choices in its legal texts (§NNN), beside its four facts: whether it has a data
 * protection officer, what its mailbox is and whose, where it publishes photographs, whether it pays
 * prize money, and its safety form's name. A choice, not a fact of the platform's: another club running
 * it answers each differently, so the platform's templates (`privacy-notice.ts`, `terms.ts`) carry a
 * `<PLACEHOLDER>` where the club's sentence goes, and the club's words are `club/legal.json` — the
 * safety form's name is `club/club.json`'s `safetyProgramme` (`SAFETY_PROGRAMME`), which the contact
 * page already prints.
 *
 * Written in when the template module is read (`withClubClauses`), so everything after it — "start from
 * the platform's text", the one press, «Regenerează», the seed and `filledHash`, by which the
 * maintenance job notices a new template (§639) — reads the club's own sentences exactly as before
 * they moved: `tests/unit/legal-documents/filled-hash-parity.test.ts` holds this club's filled text to
 * the hash recorded before the move, so no «Șablon nou» digest goes out for it. Never through a
 * `{{field}}`: a new field would change every template's hash and send that digest.
 *
 * A choice left out of the file — or written in one language only (both or neither) — stays its
 * visible `<PLACEHOLDER>`, which `remainingPlaceholders` names and `approveVersion` refuses to approve
 * (§NNN): a fork's empty `legal.json` gives drafts with holes, never this club's sentences
 * (`tests/fork/legal.test.ts`).
 */
type ClauseWords = { readonly ro?: string; readonly en?: string };

/** The shape of `club/legal.json`: every entry optional, so a club that has not written one keeps its placeholder. */
export type ClubLegalClauses = {
  readonly dataProtectionOfficer?: ClauseWords;
  readonly mailbox?: {
    /** The sentence that says what account the club's mailbox is, and whose. */
    readonly account?: ClauseWords;
    /** The sentence that says whether the mailbox's provider also processes data under its own terms. */
    readonly providerTerms?: ClauseWords;
    /** The mailbox's bare name, as «prin … sau Mailgun» says it. */
    readonly name?: ClauseWords;
    /** «the club's …», as «prin … sau prin serviciul de e-mail al clubului» says it. */
    readonly theClubs?: ClauseWords;
    /** The club's mailbox with its company in brackets, as the fallback road says it. */
    readonly withCompany?: ClauseWords;
    /** The mailbox's company alone, in the list of companies that may access data from the US. */
    readonly company?: ClauseWords;
  };
  /** Where the club publishes photographs, the platforms named. */
  readonly photoChannels?: ClauseWords;
  /** The terms' sentence on prize money. */
  readonly prizeMoney?: ClauseWords;
};

const CLUB_LEGAL: ClubLegalClauses = clubLegal;

type ClauseLocale = "ro" | "en";

/** Every choice's placeholder in each language, and where its words are. */
export const CLUB_CLAUSES: ReadonlyArray<{
  placeholder: Record<ClauseLocale, string>;
  words: (clauses: ClubLegalClauses, safetyProgramme: ClauseWords) => ClauseWords | undefined;
}> = [
  { placeholder: { ro: "<RESPONSABILUL CU PROTECȚIA DATELOR>", en: "<DATA PROTECTION OFFICER>" }, words: (c) => c.dataProtectionOfficer },
  { placeholder: { ro: "<CĂSUȚA DE E-MAIL A CLUBULUI: CE CONT ESTE>", en: "<THE CLUB'S MAILBOX: WHAT ACCOUNT IT IS>" }, words: (c) => c.mailbox?.account },
  {
    placeholder: { ro: "<CĂSUȚA DE E-MAIL A CLUBULUI: REGULILE FURNIZORULUI>", en: "<THE CLUB'S MAILBOX: ITS PROVIDER'S OWN TERMS>" },
    words: (c) => c.mailbox?.providerTerms,
  },
  { placeholder: { ro: "<NUMELE CĂSUȚEI CLUBULUI>", en: "<THE CLUB'S MAILBOX NAME>" }, words: (c) => c.mailbox?.name },
  { placeholder: { ro: "<CĂSUȚA CLUBULUI>", en: "<THE CLUB'S MAILBOX>" }, words: (c) => c.mailbox?.theClubs },
  { placeholder: { ro: "<CĂSUȚA CLUBULUI ȘI FIRMA EI>", en: "<THE CLUB'S MAILBOX AND ITS COMPANY>" }, words: (c) => c.mailbox?.withCompany },
  { placeholder: { ro: "<FIRMA CĂSUȚEI CLUBULUI>", en: "<THE CLUB'S MAILBOX COMPANY>" }, words: (c) => c.mailbox?.company },
  { placeholder: { ro: "<UNDE PUBLICĂ CLUBUL FOTOGRAFII>", en: "<WHERE THE CLUB PUBLISHES PHOTOGRAPHS>" }, words: (c) => c.photoChannels },
  { placeholder: { ro: "<PREMIILE ÎN BANI>", en: "<PRIZE MONEY>" }, words: (c) => c.prizeMoney },
  { placeholder: { ro: "<NUMELE FORMULARULUI DE SIGURANȚĂ>", en: "<THE SAFETY FORM'S NAME>" }, words: (_, safetyProgramme) => safetyProgramme },
];

/** A choice's words in one language — only when the club wrote it in both (both or neither). */
function clauseValue(words: ClauseWords | undefined, locale: ClauseLocale): string | undefined {
  const ro = words?.ro?.trim();
  const en = words?.en?.trim();
  if (!ro || !en) return undefined;
  return locale === "ro" ? ro : en;
}

/**
 * The platform's template with the club's choices written in (§NNN): what `privacy-notice.ts` and
 * `terms.ts` export. `clauses` and `safetyProgramme` are the club's files; a test passes others.
 */
export function withClubClauses(
  locale: ClauseLocale,
  body: LegalDocumentBody,
  clauses: ClubLegalClauses = CLUB_LEGAL,
  safetyProgramme: ClauseWords = SAFETY_PROGRAMME,
): LegalDocumentBody {
  const pairs = CLUB_CLAUSES.map(({ placeholder, words }) => [placeholder[locale], clauseValue(words(clauses, safetyProgramme), locale)] as const);
  return mapTexts(body, (text) => fillPlaceholders(text, pairs));
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
