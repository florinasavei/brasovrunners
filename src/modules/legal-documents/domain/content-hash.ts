import { createHash } from "node:crypto";
import type { Locale } from "@/i18n/routing";

/**
 * The body shape every legal document translation stores (AGENTS.md §12.5): headings and
 * plain paragraphs, deliberately not the CMS's Tiptap JSON (AGENTS.md §11.1, §11.3; §25).
 */
export type LegalDocumentSection = {
  heading?: string;
  paragraphs: readonly string[];
};

export type LegalDocumentBody = {
  sections: readonly LegalDocumentSection[];
};

/** Is a stored `body_json` the shape above? Shared by the page and the PDF, so they agree. */
export function isLegalDocumentBody(value: unknown): value is LegalDocumentBody {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { sections?: unknown }).sections)
  );
}

export type LegalDocumentTranslationInput = {
  locale: Locale;
  title: string;
  body: LegalDocumentBody;
};

/**
 * Deterministic SHA-256 over one version's translations (AGENTS.md §10.8). Locales are sorted
 * and every object rebuilt key-by-key, so input order or an `undefined` versus omitted
 * `heading` never changes the hash.
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
