import Box from "@mui/material/Box";
import { fromPlainText, hasRichTextContent, readRichText } from "@/modules/content/rich-text/domain/schema";
import RichText from "@/modules/content/rich-text/ui/RichText";
import { LINE_GAP } from "./card-layout";

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
 * - **The float.** A picture set to sit left or right of the text on an event page (2026-09-20)
 *   is a decision about a column wide enough to have a side. A card has one narrow column of
 *   its own, so a float there is two words a line beside a photograph, and a float at the end
 *   of the excerpt would reach into the date and the place beneath it. The card puts every
 *   picture back in the flow.
 *
 * The height is **not** one of them any more (§260). The card used to cap every picture at 180
 * pixels and cut the rest from the centre, which is a crop nobody asked for and nobody could
 * see — the owner: "practic pe card au o înălțime fixă, ceea ce e cam greșit". A picture on a
 * card now has the shape it has, which is the shape it has in the editor and on the page: the
 * organizer's own crop box (§241) is where a portrait photograph becomes a band, and it is a
 * choice that is visible while it is being made.
 *
 * The words stay the size a card's words were (`body2`): this change is about the picture, and
 * a listing whose type grew would be a second, unasked-for change.
 *
 * **Three lines of words, and no address** (§NNN; the owner, 2026-09-24, of the listing: "There
 * is too much whitespace on these cards, it needs to be better spaced"). A summary as long as its
 * author made it was what set one card's height against its neighbour's, and a registration
 * address in it wrapped over two lines of a phone. So the card reads at most three lines —
 * `-webkit-line-clamp`, which every engine the site supports implements on a `-webkit-box` and
 * counts across the summary's paragraphs, ending the third in an ellipsis — and the rest is on the
 * event page, one press away. A picture is not a line: one written before the words keeps its
 * place above them, and one written after three lines of words is on the page, not the card. The
 * words carry no link (`RichText links={false}`): an address is its host, and `overflowWrap` is
 * the net under anything else too long for a 320-pixel line.
 */
export const CARD_EXCERPT_SX = {
  color: "text.secondary",
  // A line's gap under the title (or the series' rhythm): the summary belongs to them.
  mt: LINE_GAP,
  display: "-webkit-box",
  WebkitBoxOrient: "vertical",
  WebkitLineClamp: 3,
  overflow: "hidden",
  overflowWrap: "anywhere",
  "& p": { fontSize: "0.875rem", lineHeight: 1.43, mb: 1 },
  "& p:last-of-type": { mb: 0 },
  // One class more specific than the figure's own rule, which is how the chosen width and the
  // chosen side — both media queries from `sm` up — are overridden without `!important`.
  "& figure": { width: "100%", my: 1, float: "none", marginLeft: "auto", marginRight: "auto" },
  /*
    A picture keeps its shape and stops growing (§275).

    §260 removed the 180-pixel band every card's picture was cut to, and that stands: nothing
    here crops. What it did not foresee is a portrait photograph seven hundred pixels tall
    beside a card with no picture at all — the owner, of the listing: "these cards are ugly".
    A ceiling scales the picture down and centres it; a short or wide one is untouched, and a
    tall one is the whole photograph, smaller. The crop box in the editor (§241) is still the
    only thing that cuts anything, and it is a choice somebody makes while looking at it.
  */
  "& figure > img": { height: "auto", maxHeight: 420, width: "auto", maxWidth: "100%", mx: "auto", display: "block" },
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
    <Box sx={place === "card" ? CARD_EXCERPT_SX : PAGE_EXCERPT_SX} data-testid={place === "card" ? "card-excerpt" : undefined}>
      <RichText body={doc} links={place !== "card"} />
    </Box>
  );
}
