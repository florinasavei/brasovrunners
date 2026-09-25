import Box from "@mui/material/Box";
import Link from "@mui/material/Link";
import Typography from "@mui/material/Typography";
import { Fragment, type ReactNode } from "react";
import { type PictureColumn, pictureSizes, pictureSrcSet } from "@/modules/media/ladder";
import {
  readRichText,
  type RichTextBlock,
  type RichTextText,
  tableColumnFractions,
} from "../domain/schema";
import { shortenUrls } from "../domain/short-url";
import { cropGeometry, cropImageSx, cropWindowSx, imageCaptionSx, imageFigureSx } from "./image-layout";
import { blockAlignSx } from "./text-align";
import RichTextVideo from "./RichTextVideo";
import { tableSx } from "./table-layout";

/**
 * An editorial body, rendered on the server through the same allowlist that validated it
 * (`AGENTS.md` §11.3).
 *
 * The renderer is the second half of the security property, and the stronger half: a node type
 * this file has no `case` for cannot appear on a page whatever is stored, because there is no
 * code path that emits it. That is why the body is walked here rather than handed to a
 * HTML-generating helper — no `dangerouslySetInnerHTML`, no virtual DOM on the server, and no
 * third dependency.
 *
 * It takes `unknown` on purpose: `body_json` is untyped at the database boundary, and bodies
 * written before the editor existed are still in the old section shape. `readRichText` is the one
 * place that difference is handled.
 *
 * `links={false}` is the listing card's reading (§366): a link mark is its words and a bare web
 * address is its host ("register.hakuapp.com/…", `shortenUrls`). A card is a summary of a page
 * one press away, its three clamped lines are no place for a link that may be cut in half, and a
 * ninety-character address wrapped over two lines of a card was one of the holes the owner pointed
 * at. The event page keeps every link.
 */
export default function RichText({
  body,
  links = true,
  pictures = "page",
}: {
  body: unknown;
  links?: boolean;
  /**
   * The column the body is drawn in (§NNN, `media/ladder.ts`): the event page's wide one by
   * default, a standing page's measure, or a listing card. It becomes each picture's `sizes`,
   * which is how the browser picks the smallest stored width that is still sharp there.
   */
  pictures?: PictureColumn;
}) {
  const doc = readRichText(body);
  const blocks = doc.content ?? [];
  /**
   * A float that runs past the last block would reach into whatever the page puts after the
   * body — the registration panel, the programme, the next section — and pull it up beside the
   * picture. One clearing element, rendered only when the body actually floats something, so a
   * document written before 2026-09-20 emits exactly the markup it emitted yesterday.
   */
  const floats = blocks.some((block) => block.type === "image" && block.attrs.align !== "block");

  return (
    <>
      {blocks.map((block, index) => (
        <Fragment key={index}>{renderBlock(block, floats, links, pictures)}</Fragment>
      ))}
      {floats && <Box sx={{ clear: "both" }} />}
    </>
  );
}

/**
 * `floats` is whether *this document* floats a picture anywhere. It is false for every body
 * written before the alignment existed, and a false one emits exactly the styles it emitted
 * before: the clearing rules are not merely no-ops there, they are absent.
 */
function renderBlock(block: RichTextBlock, floats = false, links = true, pictures: PictureColumn = "page"): ReactNode {
  switch (block.type) {
    case "youtube":
      // Behind one press, like the event's own film (§69, §110): the embed is built from the
      // id on the server, and nothing is fetched from Google until the reader opens it. Since
      // §266 it is a figure in the flow with the picture's own width and side, which is why it
      // takes `floats` as well: a document that floats anything clears around it the same way.
      return (
        <RichTextVideo
          videoId={block.attrs.videoId}
          caption={block.attrs.caption}
          widthPercent={block.attrs.widthPercent}
          align={block.attrs.align}
          floats={floats}
        />
      );
    case "image": {
      // A plain <img>, lazy, sized by its stored dimensions so the page does not jump; the
      // address was validated to be one of this site's own variants (§72). Where the figure
      // sits in the column — a band, or floated with the text beside it — is `image-layout.ts`,
      // which is also where the reversal of §73's "never floated" is argued.
      //
      // A picture the organizer cropped (§241) is the same <img> inside a window that shows the
      // rectangle they drew. The window is emitted only when there is a crop, so every picture
      // written before today renders the markup it rendered yesterday, byte for byte.
      const crop = cropGeometry(block.attrs.crop, block.attrs);
      /*
        The ladder (§NNN): a picture stored since then names its smaller siblings, and `sizes`
        says how wide it is drawn here — the column's share of the screen, magnified by the crop
        when there is one, because a cropped photograph is drawn `1 / crop.w` times its window.
        A picture from before has no siblings, gets no `srcset`, and renders the markup it
        rendered yesterday. A card's picture is always the card's width (`CARD_EXCERPT_SX`).
      */
      const srcSet = pictureSrcSet(block.attrs.src, block.attrs.width);
      const sizes = srcSet
        ? pictureSizes(pictures, pictures === "card" ? 100 : block.attrs.widthPercent, crop && block.attrs.crop ? 1 / block.attrs.crop.w : 1)
        : undefined;
      return (
        <Box component="figure" sx={imageFigureSx(block.attrs, floats)}>
          {crop ? (
            // No `width`/`height` attributes inside: the window reserves the space from the
            // crop's own shape, and the photograph is laid over it at whatever size that takes.
            <Box className="rt-crop" sx={cropWindowSx(crop)}>
              <Box component="img" src={block.attrs.src} srcSet={srcSet} sizes={sizes} alt={block.attrs.alt} loading="lazy" sx={cropImageSx(crop)} />
            </Box>
          ) : (
            <Box
              component="img"
              src={block.attrs.src}
              srcSet={srcSet}
              sizes={sizes}
              alt={block.attrs.alt}
              width={block.attrs.width ?? undefined}
              height={block.attrs.height ?? undefined}
              loading="lazy"
              sx={{ display: "block", width: "100%", height: "auto", borderRadius: 1 }}
            />
          )}
          {block.attrs.caption !== "" && (
            <Typography component="figcaption" variant="body2" color="text.secondary" sx={imageCaptionSx(block.attrs)}>
              {block.attrs.caption}
            </Typography>
          )}
        </Box>
      );
    }
    case "paragraph":
      // `textAlign` is emitted only when the organizer chose one (§213): a body written before
      // alignment existed renders the markup it rendered yesterday, not a rule that says "left".
      return (
        <Typography variant="body1" sx={{ mb: 2, ...blockAlignSx(block.attrs) }}>
          {renderInline(block.content, links)}
        </Typography>
      );

    case "heading":
      // Level 2 and 3 only; the page's own title is the h1 (see the schema).
      return (
        <Typography
          component={block.attrs.level === 2 ? "h2" : "h3"}
          sx={{ fontSize: block.attrs.level === 2 ? "1.25rem" : "1.0625rem", fontWeight: 700, mt: 4, mb: 1, ...blockAlignSx(block.attrs) }}
        >
          {renderInline(block.content, links)}
        </Typography>
      );

    case "bulletList":
    case "orderedList":
      return (
        <Box
          component={block.type === "bulletList" ? "ul" : "ol"}
          // The browser's own list marker and indent, with the vertical rhythm of a paragraph.
          sx={{ pl: 3, mb: 2, "& li": { mb: 0.5 } }}
          start={block.type === "orderedList" ? block.attrs?.start : undefined}
        >
          {block.content.map((item, index) => (
            <li key={index}>
              {item.content.map((paragraph, paragraphIndex) => (
                <Typography key={paragraphIndex} variant="body1" component="span">
                  {renderInline(paragraph.content, links)}
                </Typography>
              ))}
            </li>
          ))}
        </Box>
      );

    case "blockquote":
      return (
        <Box
          component="blockquote"
          sx={{ borderLeft: 3, borderColor: "divider", pl: 2, ml: 0, mb: 2, fontStyle: "italic" }}
        >
          {block.content.map((paragraph, index) => (
            <Typography key={index} variant="body1" sx={{ mb: 1 }}>
              {renderInline(paragraph.content, links)}
            </Typography>
          ))}
        </Box>
      );

    case "table": {
      /*
        A table (§196), and the whole of the difficulty is that this site's hard target is a
        320-pixel column.

        A table cannot reflow: four columns of times and distances are four columns whatever the
        screen. So the table keeps its shape and the *wrapper* scrolls sideways — one element
        that scrolls, inside a page that does not, which is the one arrangement a phone handles
        without the whole layout sliding under the reader's thumb. `maxWidth: 100%` on the
        wrapper is what keeps the page from growing to the table's width.

        `tabIndex={0}` on the scrolling box is not decoration: a region that scrolls and cannot
        be reached from a keyboard is unreadable to anybody not using a pointer, and browsers do
        not make it focusable on their own.

        Header cells become `<th scope>` — a column header says which column, a row header which
        row — so a screen reader announces "Ora de start, 10:00" rather than "10:00".

        How it is *drawn* — a grid, horizontal rules only, or nothing at all, and where in the
        cell the text sits — is the organizer's choice since §263 and lives in `table-layout.ts`,
        which the editor draws from as well. It used to be the block of rules below, which the
        editor had no copy of: the page showed a grid and the editor showed nothing, so a table
        was arranged against one drawing and published as another.
      */
      const columns = tableColumnFractions(block.content);
      return (
        <Box
          tabIndex={0}
          role="region"
          sx={{ maxWidth: "100%", overflowX: "auto", mb: 2, WebkitOverflowScrolling: "touch" }}
        >
          <Box
            component="table"
            sx={{
              ...tableSx(block.attrs),
              /*
                Column proportions the organizer dragged (§271). `table-layout: fixed` is what
                makes a browser honour a `<colgroup>` at all — with `auto` it sizes the columns
                from their contents and the widths are a suggestion it ignores. Only a table that
                was actually sized gets it; every other table keeps the automatic layout it has
                always had, which is what a schedule of short facts wants.
              */
              ...(columns ? { tableLayout: "fixed", width: "100%" } : {}),
            }}
          >
            {columns && (
              <Box component="colgroup">
                {columns.map((fraction, index) => (
                  <Box component="col" key={index} sx={{ width: `${(fraction * 100).toFixed(4)}%` }} />
                ))}
              </Box>
            )}
            <Box component="tbody">
              {block.content.map((row, rowIndex) => (
                <Box component="tr" key={rowIndex}>
                  {row.content.map((cell, cellIndex) => (
                    <Box
                      component={cell.type === "tableHeader" ? "th" : "td"}
                      key={cellIndex}
                      scope={
                        cell.type === "tableHeader" ? (rowIndex === 0 ? "col" : "row") : undefined
                      }
                      colSpan={cell.attrs?.colspan}
                      rowSpan={cell.attrs?.rowspan}
                    >
                      {cell.content.map((inner, innerIndex) => (
                        <Fragment key={innerIndex}>{renderBlock(inner, false, links, pictures)}</Fragment>
                      ))}
                    </Box>
                  ))}
                </Box>
              ))}
            </Box>
          </Box>
        </Box>
      );
    }
  }
}

/**
 * Text and its marks.
 *
 * `rel` and `target` are decided here rather than read from the document (the schema drops both).
 * An off-site link opens in a new tab with `noopener noreferrer`, and a link to this site does
 * not — a rule that then applies to every body ever written, including those written before the
 * rule existed.
 *
 * Without `links` (a listing card, §366) a link mark renders nothing but its words, and every web
 * address written as text — in a link's words or in a sentence — is shortened to its host.
 */
function renderInline(content: RichTextText[] | undefined, links = true): ReactNode {
  return (content ?? []).map((node, index) => {
    let rendered: ReactNode = links ? node.text : shortenUrls(node.text);

    for (const mark of node.marks ?? []) {
      if (mark.type === "bold") rendered = <strong>{rendered}</strong>;
      if (mark.type === "italic") rendered = <em>{rendered}</em>;
      if (mark.type === "link" && links) {
        const external = !mark.attrs.href.startsWith("/");
        rendered = (
          <Link
            href={mark.attrs.href}
            {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          >
            {rendered}
          </Link>
        );
      }
    }

    return <Fragment key={index}>{rendered}</Fragment>;
  });
}
