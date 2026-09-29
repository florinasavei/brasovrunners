import LanguageIcon from "@mui/icons-material/Language";
import LinkIcon from "@mui/icons-material/Link";
import SocialIcon from "@/shared/ui/SocialIcon";
import type { TeamLinkKind } from "../links";

/**
 * One glyph per link kind (§474): the footer's network marks (`SocialIcon`, §90, §112), a globe
 * for a website, a chain for anything else. No hooks, so server and client draw the same; never
 * `action-icons.ts` (§318). Decorative: the link's accessible name is its label.
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
