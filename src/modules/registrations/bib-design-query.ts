/**
 * A bib's design as a form posts it and as a URL carries it — the wire shapes of `bib-design.ts`.
 *
 * The editor's "Cum arată numărul de concurs" panel has a live preview: an `<img>` whose `src`
 * is the picture route with the **unsaved** design in its query string, rebuilt as the boxes
 * change (the owner: "la BID îmi trebuie un preview aici"). Three places must agree on the
 * shape of that string — the Server Component that draws the panel with its first `src`, the
 * client island that rebuilds it, and the route that reads it back — and this file is where
 * they agree.
 *
 * ## Why it is not part of `bib-design.ts`
 *
 * That module holds the Zod schema, and this one is imported by a client island. Nothing on
 * the client validates a design — the route does, with the same schema the save uses — so the
 * island needs only to *read boxes and write a query*, and shipping Zod to the browser for
 * that would be the first client module in this application to carry it. Pure, no imports:
 * the same discipline `bib-design.ts` follows for the two renderers.
 *
 * ## One reader for the form
 *
 * `readBibDesignForm` is what `admin/actions.ts` gathers the panel's boxes with before the
 * save, and what the island gathers them with before the preview. One function, so the
 * picture on the screen is drawn from exactly what the save would post: a checkbox that is
 * off posts nothing and reads `false` in both; a select reads its value in both.
 */

/** The panel's boxes, in the form's own vocabulary — the `name` attributes after the prefix. */
export const BIB_DESIGN_FORM_PREFIX = "event.bibDesign.";

/** What the panel posts, before validation: the action's and the island's common reading. */
export type BibDesignFormValues = {
  showName: boolean;
  showEventTitle: boolean;
  showDate: boolean;
  showLogo: boolean;
  numberScale: string;
  namePosition: string;
  headerImageSrc: string | null;
  sponsorImageSrc: string | null;
  cutMarks: boolean;
  /** The footer's switches and the club's own line (§317; `bib-footer.ts`). */
  showEmail: boolean;
  showPartners: boolean;
  showEventInFooter: boolean;
  showWebsite: boolean;
  /** As typed: the schema trims it, keeps it to one line and to `BIB_FOOTER_TEXT_MAX`. */
  footerText: string;
};

const SWITCHES = [
  "showName",
  "showEventTitle",
  "showDate",
  "showLogo",
  "cutMarks",
  "showEmail",
  "showPartners",
  "showEventInFooter",
  "showWebsite",
] as const;
const CHOICES = ["numberScale", "namePosition"] as const;
const PICTURES = ["headerImageSrc", "sponsorImageSrc"] as const;
/** Free text: absent from the address when empty, so the platform's design has no such key. */
const TEXTS = ["footerText"] as const;

/**
 * The panel's boxes as the browser would post them, read through one `get`.
 *
 * `get` is `FormData#get` narrowed to strings — the action passes the posted form, the island
 * a `FormData` built from the live one — and the rules are the ones the action has applied
 * since §249: a checkbox is on when it posts `"on"`, a select falls back to the platform's
 * choice when it posts nothing, and a picker with nothing chosen is `null`.
 */
export function readBibDesignForm(get: (name: string) => string | null): BibDesignFormValues {
  const field = (name: string) => get(`${BIB_DESIGN_FORM_PREFIX}${name}`);
  return {
    showName: field("showName") === "on",
    showEventTitle: field("showEventTitle") === "on",
    showDate: field("showDate") === "on",
    showLogo: field("showLogo") === "on",
    numberScale: field("numberScale")?.trim() || "medium",
    namePosition: field("namePosition")?.trim() || "below",
    headerImageSrc: field("headerImageSrc")?.trim() || null,
    sponsorImageSrc: field("sponsorImageSrc")?.trim() || null,
    cutMarks: field("cutMarks") === "on",
    showEmail: field("showEmail") === "on",
    showPartners: field("showPartners") === "on",
    showEventInFooter: field("showEventInFooter") === "on",
    showWebsite: field("showWebsite") === "on",
    // A text box always posts, empty or not; what it may say is the schema's to decide.
    footerText: field("footerText") ?? "",
  };
}

/** Whether a box with this `name` changes the bib — the inputs the preview listens to. */
export function isBibDesignInput(name: string): boolean {
  return name.startsWith(BIB_DESIGN_FORM_PREFIX) || name === "event.bibColour" || name === "event.bibStartNumber";
}

/**
 * The design as query parameters: switches as `1`/`0`, choices as their word, pictures as
 * their address and absent when there is none, the club's own line as typed and absent when
 * empty. The keys are the schema's own field names, so `bibDesignValuesFromQuery` is the
 * mirror image and the round trip is exact.
 */
export function bibDesignSearchParams(values: BibDesignFormValues, into = new URLSearchParams()): URLSearchParams {
  for (const key of SWITCHES) into.set(key, values[key] ? "1" : "0");
  for (const key of CHOICES) into.set(key, values[key]);
  for (const key of PICTURES) {
    const picture = values[key];
    if (picture) into.set(key, picture);
  }
  for (const key of TEXTS) {
    if (values[key].trim()) into.set(key, values[key]);
  }
  return into;
}

/**
 * The design read back out of a query, as far as the string can say.
 *
 * Only the schema's own keys are looked at, and only a value that means something is set:
 * a switch that is neither `1` nor `0`, or a key that is absent, is left out so that
 * `readBibDesign` (which validates this) falls back to the platform's choice for that one
 * field rather than for the whole design. Nothing here decides what is *valid* — a picture
 * from somebody else's server passes through and is refused where every stored design is.
 */
export function bibDesignValuesFromQuery(params: URLSearchParams): Partial<BibDesignFormValues> {
  const values: Partial<BibDesignFormValues> = {};
  for (const key of SWITCHES) {
    const raw = params.get(key);
    if (raw === "1") values[key] = true;
    else if (raw === "0") values[key] = false;
  }
  for (const key of CHOICES) {
    const raw = params.get(key);
    if (raw) values[key] = raw;
  }
  for (const key of PICTURES) {
    const raw = params.get(key);
    values[key] = raw ? raw : null;
  }
  for (const key of TEXTS) {
    const raw = params.get(key);
    if (raw) values[key] = raw;
  }
  return values;
}

/**
 * The number a sample bib is drawn with, or `null` for "use the event's own start".
 *
 * A whole number a bib can carry — up to five digits, the widest the renderers allow for.
 * The box it comes from is being typed into while the preview follows, so "", "0", "1e3" and
 * "abc" all read as "not a number yet" rather than as an error.
 */
export function bibNumberFromQuery(raw: string | null): number | null {
  if (raw === null || !/^\d{1,5}$/.test(raw.trim())) return null;
  const value = Number(raw);
  return value >= 1 && value <= 99_999 ? value : null;
}

/**
 * Where the panel's picture comes from: the preview route in sample mode, with the unsaved
 * design, the band's colour and the start number from the same form.
 *
 * Relative, like every other `<img src>` on the backoffice pages — the route is this
 * application's own. `colour` is sent as the select holds it: empty means the club's colour,
 * which the route reads as "no colour" the way the save does.
 */
export function bibPreviewUrl(input: {
  eventId: string;
  locale: string;
  /** The start-number box as it reads now; the route falls back to the stored one. */
  number: string | null;
  /** The colour select as it reads now; empty is the club's colour. */
  colour: string | null;
  design: BibDesignFormValues;
}): string {
  const params = new URLSearchParams({ sample: "1", locale: input.locale });
  if (input.number?.trim()) params.set("number", input.number.trim());
  if (input.colour?.trim()) params.set("colour", input.colour.trim());
  bibDesignSearchParams(input.design, params);
  return `/api/admin/events/${encodeURIComponent(input.eventId)}/bibs/preview?${params.toString()}`;
}
