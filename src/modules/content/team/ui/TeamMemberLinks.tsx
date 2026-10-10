import Box from "@mui/material/Box";
import MuiLink from "@mui/material/Link";
import { type PictureColumn, pictureSizes, pictureSrcSet } from "@/modules/media/ladder";
import { teamLinkHost, type TeamLinkKind } from "../links";
import type { PublicTeamLink, TeamPhoto } from "../repository";
import { teamPhotoFrame } from "./team-photo-frame";
import TeamLinkGlyph from "./TeamLinkGlyph";

/**
 * A person's links (§474), one row each in the club's order: the network's mark (§90), the club's
 * label in this language — or, without one, the network's name, and for a site or anything else
 * its host ("ana-alearga.ro"), so nobody is surprised by what opens. Every row is at least 44
 * pixels tall (BR-REQ-041-01 criterion 6) and opens in a new tab with no referrer: the address is
 * whatever the club pasted, checked `https://` at the save.
 *
 * Shared by the grid's card and the canvas's (§NNN). `linkColor` is the canvas card's: its words
 * keep the brand's light colours after dark, where the palette's link colour would not read on
 * white; the grid's card leaves it to the theme.
 */
export default function TeamMemberLinks({
  links,
  label,
  kindWords: words,
  fontSize,
  linkColor,
  glyphColor,
}: {
  links: readonly PublicTeamLink[];
  label: string;
  kindWords: Record<TeamLinkKind, string>;
  fontSize: string | Record<string, string>;
  linkColor?: string;
  glyphColor?: string;
}) {
  return (
    // `role="list"` restated for WebKit, which drops it from a list with no markers (§169).
    <Box component="ul" role="list" aria-label={label} data-testid="team-links" sx={{ listStyle: "none", m: 0, mt: 0.5, p: 0 }}>
      {links.map((link, index) => (
        <Box component="li" role="listitem" key={index}>
          <MuiLink
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            data-link-kind={link.kind}
            sx={{ display: "flex", alignItems: "center", gap: 1, minHeight: 44, overflowWrap: "anywhere", fontSize, ...(linkColor ? { color: linkColor } : {}) }}
          >
            <TeamLinkGlyph kind={link.kind} size={18} {...(glyphColor ? { color: glyphColor } : {})} />
            <Box component="span" sx={{ minWidth: 0 }}>
              {link.label ?? (link.kind === "WEBSITE" || link.kind === "OTHER" ? teamLinkHost(link.url) : words[link.kind])}
            </Box>
          </MuiLink>
        </Box>
      ))}
    </Box>
  );
}

/**
 * The photo's `srcset` and `sizes` (§414), or neither: a card is a column of the grid — the album
 * grid's `tile` widths, two, three and four to a row — or, on the canvas, a listing card's column
 * (`card`, the wide card's photo) — and the photograph is drawn wider than its card by what the
 * frame magnifies: the crop's `1 / w`, or a square's cover (`teamPhotoFrame`, §541). A picture from
 * before the ladder keeps its thumbnail.
 */
export function teamPhotoWidths(photo: TeamPhoto, column: PictureColumn): { srcSet?: string; sizes?: string } {
  const srcSet = pictureSrcSet(photo.webUrl, photo.width);
  if (!srcSet) return {};
  return { srcSet, sizes: pictureSizes(column, 100, teamPhotoFrame(photo).magnify) };
}
