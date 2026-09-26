import LanguageIcon from "@mui/icons-material/Language";
import LinkIcon from "@mui/icons-material/Link";
import SocialIcon from "@/shared/ui/SocialIcon";
import type { TeamLinkKind } from "../links";

/**
 * One glyph per kind of a person's link (§474): the network's own mark for Strava, Instagram and
 * Facebook — the footer's marks (`SocialIcon`, §90, §112), in the networks' colours — the globe
 * for a site of their own, the chain link for anything else.
 *
 * No hooks and no catalogue, so the public card (a Server Component) and the editor's kind select
 * (a client island) draw the same picture. Never the backoffice's `action-icons.ts` (§318).
 * Decorative: the link's accessible name is its label.
 */
export default function TeamLinkGlyph({ kind, size = 20 }: { kind: TeamLinkKind; size?: number }) {
  switch (kind) {
    case "STRAVA":
      return <SocialIcon network="strava" size={size} />;
    case "INSTAGRAM":
      return <SocialIcon network="instagram" size={size} />;
    case "FACEBOOK":
      return <SocialIcon network="facebook" size={size} />;
    case "WEBSITE":
      return <LanguageIcon aria-hidden="true" sx={{ fontSize: size, flexShrink: 0, color: "text.secondary" }} />;
    case "OTHER":
      return <LinkIcon aria-hidden="true" sx={{ fontSize: size, flexShrink: 0, color: "text.secondary" }} />;
  }
}
