import { z } from "zod";

/**
 * Exactly which fields the backoffice may write (BR-REQ-050-01 criterion 1).
 *
 * The CMS boundary is an allowlist, not a convention. Both schemas are `.strict()`, so a form
 * that posts a field nobody meant to expose — `editorial_status`, `version`, `capacity`, an
 * `id` — is rejected rather than silently applied. That matters more than it looks: a Server
 * Action receives whatever the browser sends, and "the form does not render that input" is not
 * a rule the server can rely on.
 *
 * Three things are deliberately absent:
 *
 *   - the body. AGENTS.md §11.3 makes the canonical body validated Tiptap JSON, and no editor
 *     for it exists yet; event bodies stay plain fields until articles arrive with M5 proper.
 *   - legal text. §11.1 puts the privacy notice, the terms and the declaration outside the
 *     CMS entirely. There is no screen for them here in any form.
 *   - capacity. The database refuses a non-null capacity for the whole pilot, and a form field
 *     that always fails is worse than no field.
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
 * The event-level fields, as the form sends them.
 *
 * The two times arrive as wall-clock strings from `<input type="datetime-local">` — "10:00"
 * means ten o'clock in the event's own timezone, and only the service knows which timezone
 * that is, so the conversion happens there rather than here.
 *
 * The coordinates are the meeting point itself, and the map link is built from them. `mapUrl`
 * is the override for the case they cannot express, and must be https at this layer and again
 * at the database. Neither check is redundant: this one gives the organizer a message, and the
 * constraint is what holds when a value arrives from a seed or a hand-written `UPDATE`.
 */
export const eventFieldsSchema = z
  .object({
    startsAtWallTime: z.string().trim().min(1),
    raceStartsAtWallTime: z.string().trim(),
    latitude: coordinate(90),
    longitude: coordinate(180),
    mapUrl: z
      .string()
      .trim()
      .transform((value) => (value === "" ? null : value))
      .nullable()
      .refine((value) => value === null || /^https:\/\/\S+$/i.test(value), {
        message: "a map link must start with https://",
      }),
    featured: z.boolean(),
  })
  .strict();

export type EventFieldsInput = z.infer<typeof eventFieldsSchema>;
