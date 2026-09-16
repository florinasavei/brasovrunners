import { createHash } from "node:crypto";
import type { Locale } from "@/i18n/routing";

/**
 * The body shape every legal document translation stores (AGENTS.md §12.5).
 *
 * Deliberately simpler than the CMS body contract of §11.3 — validated Tiptap JSON with an
 * allowlisted schema — because that contract does not exist yet (DECISIONS.md §25) and there
 * is no editor for legal text to feed one anyway: §12.5 and §11.1 forbid a CMS screen from
 * ever editing it. A heading-and-paragraphs shape is exactly expressive enough for a privacy
 * notice or a declaration and needs no rich-text schema to render safely.
 */
export type LegalDocumentSection = {
  heading?: string;
  paragraphs: readonly string[];
};

export type LegalDocumentBody = {
  sections: readonly LegalDocumentSection[];
};

export type LegalDocumentTranslationInput = {
  locale: Locale;
  title: string;
  body: LegalDocumentBody;
};

/**
 * Deterministic SHA-256 over the canonical serialization of one version's translations
 * (AGENTS.md §10.8: "deterministic content SHA-256 over canonical serialized JSON").
 *
 * "Canonical" covers the one thing `JSON.stringify` does not do on its own: fix the order.
 * Locales are sorted, and every object below is rebuilt key-by-key in a stated order, so two
 * translations entered in a different order — or a section's `heading` present as `undefined`
 * versus omitted — hash identically. A hash that depended on incidental object-construction
 * order would make "this version's content changed" indistinguishable from "someone re-typed
 * the same words in a different order in a migration."
 */
export function computeContentHash(translations: readonly LegalDocumentTranslationInput[]): string {
  const canonical = [...translations]
    .sort((a, b) => a.locale.localeCompare(b.locale))
    .map((translation) => ({
      locale: translation.locale,
      title: translation.title,
      body: {
        sections: translation.body.sections.map((section) => ({
          heading: section.heading ?? null,
          paragraphs: [...section.paragraphs],
        })),
      },
    }));

  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
