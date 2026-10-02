import { isLegalDocumentBody } from "./content-hash";

/**
 * Whether the terms carry the club's right to refuse or cancel a registration on objective grounds
 * (§NNN, on §618's paragraph; the owner, 2026-10-02: «La edițiile următoare trebuie sa aducă
 * [= să apară] că organizatorul își rezervă dreptul de a refuza înscrieri»).
 *
 * The five grounds of the terms' §3, last paragraph, in each language, exactly as the template
 * (`templates/terms.ts`) spells them — a test holds the two to each other. They stay literal words
 * in the template and in every text the club approves from it, never a merge field, so the draft
 * the club and its lawyer read in `/admin/legal` and its PDF shows the clause in full. What this
 * module adds is only the reading: the gate for the form's second express-box wording
 * (`Registration.terms.acceptWithRefusal`) and the fold's step «Clubul poate refuza o înscriere».
 */
const GROUNDS: Record<"ro" | "en", readonly string[]> = {
  ro: [
    "nu sunt îndeplinite condițiile de participare ale evenimentului (vârsta minimă, declarațiile cerute, declarația că ești apt medical, unde evenimentul o cere)",
    "datele sunt false, incomplete sau ale altei persoane",
    "o impun capacitatea sau siguranța evenimentului (vremea, traseul, numărul de voluntari)",
    "conduita ta contravine regulamentului evenimentului ori îi pune pe alții în pericol",
    "înscrierea a fost făcută cu încălcarea acestor termeni",
  ],
  en: [
    "the event's conditions for taking part are not met (the minimum age, the declarations it asks for, the statement that you are medically fit, where the event asks for it)",
    "the details are false, incomplete or somebody else's",
    "the event's capacity or safety requires it (the weather, the course, the number of volunteers)",
    "your conduct breaches the event's rules or endangers others",
    "the registration was made in breach of these terms",
  ],
};

/** The five grounds in one language, in the terms' order. */
export function refusalGrounds(locale: string): readonly string[] {
  return locale === "en" ? GROUNDS.en : GROUNDS.ro;
}

/**
 * The grounds as the paragraph runs them: joined by semicolons, from «nu sunt îndeplinite condițiile
 * de participare…» to «…înscrierea a fost făcută cu încălcarea acestor termeni», no full stop.
 */
export function refusalGroundsClause(locale: string): string {
  return refusalGrounds(locale).join("; ");
}

const CLAUSES: readonly string[] = [refusalGroundsClause("ro"), refusalGroundsClause("en")];

/**
 * Whether a body spells the grounds word for word, in either language, in one paragraph — the
 * gate for the form's second express-box wording and the fold's step; a text that does not keeps
 * both exactly as they were. Pure; the caller asks it of the terms in force, in every language.
 */
export function describesRefusal(body: unknown): boolean {
  const sections = isLegalDocumentBody(body) ? body.sections : [];
  return sections.some((section) => section.paragraphs.some((paragraph) => CLAUSES.some((clause) => paragraph.includes(clause))));
}
