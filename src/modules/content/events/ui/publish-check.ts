import { PLACE_NAME_FIELD, type PlaceNameLocale } from "@/modules/events/domain/place";
import { isBlankValue } from "@/shared/forms/blank-value";
import { identicalInBothLanguages } from "@/shared/forms/both-languages";
import { MAX_CO_HOSTS } from "@/modules/events/domain/co-hosts";

/**
 * What publication would refuse, read off a form as it stands (§315, §350) — the same rule the
 * server applies (`missingPublicEventFields`, `REQUIRED_PUBLIC_TRANSLATION_FIELDS`): a title and
 * a summary in every language, the meeting point in every language unless the place is to be
 * announced (§328, §362), and a page address in every language.
 *
 * One function for everything that asks it, on both pages — the "Ce lipsește pentru publicare"
 * list in the Publicare box, which names them all; since §NNN each card's closed line and its tabs'
 * counts, the map's chips, and "Creează și publică" and "Publică", which open the summary of gaps
 * instead of posting while one is left (over what is typed on the create page, over what is saved
 * on the editor, `storedPublishReader`) — so none of them disagree. In the order of the editor's
 * boxes (the title, the place, the address), and each gap says which box holds it, so the words on
 * the screen are the box's title and not a column name.
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
  // server publishes without one and every surface says it is to be announced. One box per
  // language (§362), each its own gap — a missing English place like any missing translation.
  if (read("event.locationToBeAnnounced") !== "on") {
    for (const locale of locales) {
      const box = PLACE_NAME_FIELD[locale as PlaceNameLocale];
      if (box && text(`event.${box}`) === "") gaps.push({ box: "place", locale, field: "locationName", name: `event.${box}` });
    }
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

/** "Titlu și rezumat › English › Rezumat", "Locul › English › Punct de întâlnire". */
export function publishGapLabel(gap: PublishGap, labels: PublishGapLabels): string {
  return [labels.boxes[gap.box], gap.locale ? (labels.languages[gap.locale] ?? gap.locale) : null, labels.fields[gap.field]]
    .filter((part): part is string => Boolean(part))
    .join(" › ");
}

// --- The same gaps, seen from outside each card (§NNN) --------------------------------------

/**
 * The card each gap belongs to, by its `#box-…` id: where "Publică" scrolls to and whose closed
 * line names it (§NNN; the owner, of a closed "Titlu și rezumat" whose tabs said only "incomplet":
 * "I need to see on the cards as well what info is required").
 */
export const PUBLISH_GAP_CARD: Readonly<Record<PublishGapBox, `box-${string}`>> = {
  titleSummary: "box-title",
  place: "box-place",
  address: "box-address",
};

/** One card's missing fields, each with the languages it is missing in, in the order of the gaps. */
export type CardGap = { field: PublishGapField; locales: string[] };

/** The gaps of one card, field by field: `[{ field: "title", locales: ["ro", "en"] }, …]`. */
export function cardGaps(gaps: readonly PublishGap[], box: PublishGapBox): CardGap[] {
  const byField: CardGap[] = [];
  for (const gap of gaps) {
    if (gap.box !== box) continue;
    const locale = gap.locale ?? "";
    const entry = byField.find((item) => item.field === gap.field);
    if (!entry) byField.push({ field: gap.field, locales: [locale] });
    else if (!entry.locales.includes(locale)) entry.locales.push(locale);
  }
  return byField;
}

/** The words a card's closed line is made of: "lipsesc: {list}", "complet", each field's name. */
export type CardGapWords = {
  /** With `{list}`. */
  missing: string;
  complete: string;
  fields: Readonly<Record<PublishGapField, string>>;
};

/**
 * A card's required line: «lipsesc: Titlu (RO, EN) · Rezumat (RO)», or «complet» — each field by
 * the name its box wears, each language by its code, as every closed line on the editor writes a
 * language (`box-summaries.ts`).
 */
export function cardGapLine(gaps: readonly PublishGap[], box: PublishGapBox, words: CardGapWords): string {
  const missing = cardGaps(gaps, box);
  if (missing.length === 0) return words.complete;
  const list = missing
    .map((entry) => `${words.fields[entry.field]} (${entry.locales.filter(Boolean).map((locale) => locale.toUpperCase()).join(", ")})`)
    .join(" · ");
  return words.missing.replace("{list}", list);
}

/** How many required boxes one language of one card still lacks — what its tab counts. */
export function missingInLanguage(gaps: readonly PublishGap[], box: PublishGapBox, locale: string): number {
  return gaps.filter((gap) => gap.box === box && gap.locale === locale).length;
}

/** What `storedPublishReader` reads of the event row. */
export type StoredPublishEvent = { locationName: string | null; locationToBeAnnounced: boolean };
/** What it reads of each language. */
export type StoredPublishTranslation = { locale: string; title: string; excerpt: string | null; slug: string; locationName: string | null };

/**
 * The saved event as `missingForPublish` reads a form: the editor's closed lines, its Publicare
 * list and its "Publică" ask the same function the create page asks of the boxes as typed, so the
 * two pages cannot name different gaps.
 *
 * Read the way the server's guard reads the row (`missingPublicFields`, `missingPublicEventFields`):
 * the summary by its plain text, the meeting point as the language's page names it (its own name,
 * else the event's — `placeNameIn`), a language with no row as every box blank.
 */
export function storedPublishReader(event: StoredPublishEvent, translations: readonly StoredPublishTranslation[]): (name: string) => string {
  const inLanguage = (locale: string) => translations.find((row) => row.locale === locale);
  const place = (locale: string) => inLanguage(locale)?.locationName?.trim() || event.locationName?.trim() || "";
  return (name) => {
    if (name === "event.locationToBeAnnounced") return event.locationToBeAnnounced ? "on" : "";
    for (const [locale, box] of Object.entries(PLACE_NAME_FIELD)) if (name === `event.${box}`) return place(locale);
    const text = /^translations\.([a-z]+)\.(title|excerptBody|slug)$/.exec(name);
    const row = text ? inLanguage(text[1]) : undefined;
    if (!text || !row) return "";
    if (text[2] === "title") return row.title;
    if (text[2] === "slug") return row.slug;
    return row.excerpt ?? "";
  };
}

/**
 * The value of every box `missingForPublish` reads, as a plain record a Server Component can hand
 * an island (§NNN): the islands read a box the form does not draw from here.
 */
export function publishCheckValues(read: (name: string) => string, locales: readonly string[]): Record<string, string> {
  const names = new Set<string>(["event.locationToBeAnnounced"]);
  // Every name the check asks for, found by asking it with a reader that records them.
  missingForPublish((name) => {
    names.add(name);
    return "";
  }, locales);
  return Object.fromEntries([...names].map((name) => [name, read(name)]));
}

// --- The same words in both languages (§354, bilingual everywhere) ---------------------------

/**
 * The boxes whose long text is checked for "identical in both languages", in the order of the
 * editor's boxes: the summary (box 2), the description (3), the programme's notes and what to
 * bring (6), the rules (7), each partner's description (12), and the route description in the
 * "Traseul" card (§387). A title, a place's name or a link's label is short and may honestly read
 * the same — none of them is here.
 */
export type IdenticalBox = "titleSummary" | "description" | "programme" | "rules" | "coHosts" | "course";
export type IdenticalField = "excerpt" | "body" | "schedule" | "checklist" | "rules" | "coHostDescription" | "routeDescription";
/**
 * One text whose second language says exactly what the first does. `locale` is the language that
 * carries the copy (English, beside the Romanian it copies), `name` its box — where the warning's
 * link goes — and `partner` the card's number, from 1, for a partner's description.
 */
export type IdenticalText = { box: IdenticalBox; field: IdenticalField; locale: string; name: string; partner?: number };

/** A language's texts, by the name each box posts after `translations.<locale>.`. */
const TRANSLATION_TEXTS: ReadonlyArray<readonly [IdenticalBox, IdenticalField, string]> = [
  ["titleSummary", "excerpt", "excerptBody"],
  ["description", "body", "body"],
  ["programme", "schedule", "schedule"],
  ["programme", "checklist", "checklist"],
  ["rules", "rules", "rules"],
  ["course", "routeDescription", "routeDescription"],
];

/** "Ro", "En": a partner card's boxes are named by the language's code with a capital. */
const suffix = (locale: string) => `${locale.charAt(0).toUpperCase()}${locale.slice(1)}`;

/**
 * Which long texts are the same words in both languages (§354, bilingual everywhere) — the
 * Romanian description pasted into the English box, as the English "Happy Monday" date carries on
 * production. A **warning** for the Publicare box's check and the boxes themselves, never a
 * refusal: `identicalInBothLanguages` counts only a text longer than forty characters, and even
 * that may be deliberate.
 *
 * The first locale is the one the others are compared with (`routing.locales` order: Romanian).
 * `read` answers a box by its posted name, as `missingForPublish` takes it: the form's own values
 * on the create page, the stored row (`storedTextReader`) on the editor.
 */
export function identicalTexts(read: (name: string) => string, locales: readonly string[]): IdenticalText[] {
  const [source, ...others] = locales;
  if (!source) return [];
  const found: IdenticalText[] = [];
  for (const [box, field, posted] of TRANSLATION_TEXTS) {
    for (const locale of others) {
      const name = `translations.${locale}.${posted}`;
      if (identicalInBothLanguages(read(`translations.${source}.${posted}`), read(name))) found.push({ box, field, locale, name });
    }
  }
  for (let index = 0; index < MAX_CO_HOSTS; index += 1) {
    for (const locale of others) {
      const name = `event.coHosts[${index}].description${suffix(locale)}`;
      if (identicalInBothLanguages(read(`event.coHosts[${index}].description${suffix(source)}`), read(name))) {
        found.push({ box: "coHosts", field: "coHostDescription", locale, name, partner: index + 1 });
      }
    }
  }
  return found;
}

/** What `storedTextValue` needs of a stored language: its texts as the columns hold them. */
export type StoredTexts = {
  locale: string;
  excerpt: string | null;
  excerptJson: unknown;
  bodyJson: unknown;
  rulesJson: unknown;
  scheduleJson: unknown;
  /** The route / training description (§387); absent for a caller from before it. */
  routeDescriptionJson?: unknown;
  checklist: string | null;
};

/**
 * One stored text as its box would post it — a rich text's document as JSON, a plain box's text —
 * so a check written against the form reads the saved event the same way. The summary falls back
 * to its plain-text column, as its editor does (`excerptJson ?? excerpt`).
 */
export function storedTextValue(translation: StoredTexts, posted: string): string {
  const json = (value: unknown) => (value === null || value === undefined ? "" : JSON.stringify(value));
  switch (posted) {
    case "excerptBody":
      return translation.excerptJson !== null && translation.excerptJson !== undefined ? json(translation.excerptJson) : (translation.excerpt ?? "");
    case "body":
      return json(translation.bodyJson);
    case "rules":
      return json(translation.rulesJson);
    case "schedule":
      return json(translation.scheduleJson);
    case "routeDescription":
      return json(translation.routeDescriptionJson);
    case "checklist":
      return translation.checklist ?? "";
    default:
      return "";
  }
}

/**
 * The saved event as `identicalTexts` reads a form: each language's texts, and each partner's two
 * descriptions as stored (the editor opens with exactly these, `CoHostsBox`).
 */
export function storedTextReader(
  translations: readonly StoredTexts[],
  coHosts: readonly { descriptionRo: string | null; descriptionEn: string | null }[],
): (name: string) => string {
  return (name) => {
    const text = /^translations\.([a-z]+)\.(\w+)$/.exec(name);
    if (text) {
      const translation = translations.find((row) => row.locale === text[1]);
      return translation ? storedTextValue(translation, text[2]) : "";
    }
    const partner = /^event\.coHosts\[(\d+)\]\.description(Ro|En)$/.exec(name);
    if (partner) {
      const host = coHosts[Number(partner[1])];
      return (partner[2] === "Ro" ? host?.descriptionRo : host?.descriptionEn) ?? "";
    }
    return "";
  };
}

/** The words an identical text is named by: the box, the partner when it is one, the language, the field. */
export type IdenticalLabels = {
  boxes: Readonly<Record<IdenticalBox, string>>;
  fields: Readonly<Record<IdenticalField, string>>;
  languages: Readonly<Record<string, string>>;
  /** "Partenerul {p}". */
  partner: string;
};

/** "Descrierea evenimentului › English › Descriere", "Parteneri › Partenerul 1 › English › Despre parteneriat". */
export function identicalTextLabel(item: IdenticalText, labels: IdenticalLabels): string {
  return [
    labels.boxes[item.box],
    item.partner !== undefined ? labels.partner.replace("{p}", String(item.partner)) : null,
    labels.languages[item.locale] ?? item.locale,
    labels.fields[item.field],
  ]
    .filter((part): part is string => Boolean(part))
    .join(" › ");
}
