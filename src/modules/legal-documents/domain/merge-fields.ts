import { isLegalDocumentBody, type LegalDocumentBody } from "./content-hash";

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
 * Six names and no more. Anything else the club wants in the text — the organiser's legal name,
 * the rules — is the text's own words. A field with no value renders as the dotted blank the
 * paper form has, which is what a blank declaration printed for the desk should show.
 */
export const MERGE_FIELDS = ["participant", "declarant", "guardian", "idDocument", "event", "eventDate", "eventLocation", "signedAt"] as const;

export type MergeField = (typeof MERGE_FIELDS)[number];

export type MergeValues = Partial<Record<MergeField, string | null | undefined>>;

/** The dotted blank of a paper form, for a field with no value yet. */
export const BLANK = "…………………";

const FIELD_PATTERN = /\{\{\s*([a-zA-Z]+)\s*\}\}/g;

/** Substitute every `{{field}}` in one string; an unknown name is left as written. */
export function mergeText(text: string, values: MergeValues): string {
  return text.replace(FIELD_PATTERN, (whole, name: string) => {
    if (!isMergeField(name)) return whole;
    const value = values[name];
    return value && value.trim() ? value.trim() : BLANK;
  });
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

export function isMergeField(name: string): name is MergeField {
  return (MERGE_FIELDS as readonly string[]).includes(name);
}
