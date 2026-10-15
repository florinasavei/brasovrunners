/**
 * A volunteer badge's design as the form posts it and as the preview's address carries it (§764) —
 * the wire shapes of `badge-design.ts`, as `bib-design-query.ts` is the bib's.
 *
 * The designer «Cum arată ecusonul» has a live preview: an `<img>` whose `src` is the picture route
 * with the **unsaved** design in its query string, rebuilt as the boxes change. Three places agree on
 * that string here — the page that draws the first `src`, the client island that rebuilds it
 * (`BibDesignPreview` with `kind="badge"`), and the route that reads it back — and one reader of the
 * form (`readBadgeDesignForm`) serves the save and the island, so the picture is drawn from exactly
 * what the save would post. Pure and importing nothing, so the island ships no schema.
 */

/** The designer's boxes, in the form's vocabulary: the `name` attributes after this prefix. */
export const BADGE_DESIGN_FORM_PREFIX = "badge.design.";

/** A picture's crop as the form posts it (JSON) or a stored design holds it (the object). */
export type BadgeCropValue = string | { x: number; y: number; w: number; h: number } | null;

/** What the designer posts, before validation: the action's and the island's common reading. */
export type BadgeDesignFormValues = {
  size: string;
  /** «Lățimea» and «Înălțimea» in millimetres, as typed; NaN when the box holds no number. */
  customWidthMm: number;
  customHeightMm: number;
  /** The band's colour from the palette, or null for the club's blue. */
  bandColour: string | null;
  headerImageSrc: string | null;
  headerImageCrop: BadgeCropValue;
  showLogo: boolean;
  showTitle: boolean;
  titleRo: string;
  titleEn: string;
  labelRo: string;
  labelEn: string;
  writingLine: boolean;
  showFreeText: boolean;
  freeTextRo: string;
  freeTextEn: string;
  showMarker: boolean;
  markerLabelRo: string;
  markerLabelEn: string;
  showPhone: boolean;
  phone: string;
  phoneLabelRo: string;
  phoneLabelEn: string;
  cutMarks: boolean;
};

const SWITCHES = ["showLogo", "showTitle", "writingLine", "showFreeText", "showMarker", "showPhone", "cutMarks"] as const;
const TEXTS = [
  "size",
  "titleRo",
  "titleEn",
  "labelRo",
  "labelEn",
  "freeTextRo",
  "freeTextEn",
  "markerLabelRo",
  "markerLabelEn",
  "phone",
  "phoneLabelRo",
  "phoneLabelEn",
] as const;
const NUMBERS = ["customWidthMm", "customHeightMm"] as const;

/** Whether a form control is one of the designer's: the island listens to these and nothing else. */
export function isBadgeDesignInput(name: string): boolean {
  return name.startsWith(BADGE_DESIGN_FORM_PREFIX);
}

/** A box's number, or NaN: an empty box is no number, never zero. */
function numberOf(raw: string | null): number {
  const text = (raw ?? "").trim().replace(",", ".");
  return text === "" ? Number.NaN : Number(text);
}

/**
 * The designer's boxes, read from a form through `get` (a `FormData`'s, the island's or the action's): a
 * tick that is off posts nothing and reads false; an empty colour or picture reads null.
 */
export function readBadgeDesignForm(get: (name: string) => string | null): BadgeDesignFormValues {
  const at = (key: string) => get(`${BADGE_DESIGN_FORM_PREFIX}${key}`);
  const text = (key: string) => at(key) ?? "";
  const orNull = (key: string) => {
    const value = (at(key) ?? "").trim();
    return value === "" ? null : value;
  };
  return {
    size: text("size"),
    customWidthMm: numberOf(at("customWidthMm")),
    customHeightMm: numberOf(at("customHeightMm")),
    bandColour: orNull("bandColour"),
    headerImageSrc: orNull("headerImageSrc"),
    headerImageCrop: orNull("headerImageCrop"),
    showLogo: at("showLogo") !== null,
    showTitle: at("showTitle") !== null,
    titleRo: text("titleRo"),
    titleEn: text("titleEn"),
    labelRo: text("labelRo"),
    labelEn: text("labelEn"),
    writingLine: at("writingLine") !== null,
    showFreeText: at("showFreeText") !== null,
    freeTextRo: text("freeTextRo"),
    freeTextEn: text("freeTextEn"),
    showMarker: at("showMarker") !== null,
    markerLabelRo: text("markerLabelRo"),
    markerLabelEn: text("markerLabelEn"),
    showPhone: at("showPhone") !== null,
    phone: text("phone"),
    phoneLabelRo: text("phoneLabelRo"),
    phoneLabelEn: text("phoneLabelEn"),
    cutMarks: at("cutMarks") !== null,
  };
}

/** The design as the preview's address carries it: every key by its own name, ticks as `1`/`0`. */
export function badgeDesignQuery(values: BadgeDesignFormValues | Record<string, unknown>): URLSearchParams {
  const params = new URLSearchParams();
  const record = values as Record<string, unknown>;
  for (const key of SWITCHES) params.set(key, record[key] ? "1" : "0");
  for (const key of TEXTS) {
    const value = record[key];
    if (typeof value === "string" && value !== "") params.set(key, value);
  }
  for (const key of NUMBERS) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) params.set(key, String(value));
  }
  if (typeof record.bandColour === "string" && record.bandColour) params.set("bandColour", record.bandColour);
  if (typeof record.headerImageSrc === "string" && record.headerImageSrc) {
    params.set("headerImageSrc", record.headerImageSrc);
    const crop = record.headerImageCrop;
    if (crop) params.set("headerImageCrop", typeof crop === "string" ? crop : JSON.stringify(crop));
  }
  return params;
}

/** The address's design read back into the form's values, for the schema to validate. */
export function badgeDesignValuesFromQuery(params: URLSearchParams): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const key of SWITCHES) if (params.has(key)) values[key] = params.get(key) === "1";
  for (const key of TEXTS) if (params.has(key)) values[key] = params.get(key) ?? "";
  for (const key of NUMBERS) if (params.has(key)) values[key] = numberOf(params.get(key));
  if (params.has("bandColour")) values.bandColour = params.get("bandColour") || null;
  values.headerImageSrc = params.get("headerImageSrc") || null;
  values.headerImageCrop = params.get("headerImageCrop") || null;
  return values;
}

/**
 * The address of one sample badge drawn from an unsaved design (the designer's preview): the event, the
 * badge's language, the role it is drawn for (its id, or `none` for a badge «fără rol»), the design, and
 * `version` — what the sample is drawn from beside the form (the roles' saved names and colours) — so a
 * change there is a new address too.
 */
export function badgePreviewUrl(input: {
  eventId: string;
  locale: string;
  role: string;
  design: BadgeDesignFormValues | Record<string, unknown>;
  version?: string;
}): string {
  const params = badgeDesignQuery(input.design);
  params.set("sample", "1");
  params.set("locale", input.locale);
  params.set("role", input.role);
  if (input.version) params.set("v", input.version);
  return `/api/admin/events/${input.eventId}/badges/preview?${params.toString()}`;
}

/** The address of one role's badge as saved, stamped with what it is drawn from (§748's rule). */
export function badgePictureSrc(input: { eventId: string; locale: string; role: string; stamp: string }): string {
  const params = new URLSearchParams({ locale: input.locale, role: input.role, v: input.stamp });
  return `/api/admin/events/${input.eventId}/badges/preview?${params.toString()}`;
}
