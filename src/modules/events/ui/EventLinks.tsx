import Box from "@mui/material/Box";
import Link from "@mui/material/Link";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";
import { DENSITY } from "@/theme/density";
import { type EventLink, type EventLinkKind, eventLinkHost, eventLinkLabel } from "../domain/links";
import { partitionEventLinks } from "../domain/route-section";
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
 * When the page has a route section (§387, `routeSection`), the route's own kinds — the GPX and
 * the map — are drawn there instead (`partitionEventLinks`), and this section keeps the rest or
 * hides itself when nothing is left.
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
  routeSection = false,
}: {
  /** The column as stored; read through `readEventLinks`, so an entry that is not a link is dropped. */
  links: unknown;
  locale: "ro" | "en";
  heading: string;
  /** Each kind's word in the reader's language — the label of a link the club did not name. */
  kindLabels: Record<EventLinkKind, string>;
  /** Whether the page draws a route section (§387), which then takes the route's own kinds. */
  routeSection?: boolean;
}) {
  const rows = partitionEventLinks(links, routeSection).other;
  if (rows.length === 0) return null;

  return (
    <Box component="section" id="links" sx={{ mt: { xs: DENSITY.sectionGapLg, sm: 4 } }}>
      <Typography variant="h2" sx={{ fontSize: "1.25rem", mb: 1 }}>
        {heading}
      </Typography>
      <LinkList rows={rows.map((link) => eventLinkRow(link, locale, kindLabels))} />
    </Box>
  );
}

/** One row of a list of links: where it goes, what it is called, its glyph, and what it is. */
export type LinkRow = { url: string; label: string; icon: ReactNode; kind: string };

/** A stored link as a row: the kind's glyph, and the club's label or the kind's own word. */
export function eventLinkRow(link: EventLink, locale: "ro" | "en", kindLabels: Record<EventLinkKind, string>): LinkRow {
  const Icon = LINK_GLYPH[link.kind];
  return {
    url: link.url,
    label: eventLinkLabel(link, locale) ?? kindLabels[link.kind],
    icon: <Icon aria-hidden="true" sx={{ fontSize: 22, flexShrink: 0 }} />,
    kind: link.kind,
  };
}

/**
 * The list itself, shared by "Linkuri și fișiere" and the route section (§387), so a GPX reads the
 * same in either place: one link per row, the glyph, the label, and the host beneath it.
 */
export function LinkList({ rows }: { rows: readonly LinkRow[] }) {
  return (
    // `role="list"` restated for WebKit, which drops it from a list with no markers (§169).
    <Box component="ul" role="list" sx={{ listStyle: "none", m: 0, p: 0, display: "grid", rowGap: 0.5 }}>
      {rows.map((row, index) => {
        const host = eventLinkHost(row.url);
        return (
          <Box component="li" role="listitem" key={index}>
            <Link
              href={row.url}
              target="_blank"
              rel="noopener noreferrer"
              data-link-kind={row.kind}
              sx={{ display: "flex", alignItems: "center", gap: 1.25, minHeight: 44, py: 0.5 }}
            >
              {row.icon}
              <Box component="span" sx={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <Box component="span" sx={{ overflowWrap: "anywhere" }}>
                  {row.label}
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
  );
}
