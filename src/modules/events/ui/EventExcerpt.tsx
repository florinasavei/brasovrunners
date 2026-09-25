import Box from "@mui/material/Box";
import {
  fromPlainText,
  hasRichTextContent,
  isRichTextEmpty,
  readRichText,
  type RichTextBlock,
  type RichTextDoc,
} from "@/modules/content/rich-text/domain/schema";
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
 * **Three lines of words, and no address** (§366; the owner, 2026-09-24, of the listing: "There
 * is too much whitespace on these cards, it needs to be better spaced"). A summary as long as its
 * author made it was what set one card's height against its neighbour's, and a registration
 * address in it wrapped over two lines of a phone. So the card reads at most three lines —
 * `-webkit-line-clamp`, which every engine the site supports implements on a `-webkit-box` and
 * counts across the summary's paragraphs, ending the third in an ellipsis — and the rest is on the
 * event page, one press away. The words carry no link (`RichText links={false}`): an address is its
 * host, and `overflowWrap` is the net under anything else too long for a 320-pixel line.
 *
 * **The clamp is the words' box, never the pictures' (§NNN;** the owner, 2026-09-25: "am pus o poza
 * pe cardul de rezumat dar nu apare si pe site"). §366 clamped the whole summary, pictures inside,
 * on the argument that a picture is not a line — but a clamped box cuts whatever comes after its
 * third line, and a picture written under three lines of words was cut with the rest: on the event
 * page, gone from the card. So the card splits the summary (`splitCardExcerpt`): the words, every
 * paragraph of them, are one box clamped to three lines (`CARD_EXCERPT_WORDS_SX`), and every picture
 * and film stands outside it in the order it was written — the ones written before the first words
 * above that box, the rest under it. A picture is a picture whatever the length of the words.
 *
 * The outer box is a flex column, as the clamped box was a `-webkit-box`: neither collapses a
 * child's margin into its own, so a picture written first sits exactly where it sat — a line's gap
 * under the title and its own eight pixels more.
 */
export const CARD_EXCERPT_SX = {
  color: "text.secondary",
  // A line's gap under the title (or the series' rhythm): the summary belongs to them. Never less:
  // the title's link reaches exactly this far below its words (`CARD_TITLE_SX`, §366).
  mt: LINE_GAP,
  display: "flex",
  flexDirection: "column",
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
 * The card's words, and only its words: three lines at most across every paragraph, the third
 * ending in an ellipsis (§366). No picture is ever inside this box (§NNN), so nothing it clamps
 * away is anything but words — which the event page, one press away, carries whole.
 */
export const CARD_EXCERPT_WORDS_SX = {
  display: "-webkit-box",
  WebkitBoxOrient: "vertical",
  WebkitLineClamp: 3,
  overflow: "hidden",
  overflowWrap: "anywhere",
} as const;

/** A block that is a picture or a film: never a line of words, never clamped (§NNN). */
function isMedia(block: RichTextBlock): boolean {
  return block.type === "image" || block.type === "youtube";
}

/**
 * The summary as a card lays it out (§NNN): the pictures and films written before the first words,
 * the words themselves — every block that is not a picture, in order, `null` when none of them says
 * anything — and every picture and film written after the first words, in the order they were
 * written. Nothing is dropped: the three parts together are the document's blocks.
 *
 * "The first words" is the first block that has any, so the empty paragraph an editor leaves above a
 * picture does not push that picture under the words.
 */
export function splitCardExcerpt(doc: RichTextDoc): { before: RichTextBlock[]; words: RichTextBlock[] | null; after: RichTextBlock[] } {
  const blocks = doc.content ?? [];
  const firstWords = blocks.findIndex((block) => !isMedia(block) && !isRichTextEmpty({ type: "doc", content: [block] }));
  const lead = firstWords === -1 ? blocks.length : firstWords;
  const words = blocks.filter((block) => !isMedia(block));
  return {
    before: blocks.slice(0, lead).filter(isMedia),
    words: firstWords === -1 ? null : words,
    after: blocks.slice(lead).filter(isMedia),
  };
}

/** A run of blocks as a document of its own, for `RichText`. */
const docOf = (content: RichTextBlock[]): RichTextDoc => ({ type: "doc", content });

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
  /** `card` constrains the picture to the card and clamps the words alone; see `CARD_EXCERPT_SX`. */
  place?: ExcerptPlace;
}) {
  const doc = excerptJson ? readRichText(excerptJson) : fromPlainText(excerpt);
  if (!hasRichTextContent(doc)) return null;
  if (place === "page") {
    return (
      <Box sx={PAGE_EXCERPT_SX}>
        <RichText body={doc} />
      </Box>
    );
  }
  const { before, words, after } = splitCardExcerpt(doc);
  return (
    <Box sx={CARD_EXCERPT_SX} data-testid="card-excerpt">
      {before.length > 0 && <RichText body={docOf(before)} links={false} />}
      {words && (
        <Box sx={CARD_EXCERPT_WORDS_SX} data-testid="card-excerpt-words">
          <RichText body={docOf(words)} links={false} />
        </Box>
      )}
      {after.length > 0 && <RichText body={docOf(after)} links={false} />}
    </Box>
  );
}
