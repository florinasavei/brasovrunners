import Box from "@mui/material/Box";
import Link from "@mui/material/Link";
import Typography from "@mui/material/Typography";
import { DENSITY } from "@/theme/density";
import { type EventLinkKind, eventLinkHost, eventLinkLabel, readEventLinks } from "../domain/links";
import { LINK_GLYPH } from "./link-glyphs";

/**
 * "Linkuri și fișiere" under `#links` (`DECISIONS.md` §332): the GPX on Google Drive, the rules
 * as a PDF, the album, the results — one row each, in the club's order. Nothing at all when the
 * event has none, so the anchor the emails point at exists only when it leads somewhere (the
 * rule `EventProgramme` follows for `#schedule`).
 *
 * Each row is one link, 44 pixels tall at least (BR-REQ-041-01 criterion 6): the kind's glyph,
 * the label — the club's own in this language, or the kind's word in the reader's language when
 * it wrote none — and the host in small text underneath, "drive.google.com", so the runner knows
 * which service opens before pressing. That host line is the whole of what the page says about
 * the destination: nothing sniffs the file or promises what is behind the link. The address is
 * whatever an organizer pasted, so it opens in a new tab with `rel="noopener noreferrer"`.
 *
 * A Server Component with no hooks and no catalogue of its own: the page hands it the words, so
 * the public page and the staff preview render it identically, and a test can render it as it is.
 * Its glyphs are the public set (`link-glyphs.ts`), never the backoffice's registry (§318).
 */
export default function EventLinks({
  links,
  locale,
  heading,
  kindLabels,
}: {
  /** The column as stored; read through `readEventLinks`, so an entry that is not a link is dropped. */
  links: unknown;
  locale: "ro" | "en";
  heading: string;
  /** Each kind's word in the reader's language — the label of a link the club did not name. */
  kindLabels: Record<EventLinkKind, string>;
}) {
  const rows = readEventLinks(links);
  if (rows.length === 0) return null;

  return (
    <Box component="section" id="links" sx={{ mt: { xs: DENSITY.sectionGapLg, sm: 4 } }}>
      <Typography variant="h2" sx={{ fontSize: "1.25rem", mb: 1 }}>
        {heading}
      </Typography>
      {/* `role="list"` restated for WebKit, which drops it from a list with no markers (§169). */}
      <Box component="ul" role="list" sx={{ listStyle: "none", m: 0, p: 0, display: "grid", rowGap: 0.5 }}>
        {rows.map((link, index) => {
          const Icon = LINK_GLYPH[link.kind];
          const host = eventLinkHost(link.url);
          return (
            <Box component="li" role="listitem" key={index}>
              <Link
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                data-link-kind={link.kind}
                sx={{ display: "flex", alignItems: "center", gap: 1.25, minHeight: 44, py: 0.5 }}
              >
                <Icon aria-hidden="true" sx={{ fontSize: 22, flexShrink: 0 }} />
                <Box component="span" sx={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                  <Box component="span" sx={{ overflowWrap: "anywhere" }}>
                    {eventLinkLabel(link, locale) ?? kindLabels[link.kind]}
                  </Box>
                  {host && (
                    <Typography component="span" variant="caption" color="text.secondary" sx={{ overflowWrap: "anywhere", lineHeight: 1.3 }}>
                      {host}
                    </Typography>
                  )}
                </Box>
              </Link>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
