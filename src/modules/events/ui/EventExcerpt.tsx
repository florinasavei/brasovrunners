import Box from "@mui/material/Box";
import { fromPlainText, hasRichTextContent, readRichText } from "@/modules/content/rich-text/domain/schema";
import RichText from "@/modules/content/rich-text/ui/RichText";

/**
 * The short description, on the hero, the event page and its preview (`DECISIONS.md` §73):
 * the rich excerpt when one was written — a sentence or two and, when the organizer wanted
 * one, a picture — and the plain `excerpt` as one paragraph for events from before it.
 * Nothing at all when there is nothing, so the facts move up rather than under a gap.
 */
export default function EventExcerpt({
  excerptJson,
  excerpt,
}: {
  excerptJson: unknown;
  excerpt: string | null;
}) {
  const doc = excerptJson ? readRichText(excerptJson) : fromPlainText(excerpt);
  if (!hasRichTextContent(doc)) return null;
  return (
    <Box sx={{ color: "text.secondary", mb: 1, "& p:last-of-type": { mb: 2 } }}>
      <RichText body={doc} />
    </Box>
  );
}
