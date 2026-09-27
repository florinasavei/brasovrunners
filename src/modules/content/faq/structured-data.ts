import type { PublicFaqItem } from "./repository";

/**
 * The page's `FAQPage` (§NNN, schema.org): every question on it as a `Question` whose
 * `acceptedAnswer` is an `Answer` with the answer's words — the same questions, in the same order
 * and the same language, as the folds a visitor opens, which is what a search engine asks of it
 * (the markup must describe what the page shows). Plain words rather than the answer's markup:
 * `text` may carry a few HTML tags, but words are what every reader of it understands, and the
 * page's own renderer stays the one place the club's markup is drawn (§11.3).
 *
 * Null for a page with no question: an empty `mainEntity` is not an `FAQPage`.
 */
export function faqPageJsonLd(items: readonly PublicFaqItem[], url: string, inLanguage: string): Record<string, unknown> | null {
  if (items.length === 0) return null;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    url,
    inLanguage,
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answerText },
    })),
  };
}
