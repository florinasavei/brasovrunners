import DescriptionIcon from "@mui/icons-material/Description";
import LeaderboardIcon from "@mui/icons-material/Leaderboard";
import LinkIcon from "@mui/icons-material/Link";
import MapIcon from "@mui/icons-material/Map";
import PhotoLibraryIcon from "@mui/icons-material/PhotoLibrary";
import RouteIcon from "@mui/icons-material/Route";
import type { EventLinkKind } from "../domain/links";
import type { Glyph } from "./glyphs";

/**
 * One glyph per kind of link (`DECISIONS.md` §NNN), for the public page's "Linkuri și fișiere"
 * and the editor's kind select alike — the same picture on both sides, the way the type and the
 * surface wear the same glyph in the editor and on the page (§112, §121).
 *
 * The public set, imported directly, one file per glyph (§90): never the backoffice's
 * `shared/ui/action-icons.ts`, which a public page must not reach (§318). Kept out of `GLYPHS`
 * in `glyphs.ts` on purpose: `GlyphChip` is a client component that ships every glyph in that
 * table, and no chip shows a link's kind.
 *
 * The metaphors, written down: a GPX track is the route line — the track *is* the route, in a
 * file; a map is the folded map; a document is the page with lines; an album is the stack of
 * photos; results are the podium bars, not a trophy (everybody is in the results, few win);
 * anything else is the chain link.
 */
export const LINK_GLYPH: Record<EventLinkKind, Glyph> = {
  GPX: RouteIcon,
  MAP: MapIcon,
  DOCUMENT: DescriptionIcon,
  PHOTOS: PhotoLibraryIcon,
  RESULTS: LeaderboardIcon,
  OTHER: LinkIcon,
};
