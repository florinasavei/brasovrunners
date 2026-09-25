import Box from "@mui/material/Box";
import MuiLink from "@mui/material/Link";
import Typography from "@mui/material/Typography";
import { Fragment } from "react";
import { isLegalDocumentBody } from "../domain/content-hash";
import { parseInline } from "../domain/inline";
import { mergeTextSegments, type MergeValues } from "../domain/merge-fields";

/**
 * Renders a legal document's stored body — headings and paragraphs, and inside a paragraph
 * the links and pictures written as `[words](https://…)` and `![what it shows](https://…)`
 * (§127; see `domain/content-hash.ts` for why this shape rather than the CMS's rich text).
 *
 * No `dangerouslySetInnerHTML` anywhere: every string is plain text from an approved,
 * versioned row, and the two marks become an `<a>` and an `<img>` with attributes the parser
 * allowed — https, mailto or a path for a link, https for a picture — never markup.
 */
export default function LegalDocumentBody({
  body,
  values,
  anchorPrefix = "s",
  emphasizeFilled = true,
}: {
  body: unknown;
  /**
   * Whether the filled-in parts are bold (§225). A declaration's are — they are what the signer
   * checks. The terms and the privacy notice fill in only the club's deadlines (§377), which are
   * part of the sentence like any other word, so their pages turn it off.
   */
  emphasizeFilled?: boolean;
  /**
   * What each heading's id starts with (§323): `s1`, `s2`… on a public legal page, so a link can
   * name a section. A page showing two bodies — the backoffice's RO and EN side by side — gives
   * each its own prefix, because an id is one element per page.
   */
  anchorPrefix?: string;
  /**
   * The blanks to fill, when this is a declaration shown to one person for one event (§225).
   *
   * Passing the values here rather than a pre-merged body is what lets the filled-in parts be
   * **bold** — the owner: "în declarație trebuie să fac bold la datele care sunt din binding".
   * The reason is not decoration: a declaration is one approved text with a few blanks, and
   * what the signer must check before signing is exactly the blanks — their name, their
   * identity document, the race and its date. The rest was approved once and is the same for
   * everybody.
   *
   * Omitted, this renders exactly what it always did.
   */
  values?: MergeValues;
}) {
  const sections = isLegalDocumentBody(body) ? body.sections : [];

  /**
   * One string, merged and marked up, as React children.
   *
   * **Inline marks are parsed first and the merge happens inside each text run**, which is the
   * order that matters. Merging first would feed a participant's name to `parseInline`, so a
   * name containing `[words](…)` would be read as a link — the parser restricts the protocol,
   * so it was never script, but a person's own data has no business becoming markup. This way
   * a filled-in value is always plain text, and a `{{field}}` written inside a link's label
   * still merges, inside the link, where the author put it.
   */
  const inline = (text: string, keyPrefix: string) =>
    (values ? mergeTextSegments(text, values) : [{ text, filled: false }]).map((segment, index) =>
      segment.filled && emphasizeFilled ? (
        <Box key={`${keyPrefix}-${index}`} component="strong" sx={{ fontWeight: 700 }}>
          {segment.text}
        </Box>
      ) : (
        <Fragment key={`${keyPrefix}-${index}`}>{segment.text}</Fragment>
      ),
    );

  return (
    <>
      {sections.map((section, index) => (
        <div key={index}>
          {/* `#s3` is section 3 (§323): a notice, an email or a reply can point at "section 6"
              and land on it. */}
          {section.heading && (
            <Typography id={`${anchorPrefix}${index + 1}`} variant="h2" sx={{ fontSize: "1.25rem", mt: 4, mb: 1, scrollMarginTop: 72 }}>
              {inline(section.heading, `h-${index}`)}
            </Typography>
          )}
          {section.paragraphs.map((paragraph, paragraphIndex) => {
            const parts = parseInline(paragraph);
            const onlyPicture = parts.length === 1 && parts[0].kind === "image";
            if (onlyPicture && parts[0].kind === "image") {
              return (
                <Box key={paragraphIndex} component="figure" sx={{ m: 0, mb: 2 }}>
                  <Box component="img" src={parts[0].src} alt={parts[0].alt} loading="lazy" sx={{ maxWidth: "100%", height: "auto", borderRadius: 1 }} />
                  {parts[0].alt && (
                    <Typography component="figcaption" variant="caption" color="text.secondary">
                      {parts[0].alt}
                    </Typography>
                  )}
                </Box>
              );
            }
            return (
              <Typography key={paragraphIndex} variant="body1" sx={{ mb: 2 }}>
                {parts.map((part, partIndex) => (
                  <Fragment key={partIndex}>
                    {part.kind === "text" && inline(part.text, `t-${paragraphIndex}-${partIndex}`)}
                    {part.kind === "link" && (
                      <MuiLink href={part.href} target={part.href.startsWith("/") ? undefined : "_blank"} rel={part.href.startsWith("/") ? undefined : "noopener noreferrer"}>
                        {inline(part.text, `l-${paragraphIndex}-${partIndex}`)}
                      </MuiLink>
                    )}
                    {part.kind === "image" && <Box component="img" src={part.src} alt={part.alt} loading="lazy" sx={{ maxWidth: "100%", height: "auto", display: "block", my: 1 }} />}
                  </Fragment>
                ))}
              </Typography>
            );
          })}
        </div>
      ))}
    </>
  );
}
