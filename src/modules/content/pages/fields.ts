import { z } from "zod";
import { EMPTY_DOC, parseRichText } from "@/modules/content/rich-text/domain/schema";
import { routing } from "@/i18n/routing";
import { refuseOneLanguage } from "@/shared/forms/both-languages";

/** What an organizer types into the page editor (BR-REQ-050-03). */

/** Lowercase, digits and hyphens: readable and needs no escaping. */
const slug = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "a page address may use only lowercase letters, digits and hyphens");

/** Reserved first segments: a page there would read as a system route. */
const RESERVED_SLUGS = new Set(["admin", "api", "devs", "preview", "previzualizare", "new"]);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === "" ? null : value));

export const pageTranslationSchema = z.object({
  slug: slug.refine((value) => !RESERVED_SLUGS.has(value), "this page address is reserved"),
  title: z.string().trim().min(1).max(200),
  /**
   * The editor's JSON string, parsed here so a bad body is a field error rather than an exception
   * mid-transaction (`AGENTS.md` §11.3). The cap is on the JSON (ProseMirror adds ~40 characters
   * per paragraph); empty is allowed in a draft.
   */
  body: z
    .string()
    .max(200_000)
    .transform((value, ctx) => {
      // Publication refuses an empty body and names the language (§11.2).
      if (value.trim() === "") return EMPTY_DOC;
      try {
        return parseRichText(JSON.parse(value));
      } catch {
        ctx.addIssue({ code: "custom", message: "the body is not a valid document" });
        return z.NEVER;
      }
    }),
  seoTitle: optionalText(200),
  seoDescription: optionalText(400),
});

export type PageTranslationInput = z.infer<typeof pageTranslationSchema>;

/**
 * Both languages in one object: publication requires every locale (`AGENTS.md` §11.2). The SEO
 * texts are optional but both languages or neither, refused on the empty box (§354, §315).
 */
export const pageFieldsSchema = z.object({
  // No «Ordinea în meniu» box since §571: the page's place is «Ordinea meniului»'s, one order for
  // every entry of the menu. A posted `navOrder` is ignored (Zod drops keys it does not name).
  translations: z
    .object(
      Object.fromEntries(routing.locales.map((locale) => [locale, pageTranslationSchema])) as Record<
        (typeof routing.locales)[number],
        typeof pageTranslationSchema
      >,
    )
    .superRefine((translations, ctx) => {
      for (const field of ["seoTitle", "seoDescription"] as const) {
        refuseOneLanguage(
          ctx,
          { ro: translations.ro[field], en: translations.en[field] },
          { ro: ["ro", field], en: ["en", field] },
          `the page's ${field === "seoTitle" ? "search-engine title" : "search-engine description"}`,
        );
      }
    }),
});

export type PageFieldsInput = z.infer<typeof pageFieldsSchema>;
