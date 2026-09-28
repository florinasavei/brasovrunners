import type { Deadlines } from "@/modules/deadlines/domain/deadlines";
import { daysPhrase, hoursPhrase, leadPhrase, minutesPhrase } from "@/modules/deadlines/domain/duration-words";
import { yearsPhrase } from "@/modules/registrations/domain/age";
import { isLegalDocumentBody, type LegalDocumentBody } from "./content-hash";

/**
 * The club's deadlines as merge fields (§377), for any legal text; merged when shown, so the
 * approved template and its hash are untouched (AGENTS.md §12.5). `reminderClause` is a whole
 * clause with its leading comma, so a zero default never promises "0 hours before".
 * `publicListPeriod` is the public list's life after the event (§421), unit included.
 */
export const DEADLINE_MERGE_FIELDS = ["confirmationHours", "holdMinutes", "offerHours", "reminderClause", "publicListPeriod"] as const;

/**
 * Given "", these leave nothing in the text; given no value, they show the blank like any field,
 * so a preview without the setting reads as unfilled.
 */
export const OMITTABLE_MERGE_FIELDS: ReadonlySet<string> = new Set(["reminderClause"]);

/**
 * The reminder clause. Events may choose their own reminder, so the club default is hedged; a zero
 * default still mentions a reminder "where the event sends one", never "0 ore" or a blank.
 */
export function reminderClause(locale: string, reminderHours: number): string {
  if (reminderHours <= 0) {
    return locale === "en" ? ", a reminder before the start where the event sends one" : ", un memento înainte de start, dacă evenimentul trimite unul";
  }
  const lead = leadPhrase(locale, reminderHours);
  return locale === "en" ? `, a reminder ${lead} before (or as the event chooses)` : `, un memento cu ${lead} înainte (sau cât alege evenimentul)`;
}

/** The deadline fields in one language, in the emails' and pages' words (`duration-words.ts`). */
export function deadlineMergeValues(
  locale: string,
  deadlines: Pick<Deadlines, "confirmationHours" | "holdMinutes" | "offerHours" | "reminderHours" | "publicListDays">,
): Record<(typeof DEADLINE_MERGE_FIELDS)[number], string> {
  return {
    confirmationHours: hoursPhrase(locale, deadlines.confirmationHours),
    holdMinutes: minutesPhrase(locale, deadlines.holdMinutes),
    offerHours: hoursPhrase(locale, deadlines.offerHours),
    reminderClause: reminderClause(locale, deadlines.reminderHours),
    publicListPeriod: daysPhrase(locale, deadlines.publicListDays),
  };
}

/**
 * The notice's marker for the public list's states (§396, amending §32, §143): filled with the
 * three state words (`listStatesClause`), and the switch — the list shows states and the pending
 * and waiting only while the notice in force names it (`describesListStates`).
 */
export const LIST_STATES_MERGE_FIELD = "participantListStates";

/**
 * The notice's marker for the socials on the public list (§500, widening §106): filled with the
 * form's tick words, and the switch (`describesListSocials`). A tick is kept only when the
 * runner's own notice named it.
 */
export const LIST_SOCIALS_MERGE_FIELD = "participantListSocials";

/**
 * The event's minimum age (§329, §440), unit included (`yearsPhrase`: "20 de ani"). Given "", the
 * paragraph naming it is dropped whole (`dropsParagraph`); since §515 no event gives "" (races ≥ 14,
 * group runs ≥ 18), but a caller passing zero still prints no sentence about no age.
 */
export const MINIMUM_AGE_MERGE_FIELD = "minimumAge";

/** "" for none, which drops the sentence (`dropsParagraph`), never "0 ani". */
export function minimumAgeMergeValue(minAge: number, locale: string): string {
  return minAge > 0 ? yearsPhrase(minAge, locale) : "";
}

/**
 * A group run's series (§523): name, rhythm and usual place, filled at signing from the dates §113
 * groups and kept in `signed_facts`. The template carries a series sentence and a one-off sentence;
 * `dropsParagraph` keeps the one that fits. A text naming no series field gets no series values,
 * so nothing is dropped (AGENTS.md §12.5).
 */
export const SERIES_MERGE_FIELDS = ["series", "seriesRhythm", "seriesPlace"] as const;

/** The fields whose "" drops the paragraph naming them. */
export const PARAGRAPH_MERGE_FIELDS: ReadonlySet<string> = new Set([MINIMUM_AGE_MERGE_FIELD, ...SERIES_MERGE_FIELDS]);

const SERIES_FIELD_SET: ReadonlySet<string> = new Set(SERIES_MERGE_FIELDS);

const filled = (value: string | null | undefined): boolean => typeof value === "string" && value.trim() !== "";

/**
 * The series sentence without its place clause (§523): kept only when `{{seriesPlace}}` is "", so
 * exactly one shape survives.
 */
export function isPlacelessSeriesSentence(paragraph: string): boolean {
  const names = new Set(Array.from(paragraph.matchAll(FIELD_PATTERN), (match) => match[1]));
  return names.has("series") && names.has("seriesRhythm") && !names.has("seriesPlace");
}

/**
 * A paragraph is left out when it names a paragraph field given "", when it is the one-off sentence
 * (`{{eventDate}}`, no series field) of a series run, or the placeless series sentence while a
 * place is filled.
 */
export function dropsParagraph(paragraph: string, values: MergeValues): boolean {
  let namesSeries = false;
  let namesEventDate = false;
  for (const match of paragraph.matchAll(FIELD_PATTERN)) {
    const name = match[1];
    if (PARAGRAPH_MERGE_FIELDS.has(name) && isMergeField(name) && values[name] === "") return true;
    if (SERIES_FIELD_SET.has(name)) namesSeries = true;
    if (name === "eventDate") namesEventDate = true;
  }
  if (namesSeries && filled(values.seriesPlace) && isPlacelessSeriesSentence(paragraph)) return true;
  return namesEventDate && !namesSeries && filled(values.series);
}

/**
 * The notice's marker for the newsletter (§445): filled with the topics, and the switch — no address
 * is collected before the approved notice describes it (`describesNewsletter`, §146).
 */
export const NEWSLETTER_MERGE_FIELD = "newsletterTopics";

/**
 * The notice's marker for «Echipa» (§459), whose names and photos are personal data; `/admin/tasks`
 * and `/admin/pages/team` check it (`describesTeamPage`).
 */
export const TEAM_PAGE_MERGE_FIELD = "teamPage";

/**
 * The blanks in a legal text (§95): named fields inside the approved, hashed text, filled when shown
 * or printed for one person and event. A closed list; an unfilled field renders as the paper form's
 * dotted blank. Identity documents (§330): `idDocument` is the declarant's (the parent's for a
 * minor; older texts read unchanged), `participantIdDocument` the participant's own,
 * `guardianIdDocument` the guardian's (an em dash for an adult).
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
  MINIMUM_AGE_MERGE_FIELD,
  ...SERIES_MERGE_FIELDS,
  ...DEADLINE_MERGE_FIELDS,
  LIST_STATES_MERGE_FIELD,
  LIST_SOCIALS_MERGE_FIELD,
  NEWSLETTER_MERGE_FIELD,
  TEAM_PAGE_MERGE_FIELD,
] as const;

/** A text naming any of these asks for identity documents at signing (§95, §330). */
export const ID_DOCUMENT_FIELDS = ["idDocument", "participantIdDocument", "guardianIdDocument"] as const;

export type MergeField = (typeof MERGE_FIELDS)[number];

export type MergeValues = Partial<Record<MergeField, string | null | undefined>>;

/** The dotted blank of a paper form, for a field with no value yet. */
export const BLANK = "…………………";

const FIELD_PATTERN = /\{\{\s*([a-zA-Z]+)\s*\}\}/g;

/** An unknown name is left as written. */
export function mergeText(text: string, values: MergeValues): string {
  return mergeTextSegments(text, values)
    .map((segment) => segment.text)
    .join("");
}

/**
 * One piece of merged text, and whether it came from a `{{field}}` — so the signer's filled-in
 * parts can be bold (§225). The dotted blank counts as filled: it is where the paper form is
 * written by hand. The hash is over the unmerged template, untouched (AGENTS.md §12.5, §46).
 */
export type MergedSegment = { text: string; filled: boolean };

export function mergeTextSegments(text: string, values: MergeValues): MergedSegment[] {
  const segments: MergedSegment[] = [];
  let index = 0;

  for (const match of text.matchAll(FIELD_PATTERN)) {
    const name = match[1];
    const at = match.index ?? 0;
    // Unknown names stay as written, unemphasised.
    if (!isMergeField(name)) continue;
    if (at > index) segments.push({ text: text.slice(index, at), filled: false });
    const value = values[name];
    index = at + match[0].length;
    if (value === "" && OMITTABLE_MERGE_FIELDS.has(name)) continue;
    segments.push({ text: value && value.trim() ? value.trim() : BLANK, filled: true });
  }

  if (index < text.length) segments.push({ text: text.slice(index), filled: false });
  return segments;
}

/** An unreadable body merges to no sections, as the renderer shows none. */
export function mergeLegalBody(body: unknown, values: MergeValues): LegalDocumentBody {
  const sections = isLegalDocumentBody(body) ? body.sections : [];
  return {
    sections: sections.map((section) => ({
      ...(section.heading !== undefined ? { heading: mergeText(section.heading, values) } : {}),
      paragraphs: section.paragraphs.filter((paragraph) => !dropsParagraph(paragraph, values)).map((paragraph) => mergeText(paragraph, values)),
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

export function asksForIdDocument(body: unknown): boolean {
  const fields = mergeFieldsIn(body);
  return ID_DOCUMENT_FIELDS.some((field) => fields.has(field));
}

/**
 * The gate for the two-signer minor's declaration (§330): only a text naming
 * `{{participantIdDocument}}` asks for the minor's own document. Under an older text (and the notice
 * approved beside it, GDPR art. 13) the parent alone signs, with one document, as before.
 */
export function asksForMinorSignature(body: unknown): boolean {
  return mergeFieldsIn(body).has("participantIdDocument");
}

/** The switch for the list's states (§396): the approved notice in force names the field; no setting. */
export function describesListStates(body: unknown): boolean {
  return mergeFieldsIn(body).has(LIST_STATES_MERGE_FIELD);
}

/** The switch for the list's socials (§500): the form's tick, keeping it, and printing them. */
export function describesListSocials(body: unknown): boolean {
  return mergeFieldsIn(body).has(LIST_SOCIALS_MERGE_FIELD);
}

/** The switch for the newsletter pop-up and every subscription (§445). */
export function describesNewsletter(body: unknown): boolean {
  return mergeFieldsIn(body).has(NEWSLETTER_MERGE_FIELD);
}

/** §459. */
export function describesTeamPage(body: unknown): boolean {
  return mergeFieldsIn(body).has(TEAM_PAGE_MERGE_FIELD);
}

export function isMergeField(name: string): name is MergeField {
  return (MERGE_FIELDS as readonly string[]).includes(name);
}
