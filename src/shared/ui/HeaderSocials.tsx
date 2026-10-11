import Box from "@mui/material/Box";
import MuiLink from "@mui/material/Link";
import { UNDER_LOOK } from "@/theme/look";
import type { ClubSocialLink } from "./club-socials";
import SocialIcon from "./SocialIcon";

/**
 * The header's two social marks under «Aspectul nou» (§NNN; `docs/REDESIGN.md`: «the two social
 * icons, inside the one-row-at-320-px rule»): the club's Facebook and Instagram, from the one list
 * the footer reads (`clubSocialLinks`, §565) — never a second list.
 *
 * Drawn from `md` up, where the row has room for them beside the sections and «Vino cu noi»; on a
 * phone and a small tablet the footer's bar already carries them and the header keeps its one row
 * (§569). Inside the new look's scope only, so the backoffice — which shares this header — never
 * shows them. Each is a 44-pixel target (BR-REQ-041-01 criterion 6) whose accessible name is the
 * network's; the mark is decoration. Off-site, so a new tab and `rel`, as in the footer.
 */
export default function HeaderSocials({ links }: { links: readonly ClubSocialLink[] }) {
  if (links.length === 0) return null;
  return (
    <Box
      data-testid="header-socials"
      sx={{ flexShrink: 0, alignItems: "center", display: "none", [UNDER_LOOK]: { display: { xs: "none", md: "flex" } } }}
    >
      {links.map((entry) => (
        <MuiLink
          key={entry.href}
          href={entry.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={entry.label}
          title={entry.label}
          sx={{
            width: 44,
            height: 44,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "50%",
            "&:hover": { bgcolor: "action.hover" },
          }}
        >
          <SocialIcon network={entry.network} size={20} />
        </MuiLink>
      ))}
    </Box>
  );
}
