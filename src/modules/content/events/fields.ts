import { z } from "zod";
import { EVENT_KINDS } from "@/modules/events/domain/event-kind";

/**
 * Exactly which fields the backoffice may write (BR-REQ-050-01 criterion 1).
 *
 * The CMS boundary is an allowlist, not a convention. Both schemas are `.strict()`, so a form
 * that posts a field nobody meant to expose — `editorial_status`, `version`, an `id` — is
 * rejected rather than silently applied. That matters more than it looks: a Server Action
 * receives whatever the browser sends, and "the form does not render that input" is not a rule
 * the server can rely on.
 *
 * Two things are deliberately absent:
 *
 *   - the body. AGENTS.md §11.3 makes the canonical body validated Tiptap JSON, and no editor
 *     for it exists yet; event bodies stay plain fields until articles arrive with M5 proper.
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

export const translationFieldsSchema = z
  .object({
    slug: z.string().trim().min(1).max(120).regex(SLUG, {
      message: "a slug is lowercase words joined by hyphens",
    }),
    title: z.string().trim().min(1).max(200),
    excerpt: optionalText(500),
    locationName: z.string().trim().min(1).max(200),
    locationAddress: optionalText(300),
    difficultyLabel: optionalText(80),
    costText: optionalText(120),
    seoTitle: optionalText(200),
    seoDescription: optionalText(320),
  })
  .strict();

export type TranslationFields = z.infer<typeof translationFieldsSchema>;

/**
 * A coordinate as typed: decimal degrees, empty when not stated.
 *
 * Not `z.number()`, because the field arrives as a string and an empty one must mean "not
 * stated" rather than 0 — and 0,0 is a real place in the Gulf of Guinea. Both halves are
 * required together; the service and the database each refuse half a pair.
 */
const coordinate = (limit: number) =>
  z
    .string()
    .trim()
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .refine(
      (value) => value === null || (Number.isFinite(Number(value)) && Math.abs(Number(value)) <= limit),
      { message: `must be a number between -${limit} and ${limit}` },
    );

/**
 * A whole number as typed, empty meaning "not stated".
 *
 * The same reasoning as `coordinate`: a distance field left blank means the club has not stated
 * one, and coercing "" to 0 would publish a race of zero kilometres. `min` is 1 rather than 0
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
 * The event-level fields, as the form sends them — every column an organizer owns.
 *
 * The times arrive as wall-clock strings from `<input type="datetime-local">` — "10:00" means
 * ten o'clock in the event's own timezone, and the timezone is itself one of these fields, so
 * the conversion happens in the service where both are known rather than here.
 *
 * The coordinates are the meeting point itself, and the map link is built from them. `mapUrl`
 * is the override for the case they cannot express, and must be https at this layer and again
 * at the database. Neither check is redundant: this one gives the organizer a message, and the
 * constraint is what holds when a value arrives from a seed or a hand-written `UPDATE`.
 */
export const eventFieldsSchema = z
  .object({
    kind: z.enum(EVENT_KINDS),
    eventStatus: z.enum(["SCHEDULED", "CANCELLED", "COMPLETED"]),
    timezone,
    startsAtWallTime: z.string().trim().min(1),
    endsAtWallTime: z.string().trim(),
    raceStartsAtWallTime: z.string().trim(),
    latitude: coordinate(90),
    longitude: coordinate(180),
    mapUrl: httpsUrl("a map link must start with https://"),
    // 500 km is longer than any run the club will hold and shorter than a typo's extra zero.
    distanceMeters: optionalWholeNumber({ min: 0, max: 500_000 }),
    elevationGainMeters: optionalWholeNumber({ min: 0, max: 20_000 }),
    featured: z.boolean(),

    // The registration block. The database refuses the combinations this does not: capacity and
    // a declaration only on an INTERNAL event, the external fields only on an EXTERNAL one.
    registrationMode: z.enum(["NONE", "INTERNAL", "EXTERNAL"]),
    capacity: optionalWholeNumber({ min: 1, max: 100_000 }),
    registrationOpensAtWallTime: z.string().trim(),
    registrationClosesAtWallTime: z.string().trim(),
    declarationDocumentId: optionalUuid,
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
  locationName: true,
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
 * missing title, slug, meeting point or description is a page that reads as half-translated in
 * one of the two languages, which is precisely what publishing both together is for.
 */
export const REQUIRED_PUBLIC_TRANSLATION_FIELDS = [
  "title",
  "slug",
  "locationName",
  "excerpt",
] as const;

export type RequiredPublicTranslationField = (typeof REQUIRED_PUBLIC_TRANSLATION_FIELDS)[number];

export function missingPublicFields(
  translation: Partial<Record<RequiredPublicTranslationField, string | null>>,
): RequiredPublicTranslationField[] {
  return REQUIRED_PUBLIC_TRANSLATION_FIELDS.filter(
    (field) => (translation[field] ?? "").trim() === "",
  );
}
