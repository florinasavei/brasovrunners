import Box from "@mui/material/Box";
import MuiLink from "@mui/material/Link";
import Typography from "@mui/material/Typography";
import { Fragment } from "react";
import { isLegalDocumentBody } from "../domain/content-hash";
import { parseInline } from "../domain/inline";
import { dropsParagraph, mergeTextSegments, type MergeValues } from "../domain/merge-fields";

/**
 * Renders a stored legal body with its inline links and pictures (§127). No
 * `dangerouslySetInnerHTML`: the marks become an `<a>` and an `<img>` with attributes the
 * parser allowed, never markup.
 */
export default function LegalDocumentBody({
  body,
  values,
  anchorPrefix = "s",
  emphasizeFilled = true,
}: {
  body: unknown;
  /** Bold the filled-in parts (§225); off for the terms and notice, whose fields are only deadlines (§377). */
  emphasizeFilled?: boolean;
  /** Heading id prefix (§323): `s1`, `s2`…; two bodies on one page need distinct prefixes. */
  anchorPrefix?: string;
  /**
   * The blanks for one person and event (§225). Passed unmerged so the filled parts can be bold:
   * they are what the signer must check.
   */
  values?: MergeValues;
}) {
  const sections = isLegalDocumentBody(body) ? body.sections : [];

  /**
   * Merges inside each text run after the inline marks are parsed, so a filled-in value (a
   * participant's name) is always plain text and never becomes a link.
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
          {section.heading && (
            <Typography id={`${anchorPrefix}${index + 1}`} variant="h2" sx={{ fontSize: "1.25rem", mt: 4, mb: 1, scrollMarginTop: 72 }}>
              {inline(section.heading, `h-${index}`)}
            </Typography>
          )}
          {section.paragraphs.map((paragraph, paragraphIndex) => {
            // A sentence about a value the event lacks (no minimum age) is left out; §440.
            if (values && dropsParagraph(paragraph, values)) return null;
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
