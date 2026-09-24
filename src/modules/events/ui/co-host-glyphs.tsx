import EventIcon from "@mui/icons-material/Event";
import HowToRegIcon from "@mui/icons-material/HowToReg";
import LanguageIcon from "@mui/icons-material/Language";
import LinkIcon from "@mui/icons-material/Link";
import type { SvgIconProps } from "@mui/material/SvgIcon";
import type { ComponentType } from "react";
import SocialIcon, { type SocialNetwork } from "@/shared/ui/SocialIcon";
import type { CoHostLinkKind } from "../domain/co-hosts";

/**
 * One glyph per kind of partner link (§NNN), for the editor's kind select and the public page's
 * partner cards alike — the same picture on both sides, the way `LINK_GLYPH` plays that role for
 * "Linkuri și fișiere" (§332).
 *
 * Three of the seven kinds are a social network's own mark, and Material's brand glyphs were
 * refused for exactly those three (`shared/ui/SocialIcon.tsx`; `DECISIONS.md` §90: "deprecated
 * and not the networks' current shapes"), so this file draws them through that component rather
 * than `@mui/icons-material/Facebook` and kin. The rest are metaphors, written down: a site is
 * the globe; a partner's own event is a calendar date, apart from the club's event on the page;
 * registering with the partner is the same tick Material draws for the runner's own
 * registration (`HowToRegIcon`, reused rather than duplicated); anything else is the chain link.
 *
 * The public set, one file per glyph (§90): never the backoffice's `shared/ui/action-icons.ts`,
 * which a public page must not reach (§318).
 */
const MUI_GLYPH: Partial<Record<CoHostLinkKind, ComponentType<SvgIconProps>>> = {
  SITE: LanguageIcon,
  EVENT: EventIcon,
  REGISTRATION: HowToRegIcon,
  OTHER: LinkIcon,
};

const NETWORK_OF: Partial<Record<CoHostLinkKind, SocialNetwork>> = {
  FACEBOOK: "facebook",
  INSTAGRAM: "instagram",
  STRAVA: "strava",
};

/**
 * The glyph for one kind of partner link, decorative (`aria-hidden`): the label beside it is
 * what is read, this is what the eye finds first. A plain function component so a Server
 * Component (the public page) and a client island (the editor) each import it directly and
 * render their own element — never a glyph passed as a prop across that boundary
 * (`docs/VIBECODING.md` § The rules that bite).
 */
export default function CoHostLinkGlyph({ kind, size = 20 }: { kind: CoHostLinkKind; size?: number }) {
  const network = NETWORK_OF[kind];
  if (network) return <SocialIcon network={network} size={size} />;
  const Icon = MUI_GLYPH[kind] ?? LinkIcon;
  return <Icon aria-hidden="true" sx={{ fontSize: size }} />;
}
