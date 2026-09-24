import { z } from "zod";
import { routing } from "@/i18n/routing";
import { refuseOneLanguage } from "@/shared/forms/both-languages";

/**
 * Exactly which fields the backoffice may write on an album (BR-REQ-054-01).
 *
 * The same allowlist shape as pages and events: `.strict()` objects, "" meaning "not stated",
 * one translation per locale required from the first save so a second language is never an
 * afterthought. Photos are not fields — they arrive through the uploader, one request each.
 */

const slug = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "an album address may use only lowercase letters, digits and hyphens");

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === "" ? null : value));

export const albumTranslationSchema = z
  .object({
    slug,
    title: z.string().trim().min(1).max(200),
    description: optionalText(1000),
  })
  .strict();

export const albumFieldsSchema = z
  .object({
    /** `YYYY-MM-DD` from a date input: when the photos were taken. */
    takenOn: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "the date must be a calendar date")
      .transform((value) => new Date(`${value}T12:00:00Z`)),
    /** An event to link back to, or "" for none. */
    eventId: z
      .string()
      .trim()
      .transform((value) => (value === "" ? null : value))
      .refine(
        (value) => value === null || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),
        "the event must be chosen from the list",
      ),
    /*
      Both languages in one save — and the description, optional, is both or neither (§NNN,
      bilingual everywhere): one language written and the other empty is refused on the empty
      box, the rest kept (§315), so the English album page never goes without the words the
      Romanian one carries.
    */
    translations: z
      .object(
        Object.fromEntries(routing.locales.map((locale) => [locale, albumTranslationSchema])) as Record<
          (typeof routing.locales)[number],
          typeof albumTranslationSchema
        >,
      )
      .superRefine((translations, ctx) => {
        refuseOneLanguage(
          ctx,
          { ro: translations.ro.description, en: translations.en.description },
          { ro: ["ro", "description"], en: ["en", "description"] },
          "the album's description",
        );
      }),
  })
  .strict();

export type AlbumFieldsInput = z.infer<typeof albumFieldsSchema>;
