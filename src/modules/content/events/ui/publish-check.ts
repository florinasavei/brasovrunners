import { isBlankValue } from "@/shared/forms/blank-value";

/**
 * What publication would refuse, read off a form as it stands (§315, §NNN) — the same rule the
 * server applies (`missingPublicEventFields`, `REQUIRED_PUBLIC_TRANSLATION_FIELDS`): a title and
 * a summary in every language, the meeting point unless the place is to be announced (§328), and
 * a page address in every language.
 *
 * One function for the two things that ask it on the create page — "Creează și publică", which
 * dims and names the first gap, and the "Ce lipsește pentru publicare" list in the Publicare box,
 * which names them all — so the two never disagree. In the order of the editor's boxes (box 2,
 * box 5, box 14), and each gap says which box holds it, so the words on the screen are the box's
 * title and not a column name.
 *
 * `read` answers a box's posted value by its `name` (`""` for a box that is not there): a
 * `FormData` in the browser, a plain object in a test.
 */
export type PublishGapBox = "titleSummary" | "place" | "address";
export type PublishGapField = "title" | "excerpt" | "locationName" | "slug";
export type PublishGap = { box: PublishGapBox; locale?: string; field: PublishGapField; name: string };

export function missingForPublish(read: (name: string) => string, locales: readonly string[]): PublishGap[] {
  const text = (name: string) => read(name).trim();
  const field = (locale: string, box: string) => `translations.${locale}.${box}`;
  const gaps: PublishGap[] = [];

  for (const locale of locales) {
    if (text(field(locale, "title")) === "") gaps.push({ box: "titleSummary", locale, field: "title", name: field(locale, "title") });
    if (isBlankValue(read(field(locale, "excerptBody")))) {
      gaps.push({ box: "titleSummary", locale, field: "excerpt", name: field(locale, "excerptBody") });
    }
  }
  // No meeting point is a gap only while the place is announced (§328): with the switch on, the
  // server publishes without one and every surface says it is to be announced.
  if (read("event.locationToBeAnnounced") !== "on" && text("event.locationName") === "") {
    gaps.push({ box: "place", field: "locationName", name: "event.locationName" });
  }
  for (const locale of locales) {
    if (text(field(locale, "slug")) === "") gaps.push({ box: "address", locale, field: "slug", name: field(locale, "slug") });
  }
  return gaps;
}

/** The words a gap is named by: the box, the language when it has one, the field. */
export type PublishGapLabels = {
  boxes: Readonly<Record<PublishGapBox, string>>;
  fields: Readonly<Record<PublishGapField, string>>;
  /** The language in its own words, by locale. */
  languages: Readonly<Record<string, string>>;
};

/** "Titlu și rezumat › English › Rezumat", "Locul › Punct de întâlnire". */
export function publishGapLabel(gap: PublishGap, labels: PublishGapLabels): string {
  return [labels.boxes[gap.box], gap.locale ? (labels.languages[gap.locale] ?? gap.locale) : null, labels.fields[gap.field]]
    .filter((part): part is string => Boolean(part))
    .join(" › ");
}
