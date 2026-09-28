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
import {
  CARD_FRAME_SX,
  cardCoverSx,
  cardFrameGeometry,
  cropGeometry,
  cropImageSx,
  cropWindowSx,
  imageCaptionSx,
  imageFigureSx,
} from "./image-layout";
import { blockAlignSx } from "./text-align";
import RichTextVideo from "./RichTextVideo";
import { tableSx } from "./table-layout";

/**
 * An editorial body, rendered on the server through the allowlist that validated it
 * (`AGENTS.md` §11.3). A node type with no `case` here cannot reach a page whatever is stored,
 * which is why the body is walked rather than turned into HTML (no `dangerouslySetInnerHTML`).
 *
 * Takes `unknown`: `body_json` is untyped and old bodies have the old shape (`readRichText`).
 * `links={false}` is the listing card's reading (§366): link marks become their words, bare
 * addresses their host.
 */
export default function RichText({
  body,
  links = true,
  pictures = "page",
}: {
  body: unknown;
  links?: boolean;
  /**
   * The column the body is drawn in, for each picture's `sizes` (§414). On `card` every picture
   * is in the 16∶9 frame at its focal point (§454, §470).
   */
  pictures?: PictureColumn;
}) {
  const doc = readRichText(body);
  const blocks = doc.content ?? [];
  /** A float must not reach past the body; the clearing element exists only when something floats. */
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

/** `floats`: whether this document floats a picture anywhere (see `imageFigureSx`). */
function renderBlock(
  block: RichTextBlock,
  floats = false,
  links = true,
  pictures: PictureColumn = "page",
): ReactNode {
  switch (block.type) {
    case "youtube":
      // Nothing fetched from Google until the reader presses play (§69, §110); laid out like a picture (§266).
      return (
        <RichTextVideo
          videoId={block.attrs.videoId}
          caption={block.attrs.caption}
          poster={block.attrs.poster}
          posterWidth={block.attrs.posterWidth ?? null}
          posterHeight={block.attrs.posterHeight ?? null}
          posterCrop={block.attrs.posterCrop ?? null}
          pictures={pictures}
          widthPercent={block.attrs.widthPercent}
          align={block.attrs.align}
          floats={floats}
        />
      );
    case "image": {
      // The address was validated as this site's own (§72). The crop window (§241) is emitted
      // only when there is a crop, so uncropped pictures render unchanged.
      if (pictures === "card") return renderFramedPicture(block);
      const crop = cropGeometry(block.attrs.crop, block.attrs);
      // The ladder (§414): pictures from before have no `srcset`. A cropped photograph is drawn
      // `1 / crop.w` times its window.
      const srcSet = pictureSrcSet(block.attrs.src, block.attrs.width);
      const sizes = srcSet
        ? pictureSizes(pictures, block.attrs.widthPercent, crop && block.attrs.crop ? 1 / block.attrs.crop.w : 1)
        : undefined;
      return (
        <Box component="figure" sx={imageFigureSx(block.attrs, floats)}>
          {crop ? (
            // No `width`/`height` inside: the window's `aspect-ratio` reserves the space.
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
        A table (§196) cannot reflow at 320 px, so the wrapper scrolls sideways inside a page that
        does not; `tabIndex={0}` makes that region keyboard-reachable. Header cells get `scope` for
        screen readers. The drawing lives in `table-layout.ts`, shared with the editor (§263).
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
              // Only a sized table (§271) gets `fixed`, without which the browser ignores `<colgroup>`.
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
 * A picture on a listing card in the 16∶9 frame (§454, §470). Width and side are overridden by
 * the card's `CARD_EXCERPT_SX`.
 */
function renderFramedPicture(block: Extract<RichTextBlock, { type: "image" }>): ReactNode {
  const frame = cardFrameGeometry(block.attrs);
  const srcSet = pictureSrcSet(block.attrs.src, block.attrs.width);
  const sizes = srcSet ? pictureSizes("card", 100, frame?.magnify ?? 1) : undefined;
  return (
    <Box component="figure" sx={imageFigureSx(block.attrs, false)}>
      <Box className="rt-card-frame" data-testid="card-picture" sx={CARD_FRAME_SX}>
        <Box
          component="img"
          src={block.attrs.src}
          srcSet={srcSet}
          sizes={sizes}
          alt={block.attrs.alt}
          loading="lazy"
          sx={frame ? cropImageSx(frame.geometry) : cardCoverSx(block.attrs.focus)}
        />
      </Box>
      {block.attrs.caption !== "" && (
        <Typography component="figcaption" variant="body2" color="text.secondary" sx={imageCaptionSx(block.attrs)}>
          {block.attrs.caption}
        </Typography>
      )}
    </Box>
  );
}

/**
 * `rel` and `target` are decided here, never read from the document (the schema drops both):
 * off-site links open in a new tab with `noopener noreferrer`. Without `links` (§366), see above.
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
