import { z } from "zod";
import { routing } from "@/i18n/routing";

/**
 * What an organizer types into the page editor (BR-REQ-050-03).
 *
 * The body arrives as **text**, not as the structured JSON the column stores: the editor is a
 * textarea and `legal-documents/domain/body-text.ts` converts in both directions. That module is
 * reused rather than copied, and reused rather than generalised — `AGENTS.md` §1.5 abstracts on
 * the third occurrence, and this is the second.
 */

/** Lowercase, digits and hyphens. What a URL can carry without escaping and a person can read. */
const slug = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "a page address may use only lowercase letters, digits and hyphens");

/**
 * Reserved first segments, refused as page slugs.
 *
 * A page at `/pagini/admin` would not collide with the backoffice — different prefix — but it
 * reads as one, and a visitor who lands there having typed a path from memory is owed a 404
 * rather than a club page pretending to be a system route.
 */
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
  /** Free text in the blank-line/`## ` format. Empty is allowed: a page may be drafted title-first. */
  body: z.string().max(50_000),
  seoTitle: optionalText(200),
  seoDescription: optionalText(400),
});

export type PageTranslationInput = z.infer<typeof pageTranslationSchema>;

/**
 * Both languages, always, in one object.
 *
 * Publication is one state for the whole page and requires every locale to be complete
 * (`AGENTS.md` §11.2), so the editor asks for both from the beginning rather than letting a page
 * exist in one language and discover the rule at the moment somebody tries to publish it.
 */
export const pageFieldsSchema = z.object({
  navOrder: z
    .string()
    .trim()
    .transform((value) => (value === "" ? 0 : Number(value)))
    .pipe(z.number().int().min(0).max(1000)),
  translations: z.object(
    Object.fromEntries(routing.locales.map((locale) => [locale, pageTranslationSchema])) as Record<
      (typeof routing.locales)[number],
      typeof pageTranslationSchema
    >,
  ),
});

export type PageFieldsInput = z.infer<typeof pageFieldsSchema>;
