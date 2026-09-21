import Box from "@mui/material/Box";
import { fromPlainText, hasRichTextContent, readRichText } from "@/modules/content/rich-text/domain/schema";
import RichText from "@/modules/content/rich-text/ui/RichText";

/**
 * Where the short description is read: the event page and the hero give it the column, a
 * listing card gives it a card's worth of room.
 */
export type ExcerptPlace = "page" | "card";

/** The excerpt as the page and the hero render it: the body's own type, the column's width. */
export const PAGE_EXCERPT_SX = {
  color: "text.secondary",
  mb: 1,
  "& p:last-of-type": { mb: 2 },
} as const;

/**
 * The same document on a listing card (`DECISIONS.md` §73; the owner: "pictures should be
 * shown in the short description as well").
 *
 * The cards rendered `excerpt` — the plain-text shadow of the document — so a picture written
 * into a short description appeared on the event page and vanished from the card that sends
 * people there. Rendering the document itself brings it back, and brings three of the editor's
 * choices with it, none of which means anything in a card:
 *
 * - **The column share.** 100, 75, 50 or 33 percent is a decision about the text column of an
 *   event page. A card is one narrow column, so the figure takes all of it, always.
 * - **The height.** A portrait photograph at full width is taller than the whole card, which
 *   would push the date, the place and "see details" below the fold on a phone. It is capped
 *   and cropped from the centre instead — a card's picture is an invitation, not the picture.
 * - **The float.** A picture set to sit left or right of the text on an event page (2026-09-20)
 *   is a decision about a column wide enough to have a side. A card has one column of its own
 *   and a fixed height for the picture, so a float there is two words a line beside a cropped
 *   photograph, and a float at the end of the excerpt would reach into the date and the place
 *   beneath it. The card puts every picture back in the flow.
 *
 * The words stay the size a card's words were (`body2`): this change is about the picture, and
 * a listing whose type grew would be a second, unasked-for change.
 */
export const CARD_EXCERPT_SX = {
  color: "text.secondary",
  mb: 2,
  "& p": { fontSize: "0.875rem", lineHeight: 1.43, mb: 1 },
  "& p:last-of-type": { mb: 0 },
  // One class more specific than the figure's own rule, which is how the chosen width and the
  // chosen side — both media queries from `sm` up — are overridden without `!important`.
  "& figure": { width: "100%", my: 1, float: "none", marginLeft: "auto", marginRight: "auto" },
  "& figure img": { maxHeight: 180, objectFit: "cover" },
  // The caption follows the picture: centred under a band, and every card's picture is a band.
  "& figcaption": { textAlign: "center" },
} as const;

/**
 * The short description, on the hero, the event page, its preview and the listing cards
 * (`DECISIONS.md` §73): the rich excerpt when one was written — a sentence or two and, when
 * the organizer wanted one, a picture — and the plain `excerpt` as one paragraph for events
 * from before it. Nothing at all when there is nothing, so the facts move up rather than
 * under a gap.
 */
export default function EventExcerpt({
  excerptJson,
  excerpt,
  place = "page",
}: {
  excerptJson: unknown;
  excerpt: string | null;
  /** `card` constrains the picture to the card; see `CARD_EXCERPT_SX`. */
  place?: ExcerptPlace;
}) {
  const doc = excerptJson ? readRichText(excerptJson) : fromPlainText(excerpt);
  if (!hasRichTextContent(doc)) return null;
  return (
    <Box sx={place === "card" ? CARD_EXCERPT_SX : PAGE_EXCERPT_SX}>
      <RichText body={doc} />
    </Box>
  );
}
