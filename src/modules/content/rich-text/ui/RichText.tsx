import Box from "@mui/material/Box";
import Link from "@mui/material/Link";
import Typography from "@mui/material/Typography";
import { Fragment, type ReactNode } from "react";
import {
  readRichText,
  type RichTextBlock,
  type RichTextText,
} from "../domain/schema";
import { imageCaptionSx, imageFigureSx } from "./image-layout";
import RichTextVideo from "./RichTextVideo";

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
 */
export default function RichText({ body }: { body: unknown }) {
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
        <Fragment key={index}>{renderBlock(block, floats)}</Fragment>
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
function renderBlock(block: RichTextBlock, floats = false): ReactNode {
  switch (block.type) {
    case "youtube":
      // Behind one press, like the event's own film (§69, §110): the embed is built from the
      // id on the server, and nothing is fetched from Google until the reader opens it.
      return <RichTextVideo videoId={block.attrs.videoId} caption={block.attrs.caption} />;
    case "image":
      // A plain <img>, lazy, sized by its stored dimensions so the page does not jump; the
      // address was validated to be one of this site's own variants (§72). Where the figure
      // sits in the column — a band, or floated with the text beside it — is `image-layout.ts`,
      // which is also where the reversal of §73's "never floated" is argued.
      return (
        <Box component="figure" sx={imageFigureSx(block.attrs, floats)}>
          <Box
            component="img"
            src={block.attrs.src}
            alt={block.attrs.alt}
            width={block.attrs.width ?? undefined}
            height={block.attrs.height ?? undefined}
            loading="lazy"
            sx={{ display: "block", width: "100%", height: "auto", borderRadius: 1 }}
          />
          {block.attrs.caption !== "" && (
            <Typography component="figcaption" variant="body2" color="text.secondary" sx={imageCaptionSx(block.attrs)}>
              {block.attrs.caption}
            </Typography>
          )}
        </Box>
      );
    case "paragraph":
      return (
        <Typography variant="body1" sx={{ mb: 2 }}>
          {renderInline(block.content)}
        </Typography>
      );

    case "heading":
      // Level 2 and 3 only; the page's own title is the h1 (see the schema).
      return (
        <Typography
          component={block.attrs.level === 2 ? "h2" : "h3"}
          sx={{ fontSize: block.attrs.level === 2 ? "1.25rem" : "1.0625rem", fontWeight: 700, mt: 4, mb: 1 }}
        >
          {renderInline(block.content)}
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
                  {renderInline(paragraph.content)}
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
              {renderInline(paragraph.content)}
            </Typography>
          ))}
        </Box>
      );
  }
}

/**
 * Text and its marks.
 *
 * `rel` and `target` are decided here rather than read from the document (the schema drops both).
 * An off-site link opens in a new tab with `noopener noreferrer`, and a link to this site does
 * not — a rule that then applies to every body ever written, including those written before the
 * rule existed.
 */
function renderInline(content: RichTextText[] | undefined): ReactNode {
  return (content ?? []).map((node, index) => {
    let rendered: ReactNode = node.text;

    for (const mark of node.marks ?? []) {
      if (mark.type === "bold") rendered = <strong>{rendered}</strong>;
      if (mark.type === "italic") rendered = <em>{rendered}</em>;
      if (mark.type === "link") {
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
