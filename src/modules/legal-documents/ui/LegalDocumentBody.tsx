import Box from "@mui/material/Box";
import MuiLink from "@mui/material/Link";
import Typography from "@mui/material/Typography";
import { Fragment } from "react";
import { isLegalDocumentBody } from "../domain/content-hash";
import { parseInline } from "../domain/inline";

/**
 * Renders a legal document's stored body — headings and paragraphs, and inside a paragraph
 * the links and pictures written as `[words](https://…)` and `![what it shows](https://…)`
 * (§127; see `domain/content-hash.ts` for why this shape rather than the CMS's rich text).
 *
 * No `dangerouslySetInnerHTML` anywhere: every string is plain text from an approved,
 * versioned row, and the two marks become an `<a>` and an `<img>` with attributes the parser
 * allowed — https, mailto or a path for a link, https for a picture — never markup.
 */
export default function LegalDocumentBody({ body }: { body: unknown }) {
  const sections = isLegalDocumentBody(body) ? body.sections : [];

  return (
    <>
      {sections.map((section, index) => (
        <div key={index}>
          {section.heading && (
            <Typography variant="h2" sx={{ fontSize: "1.25rem", mt: 4, mb: 1 }}>
              {section.heading}
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
                    {part.kind === "text" && part.text}
                    {part.kind === "link" && (
                      <MuiLink href={part.href} target={part.href.startsWith("/") ? undefined : "_blank"} rel={part.href.startsWith("/") ? undefined : "noopener noreferrer"}>
                        {part.text}
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
