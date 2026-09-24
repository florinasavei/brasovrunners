/**
 * The declaration's merge fields, in one list (`DECISIONS.md` §190).
 *
 * They are **not** blanks somebody fills in while writing: each is replaced at the moment a
 * participant signs, with that person's own answer and that event's own facts, which is the
 * whole reason the declaration is one text and not one text per race. The club facts —
 * `<DENUMIREA JURIDICĂ…>` and the rest — are the opposite kind of gap and are written in from
 * the environment before the club ever reads the draft (`club-facts.ts`, §132).
 *
 * The owner asked to "select all those {{}} bindings and have them already filled in", which is
 * two wishes with one answer each: the ones that *can* be filled already are, and the ones that
 * cannot are listed on the page that writes them, with what each becomes — so a token in the
 * text reads as deliberate rather than as something the editor forgot.
 *
 * The list is here rather than in the message catalogue because it is a fact about the
 * substitution in `signed-declaration.ts`, not a translation: a token added there and not here
 * would be a token nobody is told about. `example` is what one signature actually produced.
 */
export type DeclarationToken = {
  /** The token as it is typed into the text, braces and all. */
  token: string;
  /** The message key under `Admin.legal.tokens` that says what it becomes. */
  messageKey: string;
  /** A real-looking value, so a reader sees the shape rather than a description of it. */
  example: string;
};

export const DECLARATION_TOKENS: readonly DeclarationToken[] = [
  { token: "{{participant}}", messageKey: "participant", example: "Ana Popescu" },
  { token: "{{declarant}}", messageKey: "declarant", example: "Mihai Popescu (părinte)" },
  { token: "{{guardian}}", messageKey: "guardian", example: "Mihai Popescu" },
  { token: "{{idDocument}}", messageKey: "idDocument", example: "CI XB 123456" },
  // Each signer's own document (§330): a minor's declaration is signed by the minor and the parent.
  { token: "{{participantIdDocument}}", messageKey: "participantIdDocument", example: "CI XB 654321" },
  { token: "{{guardianIdDocument}}", messageKey: "guardianIdDocument", example: "CI XB 123456" },
  { token: "{{event}}", messageKey: "event", example: "Crosul aniversar Brașov Runners" },
  { token: "{{eventDate}}", messageKey: "eventDate", example: "21 noiembrie 2026" },
  { token: "{{eventLocation}}", messageKey: "eventLocation", example: "Parcul Nicolae Titulescu" },
  { token: "{{signedAt}}", messageKey: "signedAt", example: "20 septembrie 2026, 19:42" },
];

/** Which tokens a body already uses — what the legend marks as "in this text". */
export function tokensUsedIn(text: string): Set<string> {
  return new Set(DECLARATION_TOKENS.filter((entry) => text.includes(entry.token)).map((entry) => entry.token));
}
