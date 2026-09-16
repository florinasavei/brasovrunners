import Typography from "@mui/material/Typography";
import type { LegalDocumentBody as LegalDocumentBodyShape } from "../domain/content-hash";

/**
 * Renders a legal document's stored body — headings and paragraphs, nothing else (see
 * `domain/content-hash.ts` for why this shape rather than the CMS's rich-text contract).
 *
 * No `dangerouslySetInnerHTML` anywhere: every string here is plain text from an approved,
 * versioned row, rendered as text, so there is no arbitrary-HTML surface to review.
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
          {section.paragraphs.map((paragraph, paragraphIndex) => (
            <Typography key={paragraphIndex} variant="body1" sx={{ mb: 2 }}>
              {paragraph}
            </Typography>
          ))}
        </div>
      ))}
    </>
  );
}

function isLegalDocumentBody(value: unknown): value is LegalDocumentBodyShape {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { sections?: unknown }).sections)
  );
}
