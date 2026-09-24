import type { Deadlines } from "@/modules/deadlines/domain/deadlines";
import { hoursPhrase, leadPhrase, minutesPhrase } from "@/modules/deadlines/domain/duration-words";
import { isLegalDocumentBody, type LegalDocumentBody } from "./content-hash";

/**
 * The club's deadlines as merge fields (§NNN), for any of the three texts — unlike the fields
 * below, which only a declaration signed by one person for one event can fill. The platform's
 * templates of the terms and the privacy notice state the email link, the hold, the offer and the
 * reminder through these, so the words follow "Termene" instead of freezing today's numbers into
 * an approved text. They merge when the text is shown (`deadlineMergeValues`); the approved
 * template and its hash are untouched, as for every field (§12.5).
 *
 * **The reminder is a clause, not a number** (`reminderClause`): the club may send none by default
 * (zero), and "un memento cu 0 ore înainte" would promise a message that never goes. So the field
 * carries the whole clause with its leading comma — ", un memento cu 2 zile înainte (sau cât alege
 * evenimentul)", hedged because an event may choose its own — and, when
 * the default is none, a clause with no number that still covers an event sending its own
 * (`reminderClause` below): "confirmări, legături, lista de așteptare{{reminderClause}} și cel
 * mult o mulțumire…". A field given "" is still left out cleanly (`OMITTABLE_MERGE_FIELDS`).
 */
export const DEADLINE_MERGE_FIELDS = ["confirmationHours", "holdMinutes", "offerHours", "reminderClause"] as const;

/**
 * The fields whose empty value is an answer rather than a gap: given as "", they leave nothing
 * in the text — no dotted blank, no emphasis. Given no value at all they still show the blank,
 * like every other field, so a text previewed without the setting reads as unfilled.
 */
export const OMITTABLE_MERGE_FIELDS: ReadonlySet<string> = new Set(["reminderClause"]);

/**
 * The reminder as the clause the legal texts take, in one language. Each event may pick its own
 * reminder — 24, 48 or 72 hours, or none — so the club's default is never stated as a promise a
 * single event can break: an approved notice serves every event.
 *
 * - A default above zero names the lead and hedges it for the event's own choice: ", un memento cu
 *   2 zile înainte (sau cât alege evenimentul)" / ", a reminder 2 days before (or as the event
 *   chooses)".
 * - A default of none (zero) does **not** drop the clause — a notice listing no reminder among the
 *   messages "we send only" would be a claim one event breaks — and says, with no number,
 *   ", un memento înainte de start, dacă evenimentul trimite unul" / ", a reminder before the start
 *   where the event sends one" — never "0 ore", never a dotted blank.
 */
export function reminderClause(locale: string, reminderHours: number): string {
  if (reminderHours <= 0) {
    return locale === "en" ? ", a reminder before the start where the event sends one" : ", un memento înainte de start, dacă evenimentul trimite unul";
  }
  const lead = leadPhrase(locale, reminderHours);
  return locale === "en" ? `, a reminder ${lead} before (or as the event chooses)` : `, un memento cu ${lead} înainte (sau cât alege evenimentul)`;
}

/**
 * The four deadline fields' values in one language: the same words the emails and the pages use
 * (`duration-words.ts`) — "48 de ore", "30 de minute", "24 de ore", ", un memento cu 2 zile
 * înainte (sau cât alege evenimentul)".
 */
export function deadlineMergeValues(
  locale: string,
  deadlines: Pick<Deadlines, "confirmationHours" | "holdMinutes" | "offerHours" | "reminderHours">,
): Record<(typeof DEADLINE_MERGE_FIELDS)[number], string> {
  return {
    confirmationHours: hoursPhrase(locale, deadlines.confirmationHours),
    holdMinutes: minutesPhrase(locale, deadlines.holdMinutes),
    offerHours: hoursPhrase(locale, deadlines.offerHours),
    reminderClause: reminderClause(locale, deadlines.reminderHours),
  };
}

/**
 * The blanks in a declaration (`DECISIONS.md` §95).
 *
 * The club's own paper declaration reads "Subsemnatul/a …………, posesor al CI seria …… nr.
 * ……, declar că particip pe proprie răspundere la concursul …………, care va avea loc în data de
 * …………, în locația …………". A version approved in `/admin/legal` is one fixed text — its hash is
 * what a signature binds to — so the blanks are named fields inside that text, filled in when
 * the declaration is shown to one person for one event and again when it is printed: the
 * template is signed, the fill-ins are recorded beside it, and neither can drift from the other.
 *
 * A short, closed list. Anything else the club wants in the text — the organiser's legal name,
 * the rules — is the text's own words. A field with no value renders as the dotted blank the
 * paper form has, which is what a blank declaration printed for the desk should show.
 *
 * The identity documents, since a minor's declaration is signed by the minor and the parent
 * together (§330), are three fields that pair with the three names:
 * - `idDocument` — the **declarant's** (`{{declarant}}`): the adult's own, the parent's for a
 *   minor. Unchanged, so every text the club already approved reads as it did.
 * - `participantIdDocument` — the participant's own (`{{participant}}`): the adult's, which is
 *   the same document as `idDocument`, or the minor's.
 * - `guardianIdDocument` — the parent's or guardian's (`{{guardian}}`), and like `{{guardian}}`
 *   an em dash for an adult.
 */
export const MERGE_FIELDS = [
  "participant",
  "declarant",
  "guardian",
  "idDocument",
  "participantIdDocument",
  "guardianIdDocument",
  "event",
  "eventDate",
  "eventLocation",
  "signedAt",
  ...DEADLINE_MERGE_FIELDS,
] as const;

/**
 * The fields that name an identity document. A text naming any of them asks for the documents at
 * signing — one for an adult; for a minor the parent's, and the minor's as well when the text asks
 * the minor to sign (`asksForMinorSignature`, §95, §330); a text naming none asks for none.
 */
export const ID_DOCUMENT_FIELDS = ["idDocument", "participantIdDocument", "guardianIdDocument"] as const;

export type MergeField = (typeof MERGE_FIELDS)[number];

export type MergeValues = Partial<Record<MergeField, string | null | undefined>>;

/** The dotted blank of a paper form, for a field with no value yet. */
export const BLANK = "…………………";

const FIELD_PATTERN = /\{\{\s*([a-zA-Z]+)\s*\}\}/g;

/** Substitute every `{{field}}` in one string; an unknown name is left as written. */
export function mergeText(text: string, values: MergeValues): string {
  return mergeTextSegments(text, values)
    .map((segment) => segment.text)
    .join("");
}

/**
 * One piece of merged text, and whether it came out of a `{{field}}` (`DECISIONS.md` §225).
 *
 * The owner: "în declarație trebuie să fac bold la datele care sunt din binding (datele
 * participantului, datele concursului)". He is right, and the reason is not decoration. A
 * declaration is one fixed approved text with a handful of blanks filled in for one person and
 * one race; what the signer has to check before signing is exactly the filled-in part — their
 * own name, their identity document, the race and its date. Everything around it is the same
 * for everybody and was approved once. Setting the fill-ins apart is the difference between
 * reading a contract and checking a form.
 *
 * `mergeText` above is this function joined back together, so the two cannot disagree about
 * what a merge produces.
 *
 * **The dotted blank counts as filled**, because it occupies a `{{field}}` too: on the blank
 * paper form the desk prints, the places somebody must write by hand are then the emphasised
 * ones, which is what a paper form does with a rule under a gap.
 *
 * None of this touches `content_sha256`. The hash is computed over the **unmerged** template
 * (§12.5, §46), which is what a signature binds to; this is a rendering of that template and
 * changes nothing that was approved or signed.
 */
export type MergedSegment = { text: string; filled: boolean };

export function mergeTextSegments(text: string, values: MergeValues): MergedSegment[] {
  const segments: MergedSegment[] = [];
  let index = 0;

  for (const match of text.matchAll(FIELD_PATTERN)) {
    const name = match[1];
    const at = match.index ?? 0;
    // An unknown name is left as written, and left plain: it is not a blank anybody filled.
    if (!isMergeField(name)) continue;
    if (at > index) segments.push({ text: text.slice(index, at), filled: false });
    const value = values[name];
    index = at + match[0].length;
    // An omittable field answered with nothing leaves nothing (`OMITTABLE_MERGE_FIELDS`).
    if (value === "" && OMITTABLE_MERGE_FIELDS.has(name)) continue;
    segments.push({ text: value && value.trim() ? value.trim() : BLANK, filled: true });
  }

  if (index < text.length) segments.push({ text: text.slice(index), filled: false });
  return segments;
}

/** Takes the stored `body_json` as is — an unreadable body merges to no sections, as the renderer shows none. */
export function mergeLegalBody(body: unknown, values: MergeValues): LegalDocumentBody {
  const sections = isLegalDocumentBody(body) ? body.sections : [];
  return {
    sections: sections.map((section) => ({
      ...(section.heading !== undefined ? { heading: mergeText(section.heading, values) } : {}),
      paragraphs: section.paragraphs.map((paragraph) => mergeText(paragraph, values)),
    })),
  };
}

/** Which fields a body asks for — the form asks for an identity document only when the text does. */
export function mergeFieldsIn(body: unknown): Set<MergeField> {
  const found = new Set<MergeField>();
  for (const section of isLegalDocumentBody(body) ? body.sections : []) {
    for (const text of [section.heading ?? "", ...section.paragraphs]) {
      for (const match of text.matchAll(FIELD_PATTERN)) {
        if (isMergeField(match[1])) found.add(match[1]);
      }
    }
  }
  return found;
}

/** Whether a body asks for an identity document at all (`ID_DOCUMENT_FIELDS`). */
export function asksForIdDocument(body: unknown): boolean {
  const fields = mergeFieldsIn(body);
  return ID_DOCUMENT_FIELDS.some((field) => fields.has(field));
}

/**
 * Whether a body asks a minor to sign beside the parent or guardian, with the minor's own
 * identity document (§330): it does when it names `{{participantIdDocument}}`, the minor's own
 * document on a minor's declaration.
 *
 * The production gate for the two-signer declaration. A text the club approved before it — the
 * parent declares, with the parent's document (`{{declarant}}`, `{{idDocument}}`, §108) — does
 * not name the field, and neither does the privacy notice approved beside it describe a minor's
 * own identity number; collecting one under that notice would be data nobody was told about
 * (GDPR art. 13). So the minor is asked only once the club approves a declaration that names the
 * field — the platform's template does, and so does the notice written beside it — and a minor's
 * declaration under an older text is signed exactly as it was: once, by the parent, with one
 * document.
 *
 * `{{guardianIdDocument}}` alone does not switch it on: it is the parent's document, which the
 * parent types as the declarant anyway. Pure, like everything in this file: the page asks it of
 * the text it shows, and the service of the text it binds the signature to.
 */
export function asksForMinorSignature(body: unknown): boolean {
  return mergeFieldsIn(body).has("participantIdDocument");
}

export function isMergeField(name: string): name is MergeField {
  return (MERGE_FIELDS as readonly string[]).includes(name);
}
