import { z } from "zod";
import { bibDesignSchema } from "@/modules/registrations/bib-design";
import { MIN_PARTICIPANT_AGE } from "@/modules/registrations/domain/age";
import { isYoutubeLink } from "@/modules/events/domain/video";
import { isFacebookLink, isStravaLink } from "@/modules/events/domain/event-type";
import { EMPTY_DOC, parseRichText } from "@/modules/content/rich-text/domain/schema";
import { EVENT_SURFACES, EVENT_TYPES } from "@/modules/events/domain/event-type";
import {
  type CoHost,
  DEFAULT_CO_HOST_LINK_KIND,
  isCoHostLinkKind,
  isCoHostUrl,
  MAX_CO_HOST_LINK_LABEL,
  MAX_CO_HOST_LINK_URL,
  MAX_CO_HOST_LINKS,
  MAX_CO_HOSTS,
  normalizeCoHostUrl,
} from "@/modules/events/domain/co-hosts";
import { EVENT_COST_TYPES, type EventCostType, MAX_EVENT_COST_AMOUNT } from "@/modules/events/domain/cost";
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
 * Exactly which fields the backoffice may write (BR-REQ-050-01 criterion 1).
 *
 * The CMS boundary is an allowlist, not a convention. Both schemas are `.strict()`, so a form
 * that posts a field nobody meant to expose — `editorial_status`, `version`, an `id` — is
 * rejected rather than silently applied. That matters more than it looks: a Server Action
 * receives whatever the browser sends, and "the form does not render that input" is not a rule
 * the server can rely on.
 *
 * One thing is deliberately absent:
 *
 *   - legal text. §11.1 puts the privacy notice, the terms and the declaration outside the
 *     CMS entirely. There is no screen for them here in any form. `declarationDocumentId`
 *     below *selects* an approved version; it cannot write a word of one.
 *
 * Capacity used to be absent too, because the database refused any value for the whole pilot
 * and a form field that always fails is worse than no field. That guard is gone
 * (`DECISIONS.md` §26), and the whole registration block is editable here now.
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
 * A closed set the club may also decline to answer.
 *
 * Same shape as `optionalText`: an empty string and null both mean "not stated", and anything
 * else must be one of the listed values. Deliberately not `.catch(null)` — a value outside the
 * set did not come from the dropdown that posts this field, and turning it silently into "not
 * stated" would hide that rather than refuse it.
 */
const optionalEnum = <const T extends readonly [string, ...string[]]>(values: T) =>
  z
    .union([z.enum(values), z.literal("")])
    .nullable()
    .transform((value) => (value === "" ? null : value));

/**
 * A JSON string from `RichTextEditor`, parsed against the allowlist so a bad body is a field
 * error; empty allowed. Optional in the input for callers from before it existed.
 */
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
     * The plain short description. Optional in the input like `checklist` below — the create
     * form posts the rich summary and nothing else for it, and an absent key means "leave it as
     * it is" on a save and "the column's default" on an insert; the form always posts it.
     */
    excerpt: optionalText(500).optional(),
    /**
     * The short description as the editor posts it (`DECISIONS.md` §73): a small rich body,
     * pictures allowed. When present, the plain `excerpt` is derived from it on save.
     */
    excerptBody: richTextField,
    /**
     * The place's name in this language — "Tractorul Park" on the English page — or nothing,
     * which means the event's own `locationName` (the meeting point is still one fact, asked
     * once in "Când și unde"; only its *name* is a translation now, on the owner's word). Optional
     * in the input for callers from before it existed: absent means "leave it as it is".
     */
    locationName: optionalText(200).optional(),
    /**
     * "What to bring", one line for the confirmation and the reminder (§81). Optional in the
     * input for callers from before it existed; absent means "leave it as it is".
     */
    checklist: optionalText(300).optional(),
    /**
     * The description proper, written in the rich-text editor (AGENTS.md §11.3; `DECISIONS.md`
     * §71: "all descriptions should be WYSIWYG"). The same contract as a standing page's body:
     * a JSON string from `RichTextEditor`, parsed against the allowlist here so a bad body is
     * a field error, empty allowed. Optional in the input for callers from before it existed.
     */
    body: richTextField,
    /** The rules, the same contract as the body (§96); empty allowed. */
    rules: richTextField,
    /** The programme — kit pickup, briefing, start, cut-offs (§96); empty allowed. */
    schedule: richTextField,
    // Optional in the input like `excerpt`: the form posts them, an older caller may not.
    seoTitle: optionalText(200).optional(),
    seoDescription: optionalText(320).optional(),
  })
  .strict();

export type TranslationFields = z.infer<typeof translationFieldsSchema>;

/**
 * A whole number as typed, empty meaning "not stated".
 *
 * Not `z.number()`, because the field arrives as a string and an empty one must mean "not
 * stated" rather than 0: a distance field left blank means the club has not stated one, and
 * coercing "" to 0 would publish a race of zero kilometres. `min` is 1 rather than 0
 * for capacity — the database refuses a non-positive capacity, and "nobody may enter" is what
 * `registration_mode = NONE` says honestly.
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
    // The bounds live in the refine above, where `shared/forms/constraints.ts` cannot read
    // them; said once more here, on the schema itself, so the box carries `min`, `max` and
    // `step` and the browser refuses "0 places" before the server does (§315).
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
 * What the box for an https link carries, so the browser refuses `http://` and `www.` first (§315).
 * Case-insensitive by hand, like the server's refine (`/^https:\/\/\S+$/i`): an HTML `pattern` is
 * case-sensitive, and "HTTPS://…" must not be refused in the browser and accepted by the server —
 * the browser never refuses what the server accepts. Found by the third review.
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
 * An IANA zone name, checked by asking the platform rather than by carrying a list.
 *
 * `Intl.DateTimeFormat` throws `RangeError` for a name it does not know, and it is the same
 * implementation `zoned-time.ts` uses to convert the wall-clock inputs below — so a name that
 * passes here is a name the conversion can honour. A free-text timezone that Node accepts and
 * the browser does not would silently shift every time on the page.
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
 * One programme row as the editor posts it (`DECISIONS.md` §117): a date and a 24-hour time,
 * an optional end time on the same day, the label in both languages, a place. Everything a
 * string, empty allowed here — a row left blank is dropped by the service, and a half-filled
 * one is refused there with the row's number, once the timezone is known to place it.
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
 * A meeting point, unless the place is to be announced (§328).
 *
 * On the object because it reads two fields, and named on `locationName` so the refusal
 * summary links to the box (§47). With the switch off it is exactly the rule the field used to
 * carry on its own (`min(1)`, §36); with it on, a blank place is accepted and a typed one kept.
 */
function placeRule(fields: { locationName: string | null; locationToBeAnnounced: boolean }, ctx: z.RefinementCtx): void {
  if (fields.locationToBeAnnounced || fields.locationName !== null) return;
  ctx.addIssue({
    code: "custom",
    path: ["locationName"],
    message: "a meeting point is required, unless the place is to be announced later",
  });
}

/**
 * What each cost kind needs, and only that (`DECISIONS.md` §343): a paid event has to say how
 * much, a donation has to say where. Named on the box the kind actually requires, so the
 * refusal summary links the right one (§315) — the same shape as `placeRule` above. Absent
 * (`undefined`) means this caller is not editing the cost fields at all, the discipline `links`
 * and `bibDesign` follow, and is never a reason to refuse: only a caller that *is* editing them
 * and left the required one blank is refused.
 */
function costRule(
  fields: { costType: EventCostType | null; costAmount?: string | null; costUrl?: string | null },
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
 * One partner's link row as the editor posts it (§344): a kind from the select, the address,
 * and a label in each language — the same four boxes `eventLinkRowSchema` carries for
 * "Linkuri și fișiere" (§332), one card of them per partner rather than one list for the event.
 * Exported so the editor reads the boxes' ceilings and the address's https pattern off it
 * (§315) rather than typing them a second time.
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
 * One partner's card as the editor posts it (§344): a name, and its links. A row with nothing
 * typed in either — the editor's spare card — is dropped, like a spare link row is; a name with
 * no links is kept, since a partner's page is optional (§168) and always has been.
 */
const coHostRowSchema = z
  .object({
    name: z.string().trim().max(200).optional().default(""),
    links: z.array(coHostLinkRowSchema).max(MAX_CO_HOST_LINKS + 4).optional().default([]),
  })
  .strict();

type CoHostRowInput = z.infer<typeof coHostRowSchema>;

const isBlankCoHostRow = (row: CoHostRowInput) => row.name === "" && row.links.every(isBlankCoHostLinkRow);

/**
 * The partners, as the editor posts them (§168, extended by §344 into a card of links each).
 *
 * Every refusal names the partner **and** the link, both as the editor numbered them — the
 * posted index, before the spare lines are dropped — so "Partenerul 2, linkul 3" is the second
 * card and its third link row on the screen, and the summary's link lands on that exact box
 * (`form-names.ts`). A card with a link and no name is refused rather than dropped: somebody
 * meant a partner there. A link with a label and no address is refused the same way a plain
 * event link is (§332); a kind outside the set did not come from the select and is refused,
 * never quietly turned into "other".
 *
 * Absent means "this caller is not editing the partners" and **not** "no partners" (§169): a
 * caller from before the list existed (a script, a fixture, a test's form) posts nothing, and a
 * column nobody mentioned is a column nobody may erase. The editor always posts the cards, so
 * an empty list from it is the club having removed every partner and is written as `[]`.
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
      let filledLinks = 0;
      row.links.forEach((link, linkIndex) => {
        if (isBlankCoHostLinkRow(link)) return;
        filledLinks += 1;
        const l = linkIndex + 1;
        if (!isCoHostLinkKind(link.kind)) {
          ctx.addIssue({ code: "custom", path: [index, "links", linkIndex, "kind"], message: `partner ${p}, link ${l}: the kind must be one of the list` });
        }
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
 * One link row as the editor posts it (`DECISIONS.md` §332): a kind from the select, the
 * address, and a label in each language. Every box a string, empty allowed here; the list
 * below decides what a row means. Exported so the editor reads the boxes' ceilings and the
 * address's https pattern off it (§315) rather than typing them a second time.
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
 * The links, as the editor posts them — "Linkuri și fișiere" (§332).
 *
 * Every refusal names the row **as the editor numbered it** — the posted index, before the
 * spare lines are dropped — so "link 2" is the second row on the screen and the summary's link
 * lands on its box (`form-names.ts`). A row with a label and no address is refused rather than
 * dropped: somebody meant a link there. A kind outside the set did not come from the select and
 * is refused, never quietly turned into "other".
 *
 * Absent means "this caller is not editing the links" — the discipline of `coHosts` (§169) — so
 * a fixture or an older caller leaves the column as it was. The editor always posts the list;
 * an empty one is "no links".
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
 * The event-level fields, as the form sends them — every column an organizer owns.
 *
 * The times arrive as wall-clock strings from `<input type="datetime-local">` — "10:00" means
 * ten o'clock in the event's own timezone, and the timezone is itself one of these fields, so
 * the conversion happens in the service where both are known rather than here.
 *
 * `mapUrl` is the meeting point on a map, pasted by the organizer, and must be https at this
 * layer and again at the database. Neither check is redundant: this one gives the organizer a
 * message, and the constraint is what holds when a value arrives from a seed or a hand-written
 * `UPDATE`.
 */
export const eventFieldsSchema = z
  .object({
    type: z.enum(EVENT_TYPES),
    // Optional: a meetup is run on nothing, and "" from the unselected dropdown means exactly
    // that (`DECISIONS.md` §61).
    surface: optionalEnum(EVENT_SURFACES),
    eventStatus: z.enum(["SCHEDULED", "CANCELLED", "COMPLETED"]),
    timezone,
    startsAtWallTime: z.string().trim().min(1),
    /**
     * Either an end on the wall clock (the old field, still accepted) or a duration in minutes
     * (`DECISIONS.md` §71: "instead of an end date I should just have a duration"). A week is
     * the ceiling; a typo's extra digit is refused, a multi-day camp is not.
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
    /** The programme's rows (§117), at most fifty; absent for a caller from before they existed. */
    scheduleRows: z.array(scheduleRowSchema).max(50).optional().default([]),

    /**
     * The four facts that are the same event in either language (`DECISIONS.md` §36).
     *
     * The meeting point is required, even though the column accepts null: the column has to
     * tolerate rows written before it existed, and a public event page without a meeting point
     * is missing the one fact a runner actually needs — **unless the place is to be announced**
     * (`locationToBeAnnounced` below, §328), when blank is the honest answer and whatever was
     * typed is kept without being shown.
     *
     * So the refusal is the object's (`placeRule`, at the foot of this schema), which is the one
     * place both fields are known; the box still declares itself required, through the `html`
     * metadata a rule the walker cannot see uses (`shared/forms/constraints.ts`), and the editor
     * drops that `required` while the switch is on (`PlaceToBeAnnounced`). One rule, read in both
     * places: the browser refuses a blank place exactly when the server would.
     */
    locationName: optionalText(200).meta({ html: { required: true } }),
    locationAddress: optionalText(300),
    /**
     * "Locația se anunță mai târziu" (§328): the place is not announced yet. A switch, so absent
     * — an older caller, a fixture — is "announced", like `isSpecial`: every row before it was.
     */
    locationToBeAnnounced: z.boolean().optional().default(false),
    /**
     * Closed sets since migration `0018`, and optional because "the club has not said" is a
     * real answer — `""` from an unselected dropdown means exactly that, not a validation error.
     */
    difficulty: optionalEnum(["EASY", "MODERATE", "HARD"]),
    costType: optionalEnum(EVENT_COST_TYPES),
    /**
     * What a paid event costs, or what a donation suggests (§343): free text, at most 60
     * characters, required by `costRule` below when `costType` is `PAID`. Optional in the input
     * — absent means this caller is not editing the cost fields, the discipline `links` and
     * `bibDesign` follow — but the editor always posts it, so a blank box while `PAID` is chosen
     * is refused there, not silently accepted.
     */
    costAmount: optionalText(MAX_EVENT_COST_AMOUNT).optional(),
    /**
     * Where a paid event is settled, or where a donation is made (§343): https, like every other
     * pasted link. Required by `costRule` below when `costType` is `DONATION`; optional on
     * `PAID`. Same absent-means-not-editing discipline as `costAmount`.
     */
    costUrl: httpsUrl("a cost link must start with https://").optional(),
    mapUrl: httpsUrl("a map link must start with https://"),
    // Where the run goes, as opposed to where it starts (BR-REQ-011-01 criterion 8). A link
    // and never a file: media storage is deferred (`AGENTS.md` §17).
    routeUrl: httpsUrl("a route link must start with https://"),
    // A film of the event (criterion 9): a YouTube link, or nothing. Checked for a video id
    // here so the page never meets a link it cannot embed.
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
    // The organizations the event is held with, each a card of its own links (§168, §344) —
    // what `coHostsField` above decides, name and all.
    coHosts: coHostsField,
    /**
     * "Linkuri și fișiere" (§332): the GPX on Google Drive, a PDF, the album, the results — at
     * most twelve, each https, each label optional. Not part of what publication requires (§28):
     * an empty label is the kind's own word in the reader's language.
     */
    links: eventLinksField,
    /**
     * A film of the event: a YouTube link, or nothing. The editor no longer has a box for it —
     * a film goes into the description with the rich text's own YouTube button (§266), sized
     * and placed like a picture — so no form posts this any more. The column stays for the
     * events that carry one and the public page still embeds it; **absent means "not editing
     * the film"**, the discipline `coHosts` and `bibDesign` follow, so a save from the editor
     * leaves a stored link exactly as it was. Only `""` clears it, and only a link a video id
     * can be read from is stored.
     */
    videoUrl: z
      .string()
      .trim()
      .max(2000)
      .optional()
      .transform((value) => (value === undefined ? undefined : value ? value : null))
      .refine((value) => value === undefined || value === null || isYoutubeLink(value), {
        message: "a video link must be a YouTube link (watch, youtu.be, shorts or embed)",
      }),
    // 500 km is longer than any run the club will hold and shorter than a typo's extra zero.
    distanceMeters: optionalWholeNumber({ min: 0, max: 500_000 }),
    elevationGainMeters: optionalWholeNumber({ min: 0, max: 20_000 }),
    featured: z.boolean(),
    /**
     * A special edition (§168): any number of events may carry it, so there is nothing to
     * clear and no index to collide with. Optional for a caller from before it existed, which
     * means an ordinary event.
     */
    isSpecial: z.boolean().optional().default(false),

    // The registration block. The database refuses the combinations this does not: capacity and
    // a declaration only on an INTERNAL event, the external fields only on an EXTERNAL one.
    registrationMode: z.enum(["NONE", "INTERNAL", "EXTERNAL"]),
    capacity: optionalWholeNumber({ min: 1, max: 100_000 }),
    /**
     * How long the waiting list may grow (§348): empty is no limit, zero is no waiting list at
     * all, and the bounds are the database's CHECK said again so the box carries `min` (§315).
     * Optional, and absent means "this caller is not editing it" — the service writes nothing
     * then, so a save from anything that does not post the box keeps the limit the organizer set.
     */
    waitlistCapacity: optionalWholeNumber({ min: 0, max: 100_000 }).optional(),
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
     * The rest of the bib's design (§249): what is printed, the number's size, where the name
     * sits, the two pictures, the cut marks.
     *
     * **Optional, and absent means "this caller is not editing the design"** — the same
     * discipline the partners' rows follow. The create form does not render the panel, and a
     * missing key there must leave an event on the platform's design rather than writing every
     * switch off.
     */
    bibDesign: bibDesignSchema.optional(),
    /**
     * The participation window (§104), in days before the start: when the confirmation is
     * asked and when it is owed. Absent (an older form, a test fixture) means the defaults; an
     * empty box means the default too. Zero "opens" switches the window off.
     */
    confirmationOpensDaysBefore: wholeNumberWithDefault(7, { min: 0, max: 60 }),
    confirmationDeadlineDaysBefore: wholeNumberWithDefault(2, { min: 0, max: 60 }),
    /**
     * The youngest a participant may be on the day of the event, in years (§329, amending §321:
     * "actually this min age must be set at event level!"). Absent or empty means the club's
     * fourteen, which is also the column's default; zero means no minimum. The bounds are the
     * database's CHECK, said again here so the box carries them (§315).
     */
    minAge: wholeNumberWithDefault(MIN_PARTICIPANT_AGE, { min: 0, max: 99 }),
    registrationOpensAtWallTime: z.string().trim(),
    registrationClosesAtWallTime: z.string().trim(),
    declarationDocumentId: optionalUuid,
    /**
     * Whether the event page publishes who is coming (BR-REQ-039-01).
     *
     * In the allowlist deliberately: it is an organizer's decision about the club's own event,
     * and the alternative — a developer setting a column — is exactly what `DECISIONS.md` §28
     * removed. The service refuses `NAMES` on anything but an INTERNAL event, and so does the
     * database.
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
 * What a new event needs before it exists: its own fields, and both languages.
 *
 * Both locales from the start, rather than "Romanian now, English later". Publication requires
 * a complete translation in every locale (`service.ts#assertReadyToPublish`), and an event that
 * cannot be created without one row per locale is an event whose second language is a fill-in
 * rather than an afterthought that never happens.
 *
 * Each language is the **whole** `translationFieldsSchema`, not a title-slug-excerpt pick: the
 * create form renders the editor's own language panel (the rich summary, the description, the
 * rules, the folds), so what it posts is what a save posts, and the service writes it through
 * the same function. A caller that still sends only the three (a script, an older test) parses
 * all the same — every other field is optional in the input.
 */
export const newEventSchema = eventFieldsSchema.extend({
  translations: z.object({ ro: translationFieldsSchema, en: translationFieldsSchema }),
});

export type NewEventInput = z.infer<typeof newEventSchema>;

/**
 * The fields a public page shows in every language, and therefore what "complete" means.
 *
 * Deliberately short. A missing address, difficulty, cost or SEO override is a fact the club has
 * not stated, and requiring one would push an organizer into inventing it — AGENTS.md §1.2. A
 * missing title, slug or description is a page that reads as half-translated in one of the two
 * languages, which is precisely what publishing both together is for.
 *
 * The meeting point left this list when it left the table (`DECISIONS.md` §36): it is one value
 * for the whole event now, so "is it complete" is a question about the event rather than about
 * each language, and `service.ts#missingPublicEventFields` is where it is asked.
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
