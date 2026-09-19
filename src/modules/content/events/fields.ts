import { z } from "zod";
import { isYoutubeLink } from "@/modules/events/domain/video";
import { isStravaLink } from "@/modules/events/domain/event-type";
import { EMPTY_DOC, parseRichText } from "@/modules/content/rich-text/domain/schema";
import { EVENT_SURFACES, EVENT_TYPES } from "@/modules/events/domain/event-type";

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
    excerpt: optionalText(500),
    /**
     * The short description as the editor posts it (`DECISIONS.md` §73): a small rich body,
     * pictures allowed. When present, the plain `excerpt` is derived from it on save.
     */
    excerptBody: richTextField,
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
    seoTitle: optionalText(200),
    seoDescription: optionalText(320),
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
    .transform((value) => (value === null ? null : Number(value)));

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

const httpsUrl = (message: string) =>
  z
    .string()
    .trim()
    .max(2000)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .refine((value) => value === null || /^https:\/\/\S+$/i.test(value), { message });

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
      .transform((value) => (value === null ? null : Number(value))),
    raceStartsAtWallTime: z.string().trim(),
    /** The programme's rows (§117), at most fifty; absent for a caller from before they existed. */
    scheduleRows: z.array(scheduleRowSchema).max(50).optional().default([]),

    /**
     * The four facts that are the same event in either language (`DECISIONS.md` §36).
     *
     * The meeting point is required here rather than nullable, even though the column accepts
     * null: the column has to tolerate rows written before it existed, and every save from this
     * form fills it. A public event page without a meeting point is missing the one fact a
     * runner actually needs.
     */
    locationName: z.string().trim().min(1).max(200),
    locationAddress: optionalText(300),
    /**
     * Closed sets since migration `0018`, and optional because "the club has not said" is a
     * real answer — `""` from an unselected dropdown means exactly that, not a validation error.
     */
    difficulty: optionalEnum(["EASY", "MODERATE", "HARD"]),
    costType: optionalEnum(["FREE", "PAID"]),
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
      }),
    // The other organization, when there is one (§121): a name, and its page if it has one.
    coHostName: optionalText(200).optional().transform((value) => value ?? null),
    coHostUrl: httpsUrl("the co-host's page must start with https://").optional().transform((value) => value ?? null),
    // Optional in the input as well as in the value — a caller from before the field existed
    // (a script, a duplicate) sends nothing and means "no film".
    videoUrl: z
      .string()
      .trim()
      .max(2000)
      .optional()
      .transform((value) => (value ? value : null))
      .refine((value) => value === null || isYoutubeLink(value), {
        message: "a video link must be a YouTube link (watch, youtu.be, shorts or embed)",
      }),
    // 500 km is longer than any run the club will hold and shorter than a typo's extra zero.
    distanceMeters: optionalWholeNumber({ min: 0, max: 500_000 }),
    elevationGainMeters: optionalWholeNumber({ min: 0, max: 20_000 }),
    featured: z.boolean(),

    // The registration block. The database refuses the combinations this does not: capacity and
    // a declaration only on an INTERNAL event, the external fields only on an EXTERNAL one.
    registrationMode: z.enum(["NONE", "INTERNAL", "EXTERNAL"]),
    capacity: optionalWholeNumber({ min: 1, max: 100_000 }),
    /**
     * The participation window (§104), in days before the start: when the confirmation is
     * asked and when it is owed. Absent (an older form, a test fixture) means the defaults; an
     * empty box means the default too. Zero "opens" switches the window off.
     */
    confirmationOpensDaysBefore: wholeNumberWithDefault(7, { min: 0, max: 60 }),
    confirmationDeadlineDaysBefore: wholeNumberWithDefault(2, { min: 0, max: 60 }),
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
  .strict();

export type EventFieldsInput = z.infer<typeof eventFieldsSchema>;

/**
 * What a new event needs before it exists: its own fields, and the minimum of both languages.
 *
 * Both locales from the start, rather than "Romanian now, English later". Publication requires
 * a complete translation in every locale (`service.ts#assertReadyToPublish`), and an event that
 * cannot be created without one row per locale is an event whose second language is a fill-in
 * rather than an afterthought that never happens.
 */
const newTranslationSchema = translationFieldsSchema.pick({
  slug: true,
  title: true,
  excerpt: true,
});

export const newEventSchema = eventFieldsSchema.extend({
  translations: z.object({ ro: newTranslationSchema, en: newTranslationSchema }),
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
