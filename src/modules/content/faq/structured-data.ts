import type { PublicFaqItem } from "./repository";

/**
 * The page's `FAQPage` (§525): the same questions, order and language as the folds a visitor
 * sees, as schema.org requires. Answers as plain words; the page's renderer stays the one place
 * the club's markup is drawn (§11.3). Null with no question: an empty `mainEntity` is invalid.
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
