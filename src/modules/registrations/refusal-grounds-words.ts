/**
 * The terms' grounds for the club refusing or cancelling a registration (§618), as the merge field
 * `{{refusalGrounds}}` renders them (§NNN) — the five objective grounds of §3's last paragraph, in
 * each language, exactly as the template spelled them before the field existed, so the rendered
 * paragraph is byte-identical to the one §618 wrote.
 *
 * One module for the template, the legal pages that fill the field and the detector that asks
 * whether the terms in force carry the clause (`describesRefusal`): the words the club approves and
 * the words the switch looks for cannot drift apart, as `list-state-words.ts` keeps the notice and
 * the list on the same three words. Outside a request, for the legal pages, the declaration page,
 * the signed PDF and the legal editor's token legend.
 */
type GroundLocale = "ro" | "en";

const GROUNDS: Record<GroundLocale, readonly string[]> = {
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
 * What `{{refusalGrounds}}` becomes: the five grounds joined by semicolons, from «nu sunt
 * îndeplinite condițiile de participare…» to «…înscrierea a fost făcută cu încălcarea acestor
 * termeni» — no full stop, which the template's own sentence carries after the field.
 */
export function refusalGroundsClause(locale: string): string {
  return refusalGrounds(locale).join("; ");
}

/** The field's merge value, beside the deadlines' and the list's on the legal pages. */
export function refusalMergeValues(locale: string): { refusalGrounds: string } {
  return { refusalGrounds: refusalGroundsClause(locale) };
}

/** The clause in every language — what `describesRefusal` finds in a text the club approved word for word. */
export const REFUSAL_GROUNDS_CLAUSES: readonly string[] = [refusalGroundsClause("ro"), refusalGroundsClause("en")];
