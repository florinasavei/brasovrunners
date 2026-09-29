import { z } from "zod";
import { bibDesignSchema } from "@/modules/registrations/bib-design";
import { MIN_PARTICIPANT_AGE } from "@/modules/registrations/domain/age";
import { EVENT_REMINDER_MAX_HOURS } from "@/modules/deadlines/domain/deadlines";
import { parseTypedCoordinates } from "@/modules/weather/domain/place";
import { isFacebookLink, isStravaLink } from "@/modules/events/domain/event-type";
import { EMPTY_DOC, parseRichText } from "@/modules/content/rich-text/domain/schema";
import { DEFAULT_DIFFICULTY_STEP, DIFFICULTY_BANDS, DIFFICULTY_STEPS, type DifficultyStep } from "@/modules/events/domain/difficulty";
import { EVENT_SURFACES, EVENT_TYPES } from "@/modules/events/domain/event-type";
import {
  type CoHost,
  DEFAULT_CO_HOST_LINK_KIND,
  isCoHostLinkKind,
  isCoHostUrl,
  MAX_CO_HOST_DESCRIPTION,
  MAX_CO_HOST_LINK_LABEL,
  MAX_CO_HOST_LINK_URL,
  MAX_CO_HOST_LINKS,
  MAX_CO_HOSTS,
  normalizeCoHostDescription,
  normalizeCoHostUrl,
} from "@/modules/events/domain/co-hosts";
import { refuseOneLanguage } from "@/shared/forms/both-languages";
import { EVENT_COST_TYPES, type EventCostType, MAX_DISCOUNT_NOTE, MAX_EVENT_COST_AMOUNT } from "@/modules/events/domain/cost";
import {
  DEFAULT_EVENT_LINK_KIND,
  isEventLinkKind,
  isEventLinkUrl,
  MAX_EVENT_LINK_LABEL,
  MAX_EVENT_LINK_URL,
  MAX_EVENT_LINKS,
  normalizeEventLinkUrl,
  type EventLink,
} from "@/modules/events/domain/links";

/**
 * Exactly which fields the backoffice may write (BR-REQ-050-01 criterion 1). Both schemas are
 * `.strict()`: a Server Action receives whatever the browser sends, so a field nobody meant to
 * expose (`editorial_status`, `version`, `id`) is refused, not applied. Legal text is absent by
 * design (§11.1): `declarationDocumentId` selects an approved version and cannot write a word.
 */

/** Lowercase words joined by single hyphens: what a URL segment may be. */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Empty inputs come back from a form as "", and mean "not stated" rather than "". */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === "" ? null : value))
    .nullable();

/**
 * A closed set the club may decline to answer: "" and null mean "not stated", anything else must be
 * listed. Not `.catch(null)`: a value outside the set did not come from the dropdown, and turning it
 * into "not stated" would hide that.
 */
const optionalEnum = <const T extends readonly [string, ...string[]]>(values: T) =>
  z
    .union([z.enum(values), z.literal("")])
    .nullable()
    .transform((value) => (value === "" ? null : value));

/** A `RichTextEditor` JSON string, parsed against the allowlist so a bad body is a field error; empty allowed. */
const richTextField = z
  .string()
  .max(200_000)
  .optional()
  .transform((value, ctx) => {
    if (!value || value.trim() === "") return EMPTY_DOC;
    try {
      return parseRichText(JSON.parse(value));
    } catch {
      ctx.addIssue({ code: "custom", message: "the text is not a valid document" });
      return z.NEVER;
    }
  });

export const translationFieldsSchema = z
  .object({
    slug: z.string().trim().min(1).max(120).regex(SLUG, {
      message: "a slug is lowercase words joined by hyphens",
    }),
    title: z.string().trim().min(1).max(200),
    /**
     * The plain summary. The form posts only the rich `excerptBody`; absent means "leave it" on a
     * save and the column default on an insert.
     */
    excerpt: optionalText(500).optional(),
    /** The summary as the editor posts it (§73), pictures allowed; when present, `excerpt` is derived from it. */
    excerptBody: richTextField,
    /*
      No `locationName` here (§362): the per-language place name is asked in the Locul box and written
      by the event's save, the Organizer's; `.strict()` refuses it from a text save.
    */
    /** "What to bring", one line in the confirmation and the reminder (§81); absent means "leave it". */
    checklist: optionalText(300).optional(),
    /** The description, rich text like a standing page's body (AGENTS.md §11.3, §71); empty allowed. */
    body: richTextField,
    /** The rules, the same contract as the body (§96); empty allowed. */
    rules: richTextField,
    /** The programme — kit pickup, briefing, start, cut-offs (§96); empty allowed. */
    schedule: richTextField,
    /** The route description (§387), shown under `#route`; the body's contract, empty allowed. */
    routeDescription: richTextField,
    // Optional in the input like `excerpt`: the form posts them, an older caller may not.
    seoTitle: optionalText(200).optional(),
    seoDescription: optionalText(320).optional(),
    /**
     * The club's discount on an external event's fee (§394), meaningful only for `EXTERNAL` +
     * `PAID`; the service clears it otherwise. Both languages or neither (§352).
     */
    discountNote: optionalText(MAX_DISCOUNT_NOTE).optional(),
  })
  .strict();

export type TranslationFields = z.infer<typeof translationFieldsSchema>;

/**
 * A whole number as typed, "" meaning "not stated" rather than 0 (a blank distance must not
 * publish zero kilometres). Capacity uses `min: 1`: the database refuses non-positive capacity, and
 * "nobody may enter" is `registration_mode = NONE`.
 */
const optionalWholeNumber = (options: { min: number; max: number }) =>
  z
    .string()
    .trim()
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .refine(
      (value) =>
        value === null ||
        (/^\d+$/.test(value) && Number(value) >= options.min && Number(value) <= options.max),
      { message: `must be a whole number between ${options.min} and ${options.max}` },
    )
    .transform((value) => (value === null ? null : Number(value)))
    // The bounds again as metadata, which `shared/forms/constraints.ts` can read, so the box
    // carries `min`, `max` and `step` (§315).
    .meta({ html: { type: "number", min: options.min, max: options.max, step: 1 } });

/** As `optionalWholeNumber`, with a default for an absent or empty value rather than null. */
const wholeNumberWithDefault = (fallback: number, options: { min: number; max: number }) =>
  optionalWholeNumber(options)
    .optional()
    .transform((value) => (value === null || value === undefined ? fallback : value));

const optionalUuid = z
  .string()
  .trim()
  .transform((value) => (value === "" ? null : value))
  .nullable()
  .refine(
    (value) =>
      value === null ||
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),
    { message: "must be an identifier chosen from the list" },
  );

/**
 * The https box's browser rule (§315). The pattern is case-insensitive by hand, like the server's
 * `/^https:\/\/\S+$/i`, since HTML `pattern` is case-sensitive and the browser must never refuse
 * what the server accepts.
 */
const HTTPS_BOX = { html: { type: "url", pattern: "[Hh][Tt][Tt][Pp][Ss]://.*" } } as const;

const httpsUrl = (message: string) =>
  z
    .string()
    .trim()
    .max(2000)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .refine((value) => value === null || /^https:\/\/\S+$/i.test(value), { message })
    .meta(HTTPS_BOX);

/**
 * An IANA zone name, checked by `Intl.DateTimeFormat` — the implementation `zoned-time.ts` uses to
 * convert the wall-clock inputs — so any name that passes can be honoured.
 */
const timezone = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine(
    (value) => {
      try {
        new Intl.DateTimeFormat("en-CA", { timeZone: value });
        return true;
      } catch {
        return false;
      }
    },
    { message: "must be a time zone name such as Europe/Bucharest" },
  );

/**
 * One programme row as posted (§117): date, 24-hour time, optional end, both labels, a place. All
 * strings, empty allowed; the service drops a blank row and refuses a half-filled one by number.
 */
const scheduleRowSchema = z
  .object({
    date: z.string().trim().max(10).optional().default(""),
    time: z.string().trim().max(5).optional().default(""),
    endTime: z.string().trim().max(5).optional().default(""),
    ro: z.string().trim().max(200).optional().default(""),
    en: z.string().trim().max(200).optional().default(""),
    place: z.string().trim().max(200).optional().default(""),
  })
  .strict();

export type ScheduleRowInput = z.infer<typeof scheduleRowSchema>;

/**
 * A meeting point in every language unless the place is to be announced (§328, §362), refused on
 * the empty language's box so the summary links to it (§47). `locationNameEn` absent means the
 * caller does not edit the English name and is never refused.
 */
function placeRule(
  fields: { locationName: string | null; locationNameEn?: string | null; locationToBeAnnounced: boolean },
  ctx: z.RefinementCtx,
): void {
  if (fields.locationToBeAnnounced) return;
  if (fields.locationName === null) {
    ctx.addIssue({
      code: "custom",
      path: ["locationName"],
      message: "a meeting point in Romanian is required, unless the place is to be announced later",
    });
  }
  if (fields.locationNameEn === null) {
    ctx.addIssue({
      code: "custom",
      path: ["locationNameEn"],
      message: "a meeting point in English is required, unless the place is to be announced later",
    });
  }
}

/**
 * What each cost kind needs (§343): an amount for `PAID`, a link for `DONATION`, refused on that
 * box (§315). Absent fields mean the caller is not editing the cost and are never refused.
 */
function costRule(
  fields: { costType?: EventCostType | null; costAmount?: string | null; costUrl?: string | null },
  ctx: z.RefinementCtx,
): void {
  if (fields.costType === "PAID" && fields.costAmount !== undefined && !fields.costAmount) {
    ctx.addIssue({ code: "custom", path: ["costAmount"], message: "a paid event must say how much" });
  }
  if (fields.costType === "DONATION" && fields.costUrl !== undefined && !fields.costUrl) {
    ctx.addIssue({ code: "custom", path: ["costUrl"], message: "a donation needs the link where it is made, starting with https://" });
  }
}

/**
 * One partner's link row (§344): kind, address, and both labels — `eventLinkRowSchema`'s four
 * boxes (§332). Exported so the editor reads its ceilings and pattern (§315). Labels are both or
 * neither (§352), refused in `coHostsField` on the empty one.
 */
export const coHostLinkRowSchema = z
  .object({
    kind: z.string().trim().max(20).optional().default(DEFAULT_CO_HOST_LINK_KIND),
    url: z.string().trim().max(MAX_CO_HOST_LINK_URL).optional().default("").meta(HTTPS_BOX),
    labelRo: z.string().trim().max(MAX_CO_HOST_LINK_LABEL).optional().default(""),
    labelEn: z.string().trim().max(MAX_CO_HOST_LINK_LABEL).optional().default(""),
  })
  .strict();

type CoHostLinkRowInput = z.infer<typeof coHostLinkRowSchema>;

/** The editor's spare link line: nothing typed. The kind alone is not an answer. */
const isBlankCoHostLinkRow = (row: CoHostLinkRowInput) => row.url === "" && row.labelRo === "" && row.labelEn === "";

/**
 * One language of the partnership's description (§352): whitespace runs collapse to one space
 * before the ceiling is counted, so a box the browser allowed at `maxLength` (a line break counts
 * one) is never refused for the two characters it posts as. Empty allowed.
 */
const coHostDescriptionBox = z.string().overwrite(normalizeCoHostDescription).max(MAX_CO_HOST_DESCRIPTION).optional().default("");

/**
 * One partner card (§344): a name, the description per language (§352), its links. A blank card is
 * dropped; a name with no links or description is kept (§168). Exported for the editor's ceilings (§315).
 */
export const coHostRowSchema = z
  .object({
    name: z.string().trim().max(200).optional().default(""),
    descriptionRo: coHostDescriptionBox,
    descriptionEn: coHostDescriptionBox,
    links: z.array(coHostLinkRowSchema).max(MAX_CO_HOST_LINKS + 4).optional().default([]),
  })
  .strict();

type CoHostRowInput = z.infer<typeof coHostRowSchema>;

const isBlankCoHostRow = (row: CoHostRowInput) =>
  row.name === "" && row.descriptionRo === "" && row.descriptionEn === "" && row.links.every(isBlankCoHostLinkRow);

/**
 * The partners (§168, §344). Refusals name the partner and link by the posted index, before spare
 * lines are dropped, so the summary lands on the right box (`form-names.ts`). A card with links but
 * no name, a link with a label but no address, or an unknown kind is refused, never dropped or
 * coerced. Descriptions and labels are both languages or neither (§352, `refuseOneLanguage`).
 * Absent means "not editing the partners" (§169), so an older caller never erases the column; the
 * editor always posts, so its empty list is `[]`.
 */
const coHostsField = z
  .array(coHostRowSchema)
  .max(50)
  .superRefine((rows, ctx) => {
    let filledPartners = 0;
    rows.forEach((row, index) => {
      if (isBlankCoHostRow(row)) return;
      filledPartners += 1;
      const p = index + 1;
      if (row.name === "") {
        ctx.addIssue({ code: "custom", path: [index, "name"], message: `partner ${p}: a partner needs a name` });
      }
      refuseOneLanguage(
        ctx,
        { ro: row.descriptionRo, en: row.descriptionEn },
        { ro: [index, "descriptionRo"], en: [index, "descriptionEn"] },
        `partner ${p}: the description of the partnership`,
      );
      let filledLinks = 0;
      row.links.forEach((link, linkIndex) => {
        if (isBlankCoHostLinkRow(link)) return;
        filledLinks += 1;
        const l = linkIndex + 1;
        if (!isCoHostLinkKind(link.kind)) {
          ctx.addIssue({ code: "custom", path: [index, "links", linkIndex, "kind"], message: `partner ${p}, link ${l}: the kind must be one of the list` });
        }
        refuseOneLanguage(
          ctx,
          { ro: link.labelRo, en: link.labelEn },
          { ro: [index, "links", linkIndex, "labelRo"], en: [index, "links", linkIndex, "labelEn"] },
          `partner ${p}, link ${l}: the label`,
        );
        if (link.url === "") {
          ctx.addIssue({
            code: "custom",
            path: [index, "links", linkIndex, "url"],
            message: `partner ${p}, link ${l}: a link needs its address, starting with https://`,
          });
        } else if (!isCoHostUrl(link.url)) {
          ctx.addIssue({ code: "custom", path: [index, "links", linkIndex, "url"], message: `partner ${p}, link ${l}: the address must start with https://` });
        }
      });
      if (filledLinks > MAX_CO_HOST_LINKS) {
        ctx.addIssue({ code: "custom", path: [index, "links"], message: `partner ${p}: at most ${MAX_CO_HOST_LINKS} links can be listed on one partner` });
      }
    });
    if (filledPartners > MAX_CO_HOSTS) {
      ctx.addIssue({ code: "custom", message: `at most ${MAX_CO_HOSTS} partners can be named on one event` });
    }
  })
  .transform((rows): CoHost[] =>
    rows
      .filter((row) => !isBlankCoHostRow(row))
      .map((row) => ({
        name: row.name,
        descriptionRo: row.descriptionRo === "" ? null : row.descriptionRo,
        descriptionEn: row.descriptionEn === "" ? null : row.descriptionEn,
        links: row.links
          .filter((link) => !isBlankCoHostLinkRow(link))
          .map((link) => ({
            kind: isCoHostLinkKind(link.kind) ? link.kind : DEFAULT_CO_HOST_LINK_KIND,
            url: normalizeCoHostUrl(link.url),
            labelRo: link.labelRo === "" ? null : link.labelRo,
            labelEn: link.labelEn === "" ? null : link.labelEn,
          })),
      })),
  )
  .optional();

/**
 * One link row as posted (§332): kind, address, and both labels; strings, empty allowed — the
 * list decides what a row means. Exported for the editor's ceilings and pattern (§315).
 */
export const eventLinkRowSchema = z
  .object({
    kind: z.string().trim().max(20).optional().default(DEFAULT_EVENT_LINK_KIND),
    url: z.string().trim().max(MAX_EVENT_LINK_URL).optional().default("").meta(HTTPS_BOX),
    labelRo: z.string().trim().max(MAX_EVENT_LINK_LABEL).optional().default(""),
    labelEn: z.string().trim().max(MAX_EVENT_LINK_LABEL).optional().default(""),
  })
  .strict();

type EventLinkRowInput = z.infer<typeof eventLinkRowSchema>;

/** The editor's spare line: nothing typed. The kind alone is not an answer — the select always posts one. */
const isBlankLinkRow = (row: EventLinkRowInput) => row.url === "" && row.labelRo === "" && row.labelEn === "";

/**
 * "Linkuri și fișiere" (§332). Refusals name the row by its posted index (`form-names.ts`). A row
 * with a label but no address, or an unknown kind, is refused. Labels are both languages or neither
 * (§352); with none, the kind's own word is shown. Absent means "not editing the links" (§169).
 */
const eventLinksField = z
  .array(eventLinkRowSchema)
  .max(50)
  .superRefine((rows, ctx) => {
    let filled = 0;
    rows.forEach((row, index) => {
      if (isBlankLinkRow(row)) return;
      filled += 1;
      const n = index + 1;
      if (!isEventLinkKind(row.kind)) {
        ctx.addIssue({ code: "custom", path: [index, "kind"], message: `link ${n}: the kind must be one of the list` });
      }
      if (row.url === "") {
        ctx.addIssue({ code: "custom", path: [index, "url"], message: `link ${n}: a link needs its address, starting with https://` });
      } else if (!isEventLinkUrl(row.url)) {
        ctx.addIssue({ code: "custom", path: [index, "url"], message: `link ${n}: the address must start with https://` });
      }
      refuseOneLanguage(ctx, { ro: row.labelRo, en: row.labelEn }, { ro: [index, "labelRo"], en: [index, "labelEn"] }, `link ${n}: the label`);
    });
    if (filled > MAX_EVENT_LINKS) {
      ctx.addIssue({ code: "custom", message: `at most ${MAX_EVENT_LINKS} links can be listed on one event` });
    }
  })
  .transform((rows): EventLink[] =>
    rows
      .filter((row) => !isBlankLinkRow(row))
      .map((row) => ({
        kind: isEventLinkKind(row.kind) ? row.kind : DEFAULT_EVENT_LINK_KIND,
        url: normalizeEventLinkUrl(row.url),
        labelRo: row.labelRo === "" ? null : row.labelRo,
        labelEn: row.labelEn === "" ? null : row.labelEn,
      })),
  )
  .optional();

/**
 * The event-level fields as the form sends them — every column an organizer owns. Times arrive as
 * wall-clock strings in the event's zone, which is itself a field, so the service converts them.
 * `mapUrl` is checked https here (for the message) and at the database (for seeds and hand-written
 * `UPDATE`s).
 */
export const eventFieldsSchema = z
  .object({
    type: z.enum(EVENT_TYPES),
    // Optional: "" from the unselected dropdown means not stated (§61).
    surface: optionalEnum(EVENT_SURFACES),
    eventStatus: z.enum(["SCHEDULED", "CANCELLED", "COMPLETED"]),
    timezone,
    /**
     * The start as `YYYY-MM-DDTHH:mm`, or from the editor the date alone, `THH:mm` alone, or ""
     * (`admin/actions.ts`). Required unless a «… se anunță mai târziu» switch excuses it (§533,
     * §545); the refusal is `start.ts#resolveStart`'s, where the switches are known.
     */
    startsAtWallTime: z.string().trim().meta({ html: { required: true } }),
    /**
     * An end on the wall clock (still accepted) or a duration in minutes (§71), at most a week. The
     * editor asks hours and minutes and joins them (`duration.ts`, §433).
     */
    endsAtWallTime: z.string().trim().optional().default(""),
    durationMinutes: z
      .string()
      .trim()
      .optional()
      .transform((value) => (value ? value : null))
      .refine((value) => value === null || (/^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 7 * 24 * 60), {
        message: "a duration is a whole number of minutes, up to a week",
      })
      .transform((value) => (value === null ? null : Number(value)))
      .meta({ html: { type: "number", min: 1, max: 7 * 24 * 60, step: 1 } }),
    raceStartsAtWallTime: z.string().trim(),
    /** The programme's rows (§117), at most fifty. */
    scheduleRows: z.array(scheduleRowSchema).max(50).optional().default([]),

    /**
     * The Romanian "Punct de întâlnire" (§36, §362), also written to `events.location_name` for
     * readers without a language. Required unless the place is to be announced (§328): the refusal
     * is `placeRule`'s, and the `html` metadata lets the box declare `required`, which
     * `PlaceToBeAnnounced` lifts while the switch is on.
     */
    locationName: optionalText(200).meta({ html: { required: true } }),
    /**
     * The English "Punct de întâlnire" (§362), always written to the English translation so English
     * pages never borrow Romanian words. Required like the Romanian one; absent means "not editing".
     */
    locationNameEn: optionalText(200).optional().meta({ html: { required: true } }),
    locationAddress: optionalText(300),
    /** "Locația se anunță mai târziu" (§328); absent (an older caller) means announced. */
    locationToBeAnnounced: z.boolean().optional().default(false),
    /**
     * «Data se anunță mai târziu» (§533). Absent means "not editing it" (§451), so a form without
     * the box never announces a held-back date or holds back an announced one.
     */
    dateToBeAnnounced: z.boolean().optional(),
    /** «Ora se anunță mai târziu» (§533): the day is announced, the time not yet. Same discipline. */
    timeToBeAnnounced: z.boolean().optional(),
    /** Closed sets (migration `0018`); "" from an unselected dropdown is "not stated", not an error. */
    difficulty: optionalEnum(DIFFICULTY_BANDS),
    /**
     * «Treapta» within the band (§526), 1 easiest to 3 hardest; with the band, the level of fifteen
     * the save writes (`difficultyLevel`). "", null or absent is the band's middle; outside 1…3 is
     * refused.
     */
    difficultyStep: z
      .union([z.literal(""), z.coerce.number().int().min(1).max(DIFFICULTY_STEPS.length)])
      .nullable()
      .optional()
      .transform((value): DifficultyStep => (value === "" || value === null || value === undefined ? DEFAULT_DIFFICULTY_STEP : (value as DifficultyStep))),
    // §398: absent means "not editing the cost", not "clear it". The service defaults an absent
    // value to `FREE` only on create (`eventColumnsFrom`); a posted "" writes `null`.
    costType: optionalEnum(EVENT_COST_TYPES).optional(),
    /**
     * A paid event's price or a donation's suggested sum (§343), required by `costRule` for `PAID`.
     * Absent means "not editing"; the editor always posts it.
     */
    costAmount: optionalText(MAX_EVENT_COST_AMOUNT).optional(),
    /** Where a paid event is settled or a donation made (§343), https; required by `costRule` for `DONATION`. */
    costUrl: httpsUrl("a cost link must start with https://").optional(),
    mapUrl: httpsUrl("a map link must start with https://"),
    /**
     * «Coordonate» (§416): "latitude, longitude", read for the weather only when the map link has no
     * pin (`weather/domain/place.ts`). Absent keeps the stored pair; "" clears it; otherwise two
     * in-range numbers or a refusal.
     */
    coordinates: z
      .string()
      .trim()
      .max(60)
      .optional()
      .transform((value, ctx) => {
        if (value === undefined) return undefined;
        const pair = parseTypedCoordinates(value);
        if (pair === undefined) {
          ctx.addIssue({ code: "custom", message: "coordinates must be a latitude and a longitude, e.g. 45.6427, 25.5887" });
          return z.NEVER;
        }
        return pair;
      }),
    // Where the run goes, as opposed to where it starts (BR-REQ-011-01 criterion 8). A link, never
    // a file (`AGENTS.md` §17).
    routeUrl: httpsUrl("a route link must start with https://"),
    // The club's Strava group event for this occurrence (criterion 10): a Strava page, or nothing.
    stravaEventUrl: z
      .string()
      .trim()
      .max(2000)
      .optional()
      .transform((value) => (value ? value : null))
      .refine((value) => value === null || (/^https:\/\/\S+$/i.test(value) && isStravaLink(value)), {
        message: "a Strava event link must be an https page on strava.com",
      })
      .meta(HTTPS_BOX),
    // The Facebook event for this occurrence (§144): a Facebook page, or nothing.
    facebookEventUrl: z
      .string()
      .trim()
      .max(2000)
      .optional()
      .transform((value) => (value ? value : null))
      .refine((value) => value === null || (/^https:\/\/\S+$/i.test(value) && isFacebookLink(value)), {
        message: "a Facebook event link must be an https page on facebook.com",
      })
      .meta(HTTPS_BOX),
    // The partners, each a card of links (§168, §344).
    coHosts: coHostsField,
    /**
     * "Linkuri și fișiere" (§332): at most twelve https links, labels both languages or neither
     * (§352). Not required to publish (§28).
     */
    links: eventLinksField,
    /* No `videoUrl` (§481, §491): films live in the description; `.strict()` refuses one. */
    // 500 km is longer than any run the club will hold and shorter than a typo's extra zero.
    distanceMeters: optionalWholeNumber({ min: 0, max: 500_000 }),
    elevationGainMeters: optionalWholeNumber({ min: 0, max: 20_000 }),
    /** "Eveniment de noapte" (§394): true "Da", false "Nu", null "Automat" (`events/domain/night.ts`). */
    nightOverride: z.boolean().nullable().optional().default(null),
    /**
     * The group run's optional self-declaration (§393); absent means none. The service keeps it only
     * on a group run on asphalt or trail (`groupRunDeclarationKeyFor`).
     */
    offersGroupRunDeclaration: z.boolean().optional().default(false),
    featured: z.boolean(),
    /** A special edition (§168): any number may carry it. Absent means an ordinary event. */
    isSpecial: z.boolean().optional().default(false),
    /**
     * «Doar pentru membrii BVR» (§552): the event exists only for a signed-in member and the
     * backoffice. Absent means this caller is not editing it — the partners' discipline — so a
     * fixture or an older form never turns a members' event public by not mentioning it.
     */
    membersOnly: z.boolean().optional(),

    // The database also refuses what this does not: capacity and a declaration only on INTERNAL,
    // the external fields only on EXTERNAL.
    registrationMode: z.enum(["NONE", "INTERNAL", "EXTERNAL"]),
    capacity: optionalWholeNumber({ min: 1, max: 100_000 }),
    /**
     * The waiting list's cap (§348): empty is no limit, 0 is no waiting list; the bounds repeat the
     * database's CHECK (§315). Absent means "not editing", so the service keeps the stored limit.
     */
    waitlistCapacity: optionalWholeNumber({ min: 0, max: 100_000 }).optional(),
    /**
     * «Kit de participare» → «Tricou» (§554): the event gives a T-shirt, so the form asks the size.
     * Absent means this caller is not editing it — the partners' discipline, as «Se deschid în
     * curând» — so a fixture or an older form never switches a shirt off by not mentioning it.
     */
    kitShirt: z.boolean().optional(),
    /**
     * «Condiții de participare» → «Informații medicale» (§557): the form asks the optional health
     * note. Absent means this caller is not editing it, by the kit's discipline (§554).
     */
    askHealthNote: z.boolean().optional(),
    /**
     * The race's own band (§173): where its numbers start, and the colour the sheet prints
     * behind them. The 5 km starts at 100 and prints green; the 10 km starts at 500 and prints
     * blue, and a volunteer sorting envelopes can tell them apart across a table.
     */
    bibStartNumber: wholeNumberWithDefault(1, { min: 1, max: 99_000 }),
    bibColour: z
      .string()
      .trim()
      .regex(/^(#[0-9a-fA-F]{6})?$/, { message: "a colour is six hex digits after a hash, such as #1a73e8" })
      .optional()
      .transform((value) => (value ? value.toLowerCase() : null)),
    /**
     * The rest of the bib design (§249). Absent means "not editing the design", so a form without the
     * panel (the create form) never writes every switch off.
     */
    bibDesign: bibDesignSchema.optional(),
    /**
     * The participation window (§104), in days before the start: when confirmation is asked and when
     * it is due. Absent or empty means the default; opens = 0 switches the window off.
     */
    confirmationOpensDaysBefore: wholeNumberWithDefault(7, { min: 0, max: 60 }),
    confirmationDeadlineDaysBefore: wholeNumberWithDefault(2, { min: 0, max: 60 }),
    /**
     * The minimum age on the event day, in years (§329); absent or empty is fourteen. Never under
     * fourteen (§515); the database CHECK still allows 0–99 (tightening it is a contract step), and
     * an older lower row reads as fourteen (`effectiveMinimumAge`).
     */
    minAge: wholeNumberWithDefault(MIN_PARTICIPANT_AGE, { min: MIN_PARTICIPANT_AGE, max: 99 }),
    /**
     * Hours before the start the reminder goes (§81, §377): empty is "as usual" (the club's
     * «Termene», stored null), 0 is none. Any in-bounds number is accepted, so a scripted value
     * survives a save. Absent means "not editing".
     */
    reminderHoursBefore: optionalWholeNumber({ min: 0, max: EVENT_REMINDER_MAX_HOURS }).optional(),
    registrationOpensAtWallTime: z.string().trim(),
    /** «Înscrierile se deschid în curând» (§451). Absent means "not editing", so no older caller opens a door held shut. */
    registrationOpensSoon: z.boolean().optional(),
    registrationClosesAtWallTime: z.string().trim(),
    declarationDocumentId: optionalUuid,
    /**
     * Whether the page publishes who is coming (BR-REQ-039-01) — an organizer's decision (§28). The
     * service and the database refuse `NAMES` on anything but an INTERNAL event.
     */
    participantListVisibility: z.enum(["HIDDEN", "NAMES"]),
    externalProvider: optionalText(120),
    externalRegistrationUrl: httpsUrl("an external registration link must start with https://"),
  })
  .strict()
  .superRefine(placeRule)
  .superRefine(costRule);

export type EventFieldsInput = z.infer<typeof eventFieldsSchema>;

/**
 * A new event: its fields and both languages from the start, since publication needs every locale
 * (`service.ts#assertReadyToPublish`). Each language is the whole `translationFieldsSchema`, as the
 * create form posts what a save posts; older callers sending only title, slug and excerpt still parse.
 */
export const newEventSchema = eventFieldsSchema.extend({
  translations: z.object({ ro: translationFieldsSchema, en: translationFieldsSchema }),
});

export type NewEventInput = z.infer<typeof newEventSchema>;

/**
 * What "complete" means per language. Deliberately short: requiring unstated facts would push an
 * organizer into inventing them (AGENTS.md §1.2). The per-language meeting point is checked by
 * `service.ts#missingPublicEventFields`, where its switch is known (§36, §328, §362).
 */
export const REQUIRED_PUBLIC_TRANSLATION_FIELDS = ["title", "slug", "excerpt"] as const;

export type RequiredPublicTranslationField = (typeof REQUIRED_PUBLIC_TRANSLATION_FIELDS)[number];

export function missingPublicFields(
  translation: Partial<Record<RequiredPublicTranslationField, string | null>>,
): RequiredPublicTranslationField[] {
  return REQUIRED_PUBLIC_TRANSLATION_FIELDS.filter(
    (field) => (translation[field] ?? "").trim() === "",
  );
}
