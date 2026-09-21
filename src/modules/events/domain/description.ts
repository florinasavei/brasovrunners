import { hasRichTextContent, isRichTextEmpty, readRichText } from "@/modules/content/rich-text/domain/schema";

/**
 * Which of an event's two descriptions the page shows, decided once (`DECISIONS.md` §187).
 *
 * The rule in a sentence: **the long description when it has words, the summary otherwise — and
 * then whatever a wordless long description holds**, a picture or a film. One slot, under the
 * title, on the page and in its preview.
 *
 * Pure, and separate from the component, because the interesting part is not the markup: it is
 * that the question takes *two* predicates and reading it with one is what produced the defect
 * this replaces. `hasRichTextContent` asks "is there anything here at all" and counts a picture;
 * `isRichTextEmpty` is defined over the plain text and does not. The page guarded both of its
 * slots with the second, so a long description that was only a picture counted as empty: it was
 * not rendered, and the summary was rendered in its place. An organizer who wrote one saw his
 * summary where his description should have been — "rezumatul apare înainte descrierii full".
 */
export type EventDescriptionPlan = {
  /** The summary stands in, because the long description contributed no words. */
  showsSummary: boolean;
  /** The long description renders — words, or a picture or film with nothing said about it. */
  showsBody: boolean;
};

export function planEventDescription(bodyJson: unknown): EventDescriptionPlan {
  const body = readRichText(bodyJson);
  return {
    showsSummary: isRichTextEmpty(body),
    showsBody: hasRichTextContent(body),
  };
}
